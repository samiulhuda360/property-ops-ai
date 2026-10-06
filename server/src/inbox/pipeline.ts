// The inbox pipeline with the database: store an incoming email once per messageId, triage it, create or link the
// maintenance job, record the automation run, and handle a person's approve / dismiss / re-run decisions.
// Approving stores the reply as approved. Nothing is ever emailed: there is no sending code in this feature.
import { Prisma } from '@prisma/client'
import { recordReview, recordRun, type RunOutcome } from '../lib/automation'
import { prisma } from '../lib/prisma'
import type { RemovedSentence } from './guards'
import { loadDirectory, parseFrom, type LinkMethod } from './link'
import { ensureTicket, reporterLabel, type TicketDecision } from './tickets'
import { triageEmail, type TriageResult } from './triage'
import type { Category, TriageFlag, Urgency } from './types'

export interface IncomingEmail {
  from: string
  subject: string
  text: string
  messageId?: string | null
  receivedAt?: Date | null
}

/** What the triage stored on the message (InboxMessage.triage). */
export interface TriageDetails {
  summary: string
  reasons: string[]
  flags: TriageFlag[]
  clauseCandidates: number[]
  citedClauses: number[]
  maintenance: { isIssue: boolean; title: string; description: string }
  ticket: TicketDecision
  link: { method: LinkMethod; note: string; knownSender: boolean; senderEmail: string; senderName: string | null; contractor: string | null }
  rules: { category: Category; urgency: Urgency }
  model: TriageResult['model']
  modelDraft: string | null
  removedSentences: RemovedSentence[]
  promiseHits: number
  /** The reply as the triage drafted it, before any edit by a person. */
  systemDraft: string
  review?: { outcome: RunOutcome; changed: boolean; at: string }
}

export const itemRef = (id: number) => `inbox:${id}`

const messageInclude = {
  tenant: { select: { id: true, firstName: true, lastName: true, email: true } },
  property: { select: { id: true, code: true, address: true, suburb: true } },
  maintenanceRequest: { select: { id: true, title: true, priority: true, status: true, source: true, createdAt: true } },
} satisfies Prisma.InboxMessageInclude

export type InboxMessageWithLinks = Prisma.InboxMessageGetPayload<{ include: typeof messageInclude }>

export function getMessage(id: number): Promise<InboxMessageWithLinks | null> {
  return prisma.inboxMessage.findUnique({ where: { id }, include: messageInclude })
}

export function findMessage(userId: number, id: number): Promise<InboxMessageWithLinks | null> {
  return prisma.inboxMessage.findFirst({ where: { id, userId }, include: messageInclude })
}

export function listMessages(userId: number, filters: { statuses?: string[]; category?: string }): Promise<InboxMessageWithLinks[]> {
  return prisma.inboxMessage.findMany({
    where: {
      userId,
      ...(filters.statuses?.length ? { status: { in: filters.statuses } } : {}),
      ...(filters.category ? { category: filters.category } : {}),
    },
    include: messageInclude,
    orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
  })
}

/** The account a webhook message belongs to: the user whose email is the `to` address, else the first user. */
export async function resolveOwner(to?: string | null): Promise<number | null> {
  if (to) {
    const address = parseFrom(to).email
    const user = await prisma.user.findFirst({ where: { email: { equals: address, mode: 'insensitive' } }, select: { id: true } })
    if (user) return user.id
  }
  const first = await prisma.user.findFirst({ orderBy: { id: 'asc' }, select: { id: true } })
  return first?.id ?? null
}

const atOrBefore = (d: Date) => new Date(Math.min(d.getTime(), Date.now()))

/** Stores an email and triages it. A messageId already stored for the account returns the stored message. */
export async function ingestEmail(userId: number, email: IncomingEmail): Promise<{ duplicate: boolean; message: InboxMessageWithLinks }> {
  const externalId = email.messageId?.trim() || null
  const existing = async () => {
    const found = externalId ? await prisma.inboxMessage.findUnique({ where: { userId_externalId: { userId, externalId } }, select: { id: true } }) : null
    return found ? getMessage(found.id) : null
  }

  const stored = await existing()
  if (stored) return { duplicate: true, message: stored }

  let id: number
  try {
    const created = await prisma.inboxMessage.create({
      data: {
        userId,
        externalId,
        fromAddress: email.from.trim(),
        subject: email.subject.trim(),
        body: email.text,
        receivedAt: atOrBefore(email.receivedAt ?? new Date()),
        status: 'new',
        needsPerson: true,
      },
      select: { id: true },
    })
    id = created.id
  } catch (e) {
    // Two deliveries of the same messageId at once: the unique index lets one through.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const winner = await existing()
      if (winner) return { duplicate: true, message: winner }
    }
    throw e
  }

  return { duplicate: false, message: await triageStoredMessage(id, { firstRun: true }) }
}

async function decideTicket(
  msg: { maintenanceRequestId: number | null; receivedAt: Date; subject: string },
  result: TriageResult,
  previous: TriageDetails | null,
): Promise<TicketDecision> {
  if (msg.maintenanceRequestId) {
    return previous?.ticket ?? { action: 'linked', id: msg.maintenanceRequestId, title: null, note: 'Kept the maintenance job linked earlier.' }
  }
  if (!result.maintenance.isIssue) return { action: 'none', id: null, title: null, note: 'Not a repair, so no maintenance job.' }
  if (!result.link.property) {
    return { action: 'no_property', id: null, title: null, note: 'A repair, but the property is unknown, so no job was created yet.' }
  }
  return ensureTicket({
    propertyId: result.link.property.id,
    receivedAt: msg.receivedAt,
    urgency: result.urgency,
    title: result.maintenance.title,
    description: result.maintenance.description,
    subject: msg.subject,
    reportedBy: reporterLabel(result.link),
  })
}

function details(result: TriageResult, ticket: TicketDecision): TriageDetails {
  const ticketFlags: TriageFlag[] = ticket.action === 'linked' ? [{ type: 'ticket', person: false, message: ticket.note }] : []
  return {
    summary: result.summary,
    reasons: result.reasons,
    flags: [...result.flags, ...ticketFlags],
    clauseCandidates: result.clauseCandidates,
    citedClauses: result.citedClauses,
    maintenance: result.maintenance,
    ticket,
    link: {
      method: result.link.method,
      note: result.link.note,
      knownSender: result.link.knownSender,
      senderEmail: result.link.senderEmail,
      senderName: result.link.senderName,
      contractor: result.link.contractor?.name ?? null,
    },
    rules: result.rules,
    model: result.model,
    modelDraft: result.modelDraft,
    removedSentences: result.removedSentences,
    promiseHits: result.promiseHits,
    systemDraft: result.replyDraft,
  }
}

/** Runs the triage on a stored message and saves the result. The first run records the automation run. */
export async function triageStoredMessage(id: number, opts: { firstRun: boolean }): Promise<InboxMessageWithLinks> {
  const msg = await prisma.inboxMessage.findUniqueOrThrow({ where: { id } })
  const ref = itemRef(id)
  try {
    const dir = await loadDirectory(msg.userId)
    const result = await triageEmail({ from: msg.fromAddress, subject: msg.subject, text: msg.body, receivedAt: msg.receivedAt }, dir)
    const previous = (msg.triage as unknown as TriageDetails | null) ?? null
    const ticket = await decideTicket(msg, result, previous)
    const stored = details(result, ticket)
    await prisma.inboxMessage.update({
      where: { id },
      data: {
        category: result.category,
        urgency: result.urgency,
        needsPerson: result.needsPerson,
        reason: result.reasons.join(' ') || null,
        replyDraft: result.replyDraft,
        citedClause: result.citedClauses.join(',') || null,
        status: 'triaged',
        method: result.method,
        triage: stored as unknown as Prisma.InputJsonValue,
        tenantId: result.link.tenant?.id ?? null,
        leaseId: result.link.lease?.id ?? null,
        propertyId: result.link.property?.id ?? null,
        maintenanceRequestId: ticket.id,
      },
    })
    if (opts.firstRun) {
      await recordRun({ userId: msg.userId, automation: 'inbox_triage', itemRef: ref, outcome: 'auto', at: msg.receivedAt })
    } else {
      const run = await prisma.automationRun.findFirst({ where: { itemRef: ref }, orderBy: { id: 'desc' } })
      if (!run) await recordRun({ userId: msg.userId, automation: 'inbox_triage', itemRef: ref, outcome: 'auto', at: msg.receivedAt })
      else if (run.outcome === 'failed') await recordReview(ref, 0, 'auto')
    }
  } catch (e) {
    console.error(`Inbox triage failed for message ${id}:`, e instanceof Error ? e.message : e)
    await prisma.inboxMessage.update({ where: { id }, data: { status: 'new', reason: 'Triage failed. Run it again from the inbox.' } })
    if (opts.firstRun) await recordRun({ userId: msg.userId, automation: 'inbox_triage', itemRef: ref, outcome: 'failed', at: msg.receivedAt })
  }
  return (await getMessage(id))!
}

const clampSeconds = (s: number) => Math.min(4 * 60 * 60, Math.max(0, Math.round(Number.isFinite(s) ? s : 0)))
const sameText = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim()

export type ReviewResult = { ok: true; message: InboxMessageWithLinks } | { ok: false; status: 404 | 409; error: string }

/**
 * A person approves the reply (edited or not). The reply is stored with status "approved" for the person to send
 * from their own email. Nothing is sent from here.
 */
export async function approveMessage(userId: number, id: number, replyDraft: string, reviewSeconds: number): Promise<ReviewResult> {
  const msg = await prisma.inboxMessage.findFirst({ where: { id, userId } })
  if (!msg) return { ok: false, status: 404, error: 'Message not found' }
  if (msg.status === 'approved' || msg.status === 'sent') return { ok: false, status: 409, error: 'This reply has already been approved.' }
  if (msg.status === 'new') return { ok: false, status: 409, error: 'This message has not been triaged yet. Run the triage first.' }

  const previous = (msg.triage as unknown as TriageDetails | null) ?? null
  const systemDraft = previous?.systemDraft ?? msg.replyDraft ?? ''
  const changed = !sameText(replyDraft, systemDraft)
  const outcome: RunOutcome = changed ? 'corrected' : 'reviewed'
  const seconds = clampSeconds(reviewSeconds)
  await prisma.inboxMessage.update({
    where: { id },
    data: {
      status: 'approved',
      replyDraft: replyDraft.trim(),
      approvedAt: new Date(),
      reviewSeconds: (msg.reviewSeconds ?? 0) + seconds,
      ...(previous ? { triage: { ...previous, review: { outcome, changed, at: new Date().toISOString() } } as unknown as Prisma.InputJsonValue } : {}),
    },
  })
  await recordReview(itemRef(id), seconds, outcome)
  return { ok: true, message: (await getMessage(id))! }
}

/** A person decides the message needs no reply from this draft. */
export async function dismissMessage(userId: number, id: number, reviewSeconds: number): Promise<ReviewResult> {
  const msg = await prisma.inboxMessage.findFirst({ where: { id, userId } })
  if (!msg) return { ok: false, status: 404, error: 'Message not found' }
  if (msg.status === 'approved' || msg.status === 'sent') return { ok: false, status: 409, error: 'An approved reply cannot be dismissed.' }
  const previous = (msg.triage as unknown as TriageDetails | null) ?? null
  const seconds = clampSeconds(reviewSeconds)
  await prisma.inboxMessage.update({
    where: { id },
    data: {
      status: 'dismissed',
      reviewSeconds: (msg.reviewSeconds ?? 0) + seconds,
      ...(previous ? { triage: { ...previous, review: { outcome: 'rejected', changed: false, at: new Date().toISOString() } } as unknown as Prisma.InputJsonValue } : {}),
    },
  })
  await recordReview(itemRef(id), seconds, 'rejected')
  return { ok: true, message: (await getMessage(id))! }
}

/** Runs the triage again (for example after adding the tenant, or once a model is configured). */
export async function retriageMessage(userId: number, id: number): Promise<ReviewResult> {
  const msg = await prisma.inboxMessage.findFirst({ where: { id, userId }, select: { status: true } })
  if (!msg) return { ok: false, status: 404, error: 'Message not found' }
  if (msg.status === 'approved' || msg.status === 'sent') return { ok: false, status: 409, error: 'An approved reply cannot be triaged again.' }
  return { ok: true, message: await triageStoredMessage(id, { firstRun: false }) }
}

