import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import {
  downloadWorkbook,
  getBatches,
  getJobOptions,
  getLeaseOptions,
  getLines,
  getSummary,
  importStatement,
  loadDemoStatement,
  resolveLine,
} from '../api/reconciliation'
import type { BankLine, BatchSummary, ExceptionCode, ImportResult, ResolveInput } from '../types/reconciliation'

const nzd = new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' })
const money = (n: number) => nzd.format(n)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** Formats a yyyy-mm-dd date without passing it through the browser's time zone. */
const day = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`

const errorText = (e: unknown) =>
  isAxiosError(e) ? (e.response?.data as { error?: string } | undefined)?.error ?? e.message : 'Something went wrong.'

const REASON_STYLE: Record<ExceptionCode, string> = {
  underpaid: 'bg-red-100 text-red-700',
  overpaid: 'bg-amber-100 text-amber-800',
  duplicate: 'bg-orange-100 text-orange-700',
  unknown_payer: 'bg-gray-200 text-gray-800',
  ambiguous: 'bg-yellow-100 text-yellow-800',
  payment_to_ended_lease: 'bg-sky-100 text-sky-800',
  no_matching_job: 'bg-slate-200 text-slate-700',
  amount_differs_from_quote: 'bg-blue-100 text-blue-700',
}

/** What "accept" does for each reason, said on the button. Missing: nothing to accept, the person must choose. */
const ACCEPT_LABEL: Partial<Record<ExceptionCode, string>> = {
  underpaid: 'Accept: keep the part-payment, the shortfall stays in arrears',
  overpaid: 'Accept: keep the extra as credit on the tenancy',
  duplicate: 'Leave out: it is a duplicate, rent is not changed',
  payment_to_ended_lease: 'Accept: refund due, not counted as rent',
  no_matching_job: 'Accept: contractor payment without a job',
  amount_differs_from_quote: 'Accept: the amount paid is right',
}

function ReasonChip({ code, label }: { code: ExceptionCode | null; label: string | null }) {
  if (!code) return null
  return <span className={`badge ${REASON_STYLE[code]}`}>{label ?? code.replace(/_/g, ' ')}</span>
}

function StatCard({ label, value, sub, tone = 'text-gray-900' }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="card">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tone}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

function target(line: BankLine): string {
  if (line.lease) return `${line.lease.tenant}, ${line.lease.address}`
  if (line.job) return `${line.contractor?.name ?? 'Contractor'}: ${line.job.label}`
  if (line.contractor) return line.contractor.name
  if (line.category) return line.category.replace(/_/g, ' ')
  return line.matchType ?? 'Not matched'
}

function weeks(line: BankLine): string {
  return line.allocations.map((a) => `${day(a.dueDate)}${a.completes ? '' : ' (part)'}`).join(', ')
}

// ---- Review dialog: the bank line as exported beside what the rules found, and the decision ----

function ReviewDialog({ line, onClose, onSaved }: { line: BankLine; onClose: () => void; onSaved: (text: string) => void }) {
  const qc = useQueryClient()
  const openedAt = useRef(Date.now())
  const [elapsed, setElapsed] = useState(0)
  const moneyIn = line.amount > 0
  const isContractor = line.matchType === 'contractor' || line.contractor !== null
  const { data: leases = [] } = useQuery({ queryKey: ['recon-leases'], queryFn: getLeaseOptions, enabled: moneyIn })
  const { data: jobs = [] } = useQuery({ queryKey: ['recon-jobs'], queryFn: getJobOptions, enabled: isContractor })
  const suggestion = line.aiSuggestion?.status === 'ok' ? line.aiSuggestion : null
  const [leaseId, setLeaseId] = useState<number | ''>(line.lease?.id ?? '')
  const [jobId, setJobId] = useState<number | ''>(line.job?.id ?? line.candidates.find((c) => c.kind === 'job')?.id ?? '')
  const [note, setNote] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - openedAt.current) / 1000)), 1000)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    dialogRef.current?.focus()
    return () => {
      clearInterval(timer)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const resolve = useMutation({
    mutationFn: (input: Omit<ResolveInput, 'reviewSeconds' | 'note'>) =>
      resolveLine(line.id, { ...input, note: note.trim() || undefined, reviewSeconds: (Date.now() - openedAt.current) / 1000 }),
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['recon-summary'] })
      qc.invalidateQueries({ queryKey: ['recon-lines'] })
      qc.invalidateQueries({ queryKey: ['recon-batches'] })
      qc.invalidateQueries({ queryKey: ['payments'] })
      qc.invalidateQueries({ queryKey: ['work-queue'] })
      const what =
        saved.matchStatus === 'ignored' ? 'left out' : saved.lease ? `assigned to ${saved.lease.tenant}` : saved.job ? `linked to ${saved.job.label}` : 'accepted'
      onSaved(`Line ${saved.row} (${saved.payee || 'bank'} ${money(saved.amount)}) ${what}.`)
      onClose()
    },
  })

  const acceptLabel = line.exception ? ACCEPT_LABEL[line.exception] : line.matchStatus === 'matched' ? 'Confirm: the match is right' : undefined
  const canAccept = acceptLabel && !(line.exception === 'ambiguous' && !line.lease && !line.job)
  const leaseName = (id: number) => {
    const l = leases.find((x) => x.id === id)
    return l ? `${l.tenant?.firstName ?? ''} ${l.tenant?.lastName ?? ''}`.trim() : `tenancy ${id}`
  }
  const contractorJobs = jobs.filter((j) => !line.contractor || j.contractorId === line.contractor.id)
  const source: [string, string][] = [
    ['Line in file', String(line.row)],
    ['Date', day(line.date)],
    ['Amount', money(line.amount)],
    ['Payee', line.payee || '(blank)'],
    ['Particulars', line.particulars || '-'],
    ['Code', line.code || '-'],
    ['Reference', line.reference || '-'],
    ['Transaction type', line.tranType || '-'],
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-title"
        className="relative bg-white rounded-xl shadow-xl w-full max-w-4xl mx-4 max-h-[92vh] overflow-y-auto focus:outline-none"
      >
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 id="review-title" className="text-lg font-semibold text-gray-900">
              Review bank line {line.row}
            </h2>
            <ReasonChip code={line.exception} label={line.exceptionLabel} />
            {line.resolution && <span className="badge bg-green-100 text-green-700">Decided: {line.resolution.decision}</span>}
          </div>
          <button onClick={onClose} aria-label="Close without deciding" className="p-1 text-gray-400 hover:text-gray-600 rounded">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 p-5">
          <section aria-label="Bank line as exported">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Bank line, as exported</h3>
            <dl className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-sm">
              {source.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 px-3 py-2">
                  <dt className="text-gray-500">{k}</dt>
                  <dd className={`text-right font-medium ${k === 'Amount' && line.amount < 0 ? 'text-red-600' : 'text-gray-900'}`}>{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-label="What the rules found" className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">What the rules found</h3>
            <p className="text-sm text-gray-800">{line.explanation}</p>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="badge bg-gray-100 text-gray-700">Method: {line.methodLabel}</span>
              {line.confidence > 0 && <span className="badge bg-gray-100 text-gray-700">Confidence: {Math.round(line.confidence * 100)}%</span>}
              {line.credit > 0 && <span className="badge bg-amber-100 text-amber-800">Credit {money(line.credit)}</span>}
            </div>
            {line.allocations.length > 0 && <p className="text-sm text-gray-600">Rent weeks: {weeks(line)}</p>}
            {line.suggestedAction && (
              <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
                <p className="text-xs font-semibold text-gray-500 mb-1">Suggested action</p>
                <p className="text-sm text-gray-800">{line.suggestedAction}</p>
              </div>
            )}
            {line.aiSuggestion && (
              <div className="rounded-lg border border-dashed border-blue-300 bg-blue-50 p-3">
                <p className="text-xs font-semibold text-blue-800 mb-1">Model suggestion (not applied)</p>
                {suggestion ? (
                  <>
                    <p className="text-sm text-gray-800">
                      {suggestion.tenancy ? `Tenancy ${suggestion.tenancy}` : `No tenancy: ${suggestion.category}`} ·{' '}
                      {Math.round(suggestion.confidence * 100)}% confident
                    </p>
                    <p className="text-sm text-gray-600 mt-1">{suggestion.reason}</p>
                    <p className="text-xs text-gray-400 mt-1">{suggestion.model}</p>
                  </>
                ) : (
                  <p className="text-sm text-gray-600">No usable suggestion ({line.aiSuggestion.error ?? 'the model gave none'}). The rules result stands.</p>
                )}
              </div>
            )}
          </section>
        </div>

        <div className="border-t border-gray-200 p-5 space-y-4">
          {moneyIn && (
            <div className="space-y-2">
              {line.candidates.filter((c) => c.kind === 'lease').length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {line.candidates
                    .filter((c) => c.kind === 'lease')
                    .map((c) => (
                      <button
                        key={c.id}
                        className="btn-secondary"
                        disabled={resolve.isPending}
                        onClick={() => resolve.mutate({ decision: 'reassign', leaseId: c.id })}
                        title={c.why}
                      >
                        Assign to {c.label} (updates the rent ledger)
                      </button>
                    ))}
                </div>
              )}
              {suggestion?.leaseId && (
                <button className="btn-secondary border-blue-300" disabled={resolve.isPending} onClick={() => resolve.mutate({ decision: 'reassign', leaseId: suggestion.leaseId! })}>
                  Use the suggestion: assign to {leaseName(suggestion.leaseId)} (updates the rent ledger)
                </button>
              )}
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex-1 min-w-[16rem]">
                  <label htmlFor="assign-lease" className="label">
                    Or choose a tenancy
                  </label>
                  <select id="assign-lease" className="input" value={leaseId} onChange={(e) => setLeaseId(e.target.value ? Number(e.target.value) : '')}>
                    <option value="">Select a tenancy...</option>
                    {leases.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.tenant?.firstName} {l.tenant?.lastName}, {l.property?.address} ({money(l.weeklyRent)}/wk{l.status === 'ended' ? ', ended' : ''})
                      </option>
                    ))}
                  </select>
                </div>
                <button className="btn-primary" disabled={!leaseId || resolve.isPending} onClick={() => leaseId && resolve.mutate({ decision: 'reassign', leaseId })}>
                  Assign to this tenancy
                </button>
              </div>
            </div>
          )}
          {isContractor && line.amount < 0 && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[16rem]">
                <label htmlFor="assign-job" className="label">
                  Link to a job{line.contractor ? ` (${line.contractor.name})` : ''}
                </label>
                <select id="assign-job" className="input" value={jobId} onChange={(e) => setJobId(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">Select a job...</option>
                  {contractorJobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.title}, {j.property?.address} (quote {j.quoteAmount ? money(j.quoteAmount) : 'none'})
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn-primary" disabled={!jobId || resolve.isPending} onClick={() => jobId && resolve.mutate({ decision: 'reassign', jobId })}>
                Link to this job
              </button>
            </div>
          )}
          <div>
            <label htmlFor="decision-note" className="label">
              Note (optional)
            </label>
            <input id="decision-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. confirmed with the tenant by phone" />
          </div>
          <div className="flex flex-wrap gap-2">
            {canAccept && (
              <button className="btn-primary" disabled={resolve.isPending} onClick={() => resolve.mutate({ decision: 'accept' })}>
                {acceptLabel}
              </button>
            )}
            <button className="btn-secondary" disabled={resolve.isPending} onClick={() => resolve.mutate({ decision: 'ignore' })}>
              Leave out (no change to rent)
            </button>
          </div>
          {resolve.isError && <p className="text-sm text-red-600">{errorText(resolve.error)}</p>}
          <p className="text-xs text-gray-500">
            Nothing is paid, refunded or sent from here: a decision only updates the rent ledger in Property Ops. Review time{' '}
            {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}, recorded with your decision.
          </p>
        </div>
      </div>
    </div>
  )
}

// ---- Panels ----

function ExceptionsPanel({ lines, onReview }: { lines: BankLine[]; onReview: (l: BankLine) => void }) {
  const [showResolved, setShowResolved] = useState(false)
  const open = lines.filter((l) => l.matchStatus === 'exception')
  const resolved = lines.filter((l) => l.engine.exception && l.matchStatus !== 'exception')
  const shown = showResolved ? [...open, ...resolved] : open
  return (
    <div className="card p-0 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-4 border-b border-gray-200">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Exceptions to review</h2>
          <p className="text-xs text-gray-500">Lines the rules held for a person. Open one to see the bank line beside what was found.</p>
        </div>
        {resolved.length > 0 && (
          <button className="text-sm text-blue-700 hover:underline" onClick={() => setShowResolved((s) => !s)}>
            {showResolved ? 'Hide' : 'Show'} resolved ({resolved.length})
          </button>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-10">No open exceptions. Every line is matched or decided.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Date', 'Payee and reference', 'Amount', 'Reason', 'Suggested action', 'Model suggestion', ''].map((h) => (
                  <th key={h} scope="col" className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-4 py-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shown.map((l) => (
                <tr key={l.id} className={l.matchStatus === 'exception' ? 'hover:bg-gray-50' : 'bg-gray-50/60 text-gray-500'}>
                  <td className="px-4 py-3 whitespace-nowrap">{day(l.date)}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{l.payee || '(blank)'}</p>
                    <p className="text-xs text-gray-500">{[l.particulars, l.code, l.reference].filter(Boolean).join(' / ') || 'no reference'}</p>
                  </td>
                  <td className={`px-4 py-3 whitespace-nowrap font-semibold ${l.amount < 0 ? 'text-red-600' : 'text-gray-900'}`}>{money(l.amount)}</td>
                  <td className="px-4 py-3">
                    <ReasonChip code={l.exception ?? l.engine.exception} label={l.exceptionLabel} />
                  </td>
                  <td className="px-4 py-3 text-gray-700 max-w-xs">{l.suggestedAction}</td>
                  <td className="px-4 py-3 text-xs max-w-[14rem]">
                    {l.aiSuggestion?.status === 'ok' ? (
                      <span className="text-blue-800">
                        Suggestion: {l.aiSuggestion.tenancy ?? `none (${l.aiSuggestion.category})`}
                      </span>
                    ) : l.aiSuggestion ? (
                      <span className="text-gray-400">No usable suggestion</span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {l.matchStatus === 'exception' ? (
                      <button className="btn-primary" onClick={() => onReview(l)} aria-label={`Review line ${l.row}, ${l.payee || 'bank'} ${money(l.amount)}`}>
                        Review
                      </button>
                    ) : (
                      <button className="text-sm text-blue-700 hover:underline" onClick={() => onReview(l)}>
                        {l.resolution?.decision ?? l.matchStatus}: change
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function MatchedPanel({ lines, onReview }: { lines: BankLine[]; onReview: (l: BankLine) => void }) {
  const [open, setOpen] = useState(false)
  const matched = lines.filter((l) => l.matchStatus === 'matched')
  return (
    <div className="card p-0 overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-gray-50"
        aria-expanded={open}
        aria-controls="matched-lines"
        onClick={() => setOpen((o) => !o)}
      >
        <span>
          <span className="text-base font-semibold text-gray-900">Matched lines ({matched.length})</span>
          <span className="block text-xs text-gray-500">Each line, what it was matched to, the rent weeks it paid and how it was matched.</span>
        </span>
        <svg className={`w-5 h-5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div id="matched-lines" className="overflow-x-auto border-t border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Date', 'Payee', 'Amount', 'Matched to', 'Rent weeks', 'Method', ''].map((h) => (
                  <th key={h} scope="col" className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-4 py-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {matched.map((l) => (
                <tr key={l.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 whitespace-nowrap">{day(l.date)}</td>
                  <td className="px-4 py-2 text-gray-900">{l.payee || '(blank)'}</td>
                  <td className={`px-4 py-2 whitespace-nowrap ${l.amount < 0 ? 'text-red-600' : 'text-gray-900'}`}>{money(l.amount)}</td>
                  <td className="px-4 py-2 text-gray-700">
                    {target(l)}
                    {l.credit > 0 && <span className="badge bg-amber-100 text-amber-800 ml-2">credit {money(l.credit)}</span>}
                  </td>
                  <td className="px-4 py-2 text-gray-600">{weeks(l) || '-'}</td>
                  <td className="px-4 py-2 text-gray-600 whitespace-nowrap">
                    {l.methodLabel} · {Math.round(l.confidence * 100)}%{l.resolution ? ' · after review' : ''}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button className="text-sm text-blue-700 hover:underline" onClick={() => onReview(l)} aria-label={`Check line ${l.row}`}>
                      Check
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ArrearsPanel({ summary }: { summary: BatchSummary }) {
  const { arrears, credits } = summary
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="card lg:col-span-2">
        <h2 className="text-base font-semibold text-gray-900">Arrears at {day(arrears.asOf)}</h2>
        <p className="text-xs text-gray-500 mb-4">Rent due on or before the statement end and not fully covered by matched money.</p>
        {arrears.tenants.length === 0 ? (
          <p className="text-sm text-gray-500 py-4">No arrears.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {arrears.tenants.map((a) => (
              <li key={a.leaseId} className="py-3 flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {a.tenant} <span className="text-gray-500 font-normal">· {a.address}</span>
                  </p>
                  <p className="text-xs text-gray-500">
                    {a.weeks
                      .map((w) => `week due ${day(w.dueDate)}: ${money(w.outstanding)} owing${w.paid > 0 ? ` (${money(w.paid)} paid)` : ''}`)
                      .join(' · ')}
                  </p>
                </div>
                <p className="text-sm font-semibold text-red-600 whitespace-nowrap">{money(a.total)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="card">
        <h2 className="text-base font-semibold text-gray-900">Credit held</h2>
        <p className="text-xs text-gray-500 mb-4">Money paid beyond the rent due, kept on the tenancy until you apply or refund it.</p>
        {credits.tenants.length === 0 ? (
          <p className="text-sm text-gray-500 py-4">None.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {credits.tenants.map((c) => (
              <li key={c.leaseId} className="py-2 flex justify-between text-sm">
                <span className="text-gray-900">
                  {c.tenant} {c.propertyCode && <span className="text-gray-500">({c.propertyCode})</span>}
                </span>
                <span className="font-semibold text-amber-700">{money(c.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function importMessage(r: ImportResult): string {
  if (r.alreadyImported) return `${r.fileName}: every line was imported before, so nothing changed.`
  const skipped = r.skippedLines ? ` ${r.skippedLines} lines were already imported and were skipped.` : ''
  const errors = r.errors.length ? ` ${r.errors.length} rows could not be read.` : ''
  const method = r.method === 'rules+model' ? `rules, plus ${r.suggestions} model suggestions` : 'rules'
  return `Imported ${r.newLines} lines from ${r.fileName}: ${r.matched} matched, ${r.exceptions} to review (method: ${method}).${skipped}${errors}`
}

// ---- Page ----

export default function Reconciliation() {
  const qc = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [chosenBatch, setChosenBatch] = useState<string | undefined>()
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [reviewing, setReviewing] = useState<BankLine | null>(null)
  const [downloading, setDownloading] = useState(false)

  const batches = useQuery({ queryKey: ['recon-batches'], queryFn: getBatches })
  const batch = chosenBatch ?? batches.data?.[0]?.batch
  const summary = useQuery({ queryKey: ['recon-summary', batch], queryFn: () => getSummary(batch), enabled: !!batch })
  const lines = useQuery({ queryKey: ['recon-lines', batch], queryFn: () => getLines(batch), enabled: !!batch })

  const refresh = (result: ImportResult) => {
    setChosenBatch(result.batch)
    qc.invalidateQueries({ queryKey: ['recon-batches'] })
    qc.invalidateQueries({ queryKey: ['recon-summary'] })
    qc.invalidateQueries({ queryKey: ['recon-lines'] })
    qc.invalidateQueries({ queryKey: ['payments'] })
    qc.invalidateQueries({ queryKey: ['work-queue'] })
    setNotice({ tone: 'ok', text: importMessage(result) })
  }
  const upload = useMutation({ mutationFn: importStatement, onSuccess: refresh, onError: (e) => setNotice({ tone: 'error', text: errorText(e) }) })
  const demo = useMutation({ mutationFn: loadDemoStatement, onSuccess: refresh, onError: (e) => setNotice({ tone: 'error', text: errorText(e) }) })
  const busy = upload.isPending || demo.isPending

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) upload.mutate(file)
    e.target.value = ''
  }

  const download = async () => {
    setDownloading(true)
    try {
      await downloadWorkbook(batch)
    } catch (e) {
      setNotice({ tone: 'error', text: errorText(e) })
    } finally {
      setDownloading(false)
    }
  }

  const s = summary.data
  const allLines = useMemo(() => lines.data ?? [], [lines.data])
  const loading = batches.isLoading || (!!batch && (summary.isLoading || lines.isLoading))
  const empty = !batches.isLoading && (batches.data?.length ?? 0) === 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reconciliation</h1>
          <p className="text-gray-500 mt-1">Match the bank statement to rent, contractor jobs and fees. Nothing is paid or sent from here.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={fileInput} id="statement-file" type="file" accept=".csv,text/csv" className="sr-only" onChange={onFile} aria-label="Bank statement CSV file" />
          <button className="btn-primary" onClick={() => fileInput.current?.click()} disabled={busy}>
            {upload.isPending ? 'Importing...' : 'Import CSV'}
          </button>
          <button className="btn-secondary" onClick={download} disabled={!s || downloading}>
            {downloading ? 'Preparing...' : 'Download Excel'}
          </button>
        </div>
      </div>

      {notice && (
        <div
          role="status"
          className={`flex items-start justify-between gap-4 rounded-lg border px-4 py-3 text-sm ${
            notice.tone === 'ok' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-xs underline" aria-label="Dismiss message">
            Dismiss
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : empty ? (
        <div className="card text-center py-16">
          <p className="text-gray-700 text-lg">No bank statement imported yet</p>
          <p className="text-sm text-gray-500 mt-2 max-w-xl mx-auto">
            Import the CSV export from the bank (Date, Amount, Payee, Particulars, Code, Reference). Rent is matched to tenancies and
            weeks, contractor payments to jobs, and anything unclear is held here for you to decide.
          </p>
          <div className="flex justify-center gap-2 mt-6">
            <button className="btn-primary" onClick={() => fileInput.current?.click()} disabled={busy}>
              Import CSV
            </button>
            <button className="btn-secondary" onClick={() => demo.mutate()} disabled={busy}>
              {demo.isPending ? 'Loading...' : 'Load the September 2026 demo statement'}
            </button>
          </div>
        </div>
      ) : s ? (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {(batches.data?.length ?? 0) > 1 && (
              <div className="flex items-center gap-2">
                <label htmlFor="batch" className="text-gray-600">
                  Statement
                </label>
                <select id="batch" className="input w-auto" value={batch} onChange={(e) => setChosenBatch(e.target.value)}>
                  {batches.data!.map((b) => (
                    <option key={b.batch} value={b.batch}>
                      {b.fileName || b.batch}: {day(b.periodStart)} to {day(b.periodEnd)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <span className="text-gray-600">
              {s.fileName}: {day(s.period.start)} to {day(s.period.end)}
            </span>
            <span className="badge bg-gray-100 text-gray-700">Method: {s.method.label}</span>
            {s.method.model.enabled ? (
              <span className="badge bg-blue-50 text-blue-700">Model on ({s.method.model.name}): suggestions only</span>
            ) : (
              <span className="badge bg-gray-100 text-gray-500">Model off: rules only</span>
            )}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Bank lines" value={String(s.lines)} sub={`${money(s.moneyIn)} in · ${money(Math.abs(s.moneyOut))} out`} />
            <StatCard
              label="Matched"
              value={`${Math.round(s.matched.percent)}%`}
              sub={`${s.matched.automatically} automatically · ${s.matched.afterReview} after review${s.ignored ? ` · ${s.ignored} left out` : ''}`}
              tone="text-green-600"
            />
            <StatCard
              label="Exceptions open"
              value={String(s.exceptions.open)}
              sub={`${s.exceptions.resolved} resolved`}
              tone={s.exceptions.open > 0 ? 'text-amber-600' : 'text-gray-900'}
            />
            <StatCard
              label="Arrears"
              value={money(s.arrears.total)}
              sub={`${s.arrears.tenants.length} tenant${s.arrears.tenants.length === 1 ? '' : 's'} at ${day(s.arrears.asOf)}`}
              tone={s.arrears.total > 0 ? 'text-red-600' : 'text-gray-900'}
            />
          </div>

          {s.exceptions.byReason.length > 0 && (
            <div className="flex flex-wrap gap-2" aria-label="Exceptions by reason">
              {s.exceptions.byReason.map((r) => (
                <span key={r.reason} className={`badge ${REASON_STYLE[r.reason]}`}>
                  {r.label}: {r.open} open{r.resolved ? `, ${r.resolved} resolved` : ''}
                </span>
              ))}
            </div>
          )}

          <ExceptionsPanel lines={allLines} onReview={setReviewing} />
          <ArrearsPanel summary={s} />
          <MatchedPanel lines={allLines} onReview={setReviewing} />
        </>
      ) : (
        <div className="card text-center py-12 text-gray-500">{summary.isError ? errorText(summary.error) : 'Statement not found.'}</div>
      )}

      {reviewing && (
        <ReviewDialog line={reviewing} onClose={() => setReviewing(null)} onSaved={(text) => setNotice({ tone: 'ok', text })} />
      )}
    </div>
  )
}
