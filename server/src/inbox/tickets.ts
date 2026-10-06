// Maintenance jobs from the inbox. A repair email creates a MaintenanceRequest (source "inbox") unless the same issue
// at the same property was logged in the 7 days before the email, or is still open; then the email is linked to that
// job instead.
import { prisma } from '../lib/prisma'
import { TICKET_PRIORITY, type Urgency } from './types'

const DAY_MS = 24 * 60 * 60 * 1000
export const DUPLICATE_WINDOW_DAYS = 7

// What the repair is about. Two jobs are the same issue when they share a key.
const ISSUE_KEYS: [string, RegExp][] = [
  ['hot_water', /\bhot water\b|\bcylinder\b|\bcalifont\b/i],
  ['water_leak', /\bleak|\bdrip|\bburst\b|\bflood|\bpouring\b|\btaps?\b|\bmixer\b|\bpipes?\b|\bsink\b/i],
  ['roof_gutter', /\broof\b|\bgutters?\b|\bdownpipes?\b|\bspouting\b/i],
  ['toilet_drain', /\btoilets?\b|\bsewage\b|\bsewer\b|\bdrains?\b|\bblocked\b/i],
  ['electrical', /\bpower points?\b|\bsockets?\b|\bspark|\bwiring\b|\bswitchboard\b|\bfuse\b|\belectrical\b|\blight fittings?\b|\blights?\b|\bburning smell\b|\bscorch/i],
  ['gas', /\bgas\b/i],
  ['heating', /\bheat ?pumps?\b|\bheaters?\b|\bheating\b/i],
  ['ventilation', /\bextractor\b|\bfans?\b|\bventilation\b|\brange ?hood\b/i],
  ['mould', /\bmou?ld\b|\bdamp\b|\bcondensation\b/i],
  ['pests', /\brats?\b|\bmice\b|\bmouse\b|\brodents?\b|\bcockroach|\bpests?\b|\bdroppings\b|\bwasps?\b/i],
  ['locks', /\blocks?\b|\bkeys?\b|\bbreak-?in\b|\bbroke in|\bdeadbolt\b|\bdoor handle\b|\blatch\b/i],
  ['window', /\bwindows?\b|\bglass\b|\branch ?slider\b/i],
  ['cooking', /\boven\b|\bhob\b|\bstove\b|\bcooktop\b|\bigniter\b|\bburners?\b/i],
  ['dishwasher', /\bdishwasher\b/i],
  ['laundry', /\bwashing machine\b|\bdryer\b|\blaundry\b/i],
  ['smoke_alarm', /\bsmoke alarms?\b|\bsmoke detectors?\b|\bchirp/i],
  ['fence_gate', /\bfences?\b|\bpalings?\b|\bgates?\b/i],
  ['garden', /\blawns?\b|\bhedges?\b|\btrees?\b|\bgarden\b/i],
  ['fixtures', /\btowel rail\b|\bshel(f|ves)\b|\bcurtains?\b|\bblinds?\b|\bhandles?\b|\bhooks?\b/i],
]

export function issueKeys(text: string): Set<string> {
  return new Set(ISSUE_KEYS.filter(([, re]) => re.test(text)).map(([key]) => key))
}

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'is', 'not', 'no', 'with', 'for', 'still', 'again'])
const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)))

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const w of a) if (b.has(w)) shared++
  return shared / (a.size + b.size - shared)
}

export interface ExistingTicket {
  id: number
  title: string
  description: string
  status: string
  createdAt: Date
}

/**
 * The job an email duplicates, if any: same issue (a shared issue key, or similar titles when neither has a key),
 * logged in the 7 days before the email or still open. Candidates must already be limited to the email's property.
 */
export function findDuplicate(ticket: { title: string; description: string; subject: string }, receivedAt: Date, candidates: ExistingTicket[]): ExistingTicket | null {
  const since = receivedAt.getTime() - DUPLICATE_WINDOW_DAYS * DAY_MS
  const keys = issueKeys(`${ticket.title} ${ticket.description} ${ticket.subject}`)
  const titleWords = words(`${ticket.title} ${ticket.subject}`)
  const eligible = candidates
    .filter((c) => c.createdAt.getTime() >= since || c.status !== 'completed')
    .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())
  for (const c of eligible) {
    const theirs = issueKeys(`${c.title} ${c.description}`)
    if (keys.size > 0 && theirs.size > 0) {
      if ([...keys].some((k) => theirs.has(k))) return c
    } else if (keys.size === 0 && theirs.size === 0 && jaccard(titleWords, words(c.title)) >= 0.5) {
      return c
    }
  }
  return null
}

/** Who reported the repair, for the job description. */
export function reporterLabel(link: { tenant: { firstName: string; lastName: string } | null; senderEmail: string }): string {
  return link.tenant ? `${link.tenant.firstName} ${link.tenant.lastName}, ${link.senderEmail}` : link.senderEmail
}

/** The job description: the facts for the tradesperson, then where the report came from. */
export function ticketDescription(description: string, subject: string, reportedBy: string): string {
  return `${description}\n\nFrom the tenant inbox: "${subject}" (${reportedBy}).`
}

export type TicketAction = 'created' | 'linked' | 'none' | 'no_property'

export interface TicketDecision {
  action: TicketAction
  id: number | null
  title: string | null
  note: string
}

const fmt = (d: Date) => d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Pacific/Auckland' })

/** Creates the maintenance job for a repair email, or links the existing job for the same issue. */
export async function ensureTicket(input: {
  propertyId: number
  receivedAt: Date
  urgency: Urgency
  title: string
  description: string
  subject: string
  reportedBy: string
}): Promise<TicketDecision> {
  const since = new Date(input.receivedAt.getTime() - DUPLICATE_WINDOW_DAYS * DAY_MS)
  // One transaction per property at a time, so two deliveries about the same repair can't both create a job.
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(4242, ${input.propertyId}::int)`
    const candidates = await tx.maintenanceRequest.findMany({
      where: { propertyId: input.propertyId, OR: [{ createdAt: { gte: since } }, { status: { not: 'completed' } }] },
      select: { id: true, title: true, description: true, status: true, createdAt: true },
    })
    const duplicate = findDuplicate(input, input.receivedAt, candidates)
    if (duplicate) {
      return {
        action: 'linked' as const,
        id: duplicate.id,
        title: duplicate.title,
        note: `Same issue as maintenance job #${duplicate.id} "${duplicate.title}" (${duplicate.status.replace('_', ' ')}, logged ${fmt(duplicate.createdAt)}), so no new job was created.`,
      }
    }
    const createdAt = new Date(Math.min(input.receivedAt.getTime(), Date.now()))
    const job = await tx.maintenanceRequest.create({
      data: {
        propertyId: input.propertyId,
        title: input.title.slice(0, 120),
        description: ticketDescription(input.description, input.subject, input.reportedBy),
        priority: TICKET_PRIORITY[input.urgency],
        status: 'open',
        source: 'inbox',
        createdAt,
      },
    })
    return { action: 'created' as const, id: job.id, title: job.title, note: `Created maintenance job #${job.id} with ${job.priority} priority.` }
  })
}
