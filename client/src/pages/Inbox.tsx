import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  approveInboxMessage,
  dismissInboxMessage,
  getInbox,
  getInboxMessage,
  getInboxMeta,
  loadInboxDemo,
  retriageInboxMessage,
} from '../api/inbox'
import type { InboxCategory, InboxFlag, InboxMessage, InboxMessageDetail, InboxStatusFilter, InboxUrgency } from '../types/inbox'

const CATEGORY_LABEL: Record<InboxCategory, string> = {
  maintenance: 'Maintenance',
  rent: 'Rent',
  lease_question: 'Lease question',
  complaint: 'Complaint',
  end_of_tenancy: 'End of tenancy',
  other: 'Other',
}

const CATEGORY_COLOR: Record<InboxCategory, string> = {
  maintenance: 'bg-orange-50 text-orange-700',
  rent: 'bg-green-50 text-green-700',
  lease_question: 'bg-blue-50 text-blue-700',
  complaint: 'bg-yellow-50 text-yellow-800',
  end_of_tenancy: 'bg-cyan-50 text-cyan-800',
  other: 'bg-gray-100 text-gray-600',
}

// The same colours as maintenance priorities.
const URGENCY_COLOR: Record<InboxUrgency, string> = {
  urgent: 'bg-red-100 text-red-700',
  high: 'bg-orange-100 text-orange-700',
  normal: 'bg-blue-100 text-blue-700',
  low: 'bg-gray-100 text-gray-600',
}

const STATUS_LABEL: Record<string, string> = {
  new: 'Not triaged',
  triaged: 'To review',
  approved: 'Approved, not sent',
  sent: 'Sent',
  dismissed: 'Dismissed',
}

const STATUS_COLOR: Record<string, string> = {
  new: 'bg-gray-100 text-gray-600',
  triaged: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  sent: 'bg-green-100 text-green-700',
  dismissed: 'bg-gray-100 text-gray-500',
}

const STATUS_FILTERS: { value: InboxStatusFilter; label: string; count: 'open' | 'approved' | 'dismissed' | 'all' }[] = [
  { value: 'open', label: 'To review', count: 'open' },
  { value: 'approved', label: 'Approved', count: 'approved' },
  { value: 'dismissed', label: 'Dismissed', count: 'dismissed' },
  { value: 'all', label: 'All', count: 'all' },
]

function senderName(m: InboxMessage): string {
  if (m.tenant) return `${m.tenant.firstName} ${m.tenant.lastName}`
  const named = m.fromAddress.match(/^\s*"?([^"<]+?)"?\s*</)
  return named ? named[1] : m.fromAddress
}

const when = (iso: string) => format(new Date(iso), 'd MMM, h:mm a')

function Chip({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`badge ${className}`}>{children}</span>
}

function MethodChip({ method }: { method: InboxMessage['method'] }) {
  if (!method) return null
  return method === 'rules' ? (
    <Chip className="bg-gray-100 text-gray-600">Rules only</Chip>
  ) : (
    <Chip className="bg-blue-50 text-blue-700">AI + rules</Chip>
  )
}

function MessageRow({ m, selected, onSelect }: { m: InboxMessage; selected: boolean; onSelect: () => void }) {
  const urgent = m.urgency === 'urgent' && (m.status === 'triaged' || m.status === 'new')
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className={`w-full text-left px-4 py-3 border-l-4 transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 ${
          urgent ? 'border-red-500' : 'border-transparent'
        } ${selected ? 'bg-blue-50' : urgent ? 'bg-red-50/60 hover:bg-red-50' : 'hover:bg-gray-50'}`}
      >
        <div className="flex items-center justify-between gap-2">
          <p className={`text-sm truncate ${m.status === 'triaged' ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>{senderName(m)}</p>
          <time className="text-xs text-gray-400 shrink-0" dateTime={m.receivedAt}>
            {format(new Date(m.receivedAt), 'd MMM')}
          </time>
        </div>
        <p className="text-sm text-gray-800 truncate">{m.subject || '(no subject)'}</p>
        <p className="text-xs text-gray-500 truncate">{m.body.replace(/\s+/g, ' ').slice(0, 90)}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {m.urgency && <Chip className={URGENCY_COLOR[m.urgency]}>{urgent ? 'Urgent' : m.urgency}</Chip>}
          {m.category && <Chip className={CATEGORY_COLOR[m.category]}>{CATEGORY_LABEL[m.category]}</Chip>}
          {m.needsPerson && m.status === 'triaged' && <Chip className="bg-amber-100 text-amber-800">Needs a person</Chip>}
          {m.status !== 'triaged' && <Chip className={STATUS_COLOR[m.status]}>{STATUS_LABEL[m.status]}</Chip>}
          {m.maintenanceRequest && <span className="text-xs text-gray-500">Job #{m.maintenanceRequest.id}</span>}
        </div>
      </button>
    </li>
  )
}

function FlagList({ flags }: { flags: InboxFlag[] }) {
  return (
    <ul className="space-y-1.5">
      {flags.map((f, i) => (
        <li key={i} className="text-sm">
          <span>{f.message}</span>
          {f.detail && <span className="block mt-0.5 text-xs text-gray-600 italic">"{f.detail}"</span>}
        </li>
      ))}
    </ul>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-800">{children}</dd>
    </div>
  )
}

function MessageDetail({ id }: { id: number }) {
  const qc = useQueryClient()
  const { data: m, isLoading, isError } = useQuery({ queryKey: ['inbox-message', id], queryFn: () => getInboxMessage(id) })
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  // Review time runs from opening the message to the decision.
  const openedAt = useRef(Date.now())

  useEffect(() => {
    openedAt.current = Date.now()
    setNotice(null)
    setCopied(false)
  }, [id])

  useEffect(() => {
    if (m) setDraft(m.replyDraft ?? '')
  }, [m?.id, m?.replyDraft]) // eslint-disable-line react-hooks/exhaustive-deps

  const reviewSeconds = () => Math.round((Date.now() - openedAt.current) / 1000)
  const refresh = (updated?: InboxMessage) => {
    qc.invalidateQueries({ queryKey: ['inbox'] })
    qc.invalidateQueries({ queryKey: ['inbox-meta'] })
    qc.invalidateQueries({ queryKey: ['maintenance'] })
    if (updated) qc.invalidateQueries({ queryKey: ['inbox-message', updated.id] })
  }

  const approve = useMutation({
    mutationFn: () => approveInboxMessage(id, { replyDraft: draft, reviewSeconds: reviewSeconds() }),
    onSuccess: (updated) => {
      setNotice('Reply approved. Nothing was emailed: copy it into your email to send it.')
      refresh(updated)
    },
  })
  const dismiss = useMutation({
    mutationFn: () => dismissInboxMessage(id, { reviewSeconds: reviewSeconds() }),
    onSuccess: (updated) => {
      setNotice('Message dismissed. No reply will be drafted for it.')
      refresh(updated)
    },
  })
  const retriage = useMutation({
    mutationFn: () => retriageInboxMessage(id),
    onSuccess: (updated) => {
      setNotice('Triage run again.')
      refresh(updated)
    },
  })

  if (isLoading) return <div className="card text-center py-16 text-gray-400">Loading message...</div>
  if (isError || !m) return <div className="card text-center py-16 text-gray-500">This message couldn't be loaded.</div>

  return <DetailBody m={m} draft={draft} setDraft={setDraft} notice={notice} copied={copied} setCopied={setCopied} approve={approve} dismiss={dismiss} retriage={retriage} />
}

type Action = { mutate: () => void; isPending: boolean; isError: boolean; error: unknown }

function errorText(e: unknown): string {
  const data = (e as { response?: { data?: { error?: string } } })?.response?.data
  return data?.error ?? 'Something went wrong. Try again.'
}

function DetailBody(props: {
  m: InboxMessageDetail
  draft: string
  setDraft: (s: string) => void
  notice: string | null
  copied: boolean
  setCopied: (b: boolean) => void
  approve: Action
  dismiss: Action
  retriage: Action
}) {
  const { m, draft, setDraft, notice, copied, setCopied, approve, dismiss, retriage } = props
  const t = m.triage
  const open = m.status === 'triaged' || m.status === 'new'
  const personFlags = t?.flags.filter((f) => f.person) ?? []
  const otherFlags = t?.flags.filter((f) => !f.person) ?? []
  const edited = t ? draft.trim() !== (m.replyDraft ?? '').trim() : false
  const busy = approve.isPending || dismiss.isPending || retriage.isPending
  const failed = [approve, dismiss, retriage].find((a) => a.isError)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(m.replyDraft ?? '')
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900 break-words">{m.subject || '(no subject)'}</h2>
            <p className="text-sm text-gray-500 mt-0.5 break-all">
              From {m.fromAddress} · received {format(new Date(m.receivedAt), 'd MMM yyyy, h:mm a')}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Chip className={STATUS_COLOR[m.status]}>{STATUS_LABEL[m.status]}</Chip>
            <MethodChip method={m.method} />
          </div>
        </div>
        {notice && (
          <p role="status" className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
            {notice}
          </p>
        )}
        {failed && (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorText(failed.error)}
          </p>
        )}
      </div>

      {t && m.needsPerson && open && (
        <section aria-labelledby="why-person" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <h3 id="why-person" className="text-sm font-semibold mb-2">
            Why this needs a person
          </h3>
          <FlagList flags={personFlags} />
        </section>
      )}
      {t && !m.needsPerson && open && (
        <section className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
          Routine: the draft answers this from the tenancy terms. Check it reads well, then approve it.
        </section>
      )}

      <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
        <section aria-labelledby="email-heading" className="card">
          <h3 id="email-heading" className="text-sm font-semibold text-gray-900 mb-3">
            The email
          </h3>
          <div className="whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-4 text-sm text-gray-800 max-h-96 overflow-y-auto">{m.body}</div>
        </section>

        <section aria-labelledby="triage-heading" className="card">
          <h3 id="triage-heading" className="text-sm font-semibold text-gray-900 mb-3">
            Triage
          </h3>
          {!t ? (
            <div className="text-sm text-gray-500">
              This message hasn't been triaged.{' '}
              <button type="button" className="text-blue-600 hover:underline" onClick={() => retriage.mutate()} disabled={busy}>
                Run the triage
              </button>
            </div>
          ) : (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Category">{m.category ? CATEGORY_LABEL[m.category] : 'Unknown'}</Field>
              <Field label="Urgency">
                {m.urgency && <Chip className={URGENCY_COLOR[m.urgency]}>{m.urgency}</Chip>}
                {t.model && t.model.urgency !== m.urgency && <span className="ml-2 text-xs text-gray-500">model said {t.model.urgency}; raised by the safety rules</span>}
              </Field>
              <div className="sm:col-span-2">
                <Field label="Summary">{t.summary}</Field>
              </div>
              <Field label="Tenant">
                {m.tenant ? (
                  <>
                    {m.tenant.firstName} {m.tenant.lastName}
                    <span className="block text-xs text-gray-500">{m.tenant.email}</span>
                  </>
                ) : (
                  <span className="text-gray-500">Not a tenant on file</span>
                )}
              </Field>
              <Field label="Property">
                {m.property ? (
                  <>
                    {m.property.address}, {m.property.suburb}
                    {m.property.code && <span className="block text-xs text-gray-500">{m.property.code}</span>}
                  </>
                ) : (
                  <span className="text-gray-500">Not identified</span>
                )}
              </Field>
              <div className="sm:col-span-2">
                <Field label="How the sender was matched">{t.link.note}</Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Maintenance job">
                  {m.maintenanceRequest ? (
                    <>
                      <Link to="/maintenance" className="text-blue-600 hover:underline">
                        #{m.maintenanceRequest.id} {m.maintenanceRequest.title}
                      </Link>{' '}
                      <span className="text-xs text-gray-500">
                        ({m.maintenanceRequest.priority} priority, {m.maintenanceRequest.status.replace('_', ' ')})
                      </span>
                      <span className="block text-xs text-gray-500 mt-0.5">{t.ticket.note}</span>
                    </>
                  ) : (
                    <span className="text-gray-500">{t.ticket.note}</span>
                  )}
                </Field>
              </div>
              {otherFlags.length > 0 && (
                <div className="sm:col-span-2">
                  <Field label="Checks applied">
                    <FlagList flags={otherFlags} />
                  </Field>
                </div>
              )}
              <div className="sm:col-span-2 text-xs text-gray-400">
                {m.method === 'rules'
                  ? 'Triaged by the keyword rules; no model was used.'
                  : `Triaged by ${t.model?.name ?? 'the model'}, then checked by the rules and guards.`}
              </div>
            </dl>
          )}
        </section>
      </div>

      {m.clauses.length > 0 && (
        <section aria-labelledby="clauses-heading" className="card">
          <h3 id="clauses-heading" className="text-sm font-semibold text-gray-900 mb-3">
            Tenancy terms cited in the reply
          </h3>
          <div className="space-y-3">
            {m.clauses.map((c) => (
              <article key={c.number} className="rounded-lg border border-gray-200 p-3">
                <h4 className="text-sm font-medium text-gray-900">
                  §{c.number} {c.title}
                </h4>
                <p className="mt-1 text-sm text-gray-600">{c.text}</p>
              </article>
            ))}
          </div>
          <p className="mt-3 text-xs text-gray-400">Example terms for a demo, not legal advice.</p>
        </section>
      )}

      <section aria-labelledby="reply-heading" className="card">
        <h3 id="reply-heading" className="text-sm font-semibold text-gray-900 mb-3">
          Reply
        </h3>
        {open ? (
          <>
            <label htmlFor="reply-draft" className="label">
              Reply draft (edit it before approving)
            </label>
            <textarea id="reply-draft" className="input font-sans" rows={12} value={draft} onChange={(e) => setDraft(e.target.value)} disabled={!t || busy} />
            {edited && <p className="mt-1 text-xs text-gray-500">Edited: the change is recorded when you approve.</p>}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button type="button" className="btn-primary" onClick={() => approve.mutate()} disabled={!t || busy || !draft.trim()}>
                {approve.isPending ? 'Approving...' : 'Approve reply (not sent)'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => dismiss.mutate()} disabled={busy}>
                {dismiss.isPending ? 'Dismissing...' : 'Dismiss, no reply'}
              </button>
              <button type="button" className="text-sm text-gray-500 hover:text-blue-600 disabled:opacity-50" onClick={() => retriage.mutate()} disabled={busy}>
                {retriage.isPending ? 'Running...' : 'Run the triage again'}
              </button>
            </div>
            <p className="mt-3 text-xs text-gray-500">
              Approving saves the reply as approved. Nothing is emailed automatically: you send it from your own email.
            </p>
          </>
        ) : (
          <>
            <div className="whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-4 text-sm text-gray-800">{m.replyDraft || 'No reply.'}</div>
            {m.status === 'approved' && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button type="button" className="btn-secondary" onClick={copy}>
                  {copied ? 'Copied' : 'Copy reply'}
                </button>
                <p className="text-xs text-gray-500">
                  Approved {m.approvedAt ? when(m.approvedAt) : ''} after {m.reviewSeconds ?? 0}s of review
                  {t?.review?.changed ? ', with edits' : ''}. Not sent: paste it into your email.
                </p>
              </div>
            )}
            {m.status === 'dismissed' && (
              <button type="button" className="mt-3 text-sm text-gray-500 hover:text-blue-600" onClick={() => retriage.mutate()} disabled={busy}>
                Reopen and run the triage again
              </button>
            )}
          </>
        )}
      </section>
    </div>
  )
}

export default function Inbox() {
  const qc = useQueryClient()
  const [status, setStatus] = useState<InboxStatusFilter>('open')
  const [category, setCategory] = useState<string>('all')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const { data: meta } = useQuery({ queryKey: ['inbox-meta'], queryFn: getInboxMeta })
  const { data: messages = [], isLoading, isError } = useQuery({ queryKey: ['inbox', status, category], queryFn: () => getInbox({ status, category }) })
  const demo = useMutation({
    mutationFn: loadInboxDemo,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inbox'] })
      qc.invalidateQueries({ queryKey: ['inbox-meta'] })
      qc.invalidateQueries({ queryKey: ['maintenance'] })
    },
  })

  // In the review queue, urgent messages come first; otherwise newest first.
  const ordered = useMemo(() => {
    if (status !== 'open') return messages
    return [...messages].sort((a, b) => Number(b.urgency === 'urgent') - Number(a.urgency === 'urgent'))
  }, [messages, status])

  // Open the first message; an approved or dismissed message stays open until another one is chosen.
  useEffect(() => {
    if (selectedId === null && ordered.length) setSelectedId(ordered[0].id)
  }, [ordered, selectedId])

  const empty = meta?.counts.all === 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tenant inbox</h1>
          <p className="text-gray-500 mt-1">
            Emails arrive through the webhook and are triaged here. Every reply waits for you: nothing is sent automatically.
          </p>
        </div>
        {meta && (
          <div className="text-right text-xs text-gray-500">
            <Chip className={meta.aiEnabled ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'}>
              {meta.aiEnabled ? `AI + rules (${meta.model})` : 'Rules only: no model configured'}
            </Chip>
            {!meta.webhookConfigured && <p className="mt-1">Webhook not configured (INBOX_WEBHOOK_SECRET)</p>}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div role="group" aria-label="Status" className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatus(f.value)}
              aria-pressed={status === f.value}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                status === f.value ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              {f.label}
              {meta && <span className={`ml-1.5 ${status === f.value ? 'text-blue-100' : 'text-gray-400'}`}>{meta.counts[f.count]}</span>}
            </button>
          ))}
        </div>
        <div>
          <label htmlFor="inbox-category" className="label">
            Category
          </label>
          <select id="inbox-category" className="input py-1.5" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">All categories</option>
            {(Object.keys(CATEGORY_LABEL) as InboxCategory[]).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isError ? (
        <div className="card text-center py-16 text-gray-500">The inbox couldn't be loaded. Check that the server is running.</div>
      ) : isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading messages...</div>
      ) : empty ? (
        <div className="card text-center py-16">
          <p className="text-gray-700 text-lg">No emails yet</p>
          <p className="text-sm text-gray-500 mt-2 max-w-lg mx-auto">
            Emails posted to <code className="text-gray-700">/api/webhooks/inbox</code> appear here, triaged and with a reply draft. Load the sample emails to see how
            it works.
          </p>
          <button type="button" className="btn-primary mt-5" onClick={() => demo.mutate()} disabled={demo.isPending}>
            {demo.isPending ? 'Loading and triaging...' : 'Load 15 demo emails'}
          </button>
          {demo.isError && <p className="mt-3 text-sm text-red-600">The demo emails couldn't be loaded.</p>}
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[22rem_minmax(0,1fr)] gap-6 items-start">
          <section aria-label="Messages" className="card p-0 overflow-hidden">
            {ordered.length === 0 ? (
              <p className="px-4 py-12 text-center text-sm text-gray-400">No messages match these filters.</p>
            ) : (
              <ul className="divide-y divide-gray-100 max-h-[75vh] overflow-y-auto">
                {ordered.map((m) => (
                  <MessageRow key={m.id} m={m} selected={m.id === selectedId} onSelect={() => setSelectedId(m.id)} />
                ))}
              </ul>
            )}
          </section>
          <div>
            {selectedId !== null ? <MessageDetail id={selectedId} /> : <div className="card text-center py-16 text-gray-400">Select a message to review it.</div>}
          </div>
        </div>
      )}
    </div>
  )
}
