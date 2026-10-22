import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { errorMessage } from '../api/documents'
import {
  abstractSample,
  approveLease,
  approveTerm,
  correctTerm,
  downloadLeaseExport,
  getLease,
  getLeaseAudit,
  getLeaseFile,
  getLeaseMethod,
  getLeaseSamples,
  getLeases,
  rejectLease,
  reviewRisk,
  uploadLease,
} from '../api/leaseAbstracts'
import LeasePdf, { Highlight } from '../components/LeasePdf'
import {
  AuditEvent,
  Charge,
  Confidence,
  ExtractedTerm,
  FieldStatus,
  LeaseRecord,
  LeaseStatus,
  ReconciliationLine,
  ReconciliationStatus,
  RiskFinding,
} from '../types/leases'

// ---------------------------------------------------------------------------------------------------------------
// Labels and styles (teal for this page's accents, the app's greys for the rest)

const TABS: { status: LeaseStatus; label: string; empty: string }[] = [
  { status: 'needs_review', label: 'Needs review', empty: 'Nothing is waiting. Upload a lease PDF or pick a sample to start.' },
  { status: 'approved', label: 'Approved', empty: 'No approved leases yet.' },
  { status: 'rejected', label: 'Rejected', empty: 'No rejected leases.' },
]
const ROUTE_LABELS: Record<string, string> = { rules: 'Rules', llm: 'Model', hybrid: 'Model + rules + checks' }
const COUNTRY_LABELS: Record<string, string> = { NZ: 'New Zealand', AU: 'Australia', UK: 'United Kingdom', US: 'United States' }
const CONFIDENCE_STYLES: Record<Confidence, string> = {
  high: 'bg-teal-100 text-teal-800',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-red-100 text-red-700',
}
const STATUS_STYLES: Record<FieldStatus, string> = {
  extracted: 'text-gray-500',
  needs_person: 'bg-red-50 text-red-700 border border-red-200',
  approved: 'bg-teal-50 text-teal-800 border border-teal-200',
  corrected: 'bg-teal-700 text-white',
}
const STATUS_LABELS: Record<FieldStatus, string> = { extracted: 'Read', needs_person: 'Needs a person', approved: 'Approved', corrected: 'Corrected' }
const RISK_STYLES: Record<RiskFinding['severity'], string> = {
  high: 'border-red-200 bg-red-50',
  medium: 'border-amber-200 bg-amber-50',
  low: 'border-gray-200 bg-gray-50',
}
const RECON_STYLES: Record<ReconciliationStatus, string> = {
  matched: 'bg-teal-50 text-teal-800',
  amount_differs: 'bg-amber-100 text-amber-900',
  missing: 'bg-red-100 text-red-800',
  unexpected: 'bg-red-100 text-red-800',
}
const RECON_LABELS: Record<ReconciliationStatus, string> = { matched: 'Matched', amount_differs: 'Amount differs', missing: 'Not invoiced', unexpected: 'Not in the lease' }
const LEASE_STATUS_STYLES: Record<LeaseStatus, string> = {
  needs_review: 'bg-amber-100 text-amber-800',
  approved: 'bg-teal-100 text-teal-800',
  rejected: 'bg-gray-100 text-gray-600',
}
const ACTION_LABELS: Record<string, string> = {
  'lease.extracted': 'Extracted',
  'lease.field_approved': 'Term approved',
  'lease.field_corrected': 'Term corrected',
  'lease.risk_reviewed': 'Risk decided',
  'lease.approved': 'Lease approved',
  'lease.rejected': 'Lease rejected',
}

type FieldType = 'text' | 'date' | 'money' | 'integer' | 'percent' | 'dates' | 'select'
interface FieldDef {
  key: string
  label: string
  type: FieldType
  options?: [string, string][]
  group: string
}

const FIELDS: FieldDef[] = [
  { key: 'leaseRef', label: 'Lease reference', type: 'text', group: 'Parties and premises' },
  { key: 'landlord', label: 'Landlord', type: 'text', group: 'Parties and premises' },
  { key: 'tenant', label: 'Tenant', type: 'text', group: 'Parties and premises' },
  { key: 'guarantor', label: 'Guarantor', type: 'text', group: 'Parties and premises' },
  { key: 'premises', label: 'Premises', type: 'text', group: 'Parties and premises' },
  { key: 'permittedUse', label: 'Permitted use', type: 'text', group: 'Parties and premises' },
  { key: 'commencementDate', label: 'Commencement', type: 'date', group: 'Term' },
  { key: 'expiryDate', label: 'Expiry', type: 'date', group: 'Term' },
  { key: 'termMonths', label: 'Term (months)', type: 'integer', group: 'Term' },
  { key: 'renewalTerms', label: 'Renewal rights', type: 'integer', group: 'Term' },
  { key: 'renewalTermMonths', label: 'Renewal term (months)', type: 'integer', group: 'Term' },
  { key: 'breakNoticeMonths', label: 'Break notice (months)', type: 'integer', group: 'Term' },
  { key: 'breakDate', label: 'Earliest break date', type: 'date', group: 'Term' },
  { key: 'currency', label: 'Currency', type: 'select', options: [['NZD', 'NZD'], ['AUD', 'AUD'], ['GBP', 'GBP'], ['USD', 'USD']], group: 'Money' },
  { key: 'rentAmount', label: 'Rent per period', type: 'money', group: 'Money' },
  { key: 'rentFrequency', label: 'Rent frequency', type: 'select', options: [['weekly', 'Weekly'], ['fortnightly', 'Fortnightly'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['annual', 'Annual']], group: 'Money' },
  { key: 'annualRent', label: 'Annual rent', type: 'money', group: 'Money' },
  { key: 'bondAmount', label: 'Bond / deposit', type: 'money', group: 'Money' },
  { key: 'reviewMechanism', label: 'Rent review', type: 'select', options: [['cpi', 'CPI / index'], ['fixed', 'Fixed %'], ['market', 'Market'], ['none', 'None']], group: 'Money' },
  { key: 'reviewPercent', label: 'Fixed review (%)', type: 'percent', group: 'Money' },
  { key: 'reviewDates', label: 'Review dates', type: 'dates', group: 'Money' },
  { key: 'outgoingsBasis', label: 'Outgoings / service charge / CAM', type: 'select', options: [['tenant_pays', 'Tenant pays all'], ['proportion', 'Tenant pays a share'], ['landlord_pays', 'Landlord pays / gross']], group: 'Money' },
  { key: 'outgoingsAnnual', label: 'Outgoings estimate (annual)', type: 'money', group: 'Money' },
  { key: 'makeGood', label: 'Make good / reinstatement', type: 'select', options: [['tenant_cost', "At the tenant's cost"], ['fair_wear', 'Fair wear and tear'], ['none', 'None']], group: 'Obligations' },
  { key: 'insurance', label: 'Insurance', type: 'select', options: [['landlord', 'Landlord insures'], ['tenant', 'Tenant insures'], ['both', 'Both insure']], group: 'Obligations' },
]
const FIELD_LABELS: Record<string, string> = Object.fromEntries(FIELDS.map(f => [f.key, f.label]))

const money = (n: unknown, currency?: string | null) =>
  typeof n === 'number' ? `${n.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ''}` : '–'
const day = (value: unknown) => {
  if (typeof value !== 'string' || !value) return '–'
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value)
  return Number.isNaN(date.getTime()) ? value : format(date, 'd MMM yyyy')
}
const stamp = (value: string) => format(new Date(value), 'd MMM yyyy, HH:mm')

function showValue(def: FieldDef, term: ExtractedTerm | undefined, currency: string | null): string {
  const v = term?.value
  if (v === null || v === undefined || v === '') return 'Not stated'
  switch (def.type) {
    case 'date':
      return day(v)
    case 'money':
      return money(v, currency)
    case 'percent':
      return `${v}%`
    case 'dates':
      return Array.isArray(v) ? v.map(day).join(', ') : String(v)
    case 'select':
      return def.options?.find(o => o[0] === v)?.[1] ?? String(v)
    default:
      return String(v)
  }
}

const titleOf = (lease: LeaseRecord) => {
  const tenant = lease.terms?.tenant?.value
  const premises = lease.terms?.premises?.value
  return typeof tenant === 'string' && tenant ? `${tenant}${typeof premises === 'string' ? `, ${premises.split(',')[0]}` : ''}` : lease.fileName
}
const needsPerson = (lease: LeaseRecord) => Object.values(lease.terms ?? {}).filter(t => t.status === 'needs_person').length
const openRisks = (lease: LeaseRecord) => (lease.risks ?? []).filter(r => r.status === 'open').length
const mismatches = (lease: LeaseRecord) => {
  const c = lease.reconciliation?.counts
  return c ? c.amount_differs + c.missing + c.unexpected : 0
}

// ---------------------------------------------------------------------------------------------------------------

function ConfidenceBadge({ term }: { term?: ExtractedTerm }) {
  if (!term) return null
  const title = term.source === 'person' ? 'Entered by a person' : term.source === 'rules' ? 'Read by the rules' : term.source === 'llm-repair' ? 'Corrected by the model on a second look' : 'Read by the model'
  return (
    <span className={`badge ${CONFIDENCE_STYLES[term.confidence]}`} title={title}>
      {term.confidence === 'high' ? 'High' : term.confidence === 'medium' ? 'Medium' : 'Low'}
    </span>
  )
}

function PagePill({ term, onClick }: { term?: { page: number | null; quote: string | null }; onClick: (page: number, quote: string | null) => void }) {
  if (!term?.page) return <span className="text-xs text-gray-400">{term?.quote ? 'quoted' : 'inferred'}</span>
  return (
    <button
      type="button"
      onClick={() => onClick(term.page!, term.quote)}
      className="text-xs px-2 py-0.5 rounded-full bg-teal-50 text-teal-800 border border-teal-200 hover:bg-teal-100 whitespace-nowrap"
      title={term.quote ? `"${term.quote}"` : `Page ${term.page}`}
    >
      p. {term.page}
    </button>
  )
}

function TermRow({
  def,
  term,
  currency,
  disabled,
  onHighlight,
  onApprove,
  onCorrect,
}: {
  def: FieldDef
  term?: ExtractedTerm
  currency: string | null
  disabled: boolean
  onHighlight: (page: number, quote: string | null) => void
  onApprove: () => void
  onCorrect: (value: unknown) => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const start = () => {
    const v = term?.value
    setText(v === null || v === undefined ? '' : Array.isArray(v) ? v.join(', ') : String(v))
    setEditing(true)
  }
  const save = () => {
    const t = text.trim()
    let value: unknown = t || null
    if (t) {
      if (def.type === 'money' || def.type === 'percent' || def.type === 'integer') value = Number(t.replace(/[^0-9.-]/g, ''))
      if (def.type === 'dates') value = t.split(/[,;]\s*/).filter(Boolean)
    }
    onCorrect(value)
    setEditing(false)
  }
  const status = term?.status ?? 'extracted'
  const inputId = `term-${def.key}`
  return (
    <tr className={status === 'needs_person' ? 'bg-red-50/40' : ''}>
      <th scope="row" className="py-1.5 pr-2 text-left text-sm font-medium text-gray-700 align-top w-44">
        {def.label}
      </th>
      <td className="py-1.5 pr-2 text-sm text-gray-900 align-top">
        {editing ? (
          <div className="flex gap-1">
            {def.type === 'select' ? (
              <select id={inputId} className="input py-1" value={text} onChange={e => setText(e.target.value)}>
                <option value="">Not stated</option>
                {def.options?.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            ) : (
              <input id={inputId} type={def.type === 'date' ? 'date' : 'text'} className="input py-1" value={text} onChange={e => setText(e.target.value)} aria-label={def.label} />
            )}
            <button type="button" className="btn bg-teal-700 text-white hover:bg-teal-800 py-1" onClick={save}>Save</button>
            <button type="button" className="btn-secondary py-1" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        ) : (
          <span className={term?.value === null || term?.value === undefined ? 'text-gray-400' : ''}>{showValue(def, term, currency)}</span>
        )}
        {term?.quote && !editing && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2" title={term.quote}>"{term.quote}"</p>}
      </td>
      <td className="py-1.5 pr-2 align-top">
        {term?.value === null || term?.value === undefined ? <span className="text-xs text-gray-400">–</span> : <PagePill term={term} onClick={onHighlight} />}
      </td>
      <td className="py-1.5 pr-2 align-top"><ConfidenceBadge term={term} /></td>
      <td className="py-1.5 align-top whitespace-nowrap">
        <span className={`badge ${STATUS_STYLES[status]}`}>{STATUS_LABELS[status]}</span>
        {!disabled && !editing && status !== 'approved' && status !== 'corrected' && (
          <span className="ml-2 inline-flex gap-1">
            <button type="button" className="text-xs text-teal-700 hover:underline" onClick={onApprove} aria-label={`Approve ${def.label}`}>Approve</button>
            <button type="button" className="text-xs text-gray-600 hover:underline" onClick={start} aria-label={`Correct ${def.label}`}>Correct</button>
          </span>
        )}
        {!disabled && !editing && (status === 'approved' || status === 'corrected') && (
          <button type="button" className="ml-2 text-xs text-gray-500 hover:underline" onClick={start} aria-label={`Change ${def.label}`}>Change</button>
        )}
      </td>
    </tr>
  )
}

function Risks({ lease, disabled, onHighlight, onDecide }: { lease: LeaseRecord; disabled: boolean; onHighlight: (page: number, quote: string | null) => void; onDecide: (code: string, status: string) => void }) {
  if (!lease.risks?.length) return <p className="text-sm text-teal-800">The playbook found no risk clauses in this lease.</p>
  return (
    <ul className="space-y-2">
      {lease.risks.map(r => (
        <li key={r.code} className={`border rounded-lg px-3 py-2 text-sm ${RISK_STYLES[r.severity]} ${r.status !== 'open' ? 'opacity-70' : ''}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-gray-900">{r.title}</span>
            <span className="flex items-center gap-2">
              <span className="badge bg-white/70 text-gray-700 capitalize">{r.severity}</span>
              <PagePill term={r} onClick={onHighlight} />
            </span>
          </div>
          <p className="text-gray-700 mt-1">{r.explanation}</p>
          {r.quote && <p className="text-xs text-gray-600 mt-1 italic">"{r.quote}"</p>}
          <div className="mt-1.5 flex items-center gap-3 text-xs">
            <span className="text-gray-600">{r.status === 'open' ? 'Open' : r.status === 'accepted' ? 'Accepted (noted for the owner)' : 'Dismissed'}</span>
            {!disabled && r.status === 'open' && (
              <>
                <button type="button" className="text-teal-800 hover:underline" onClick={() => onDecide(r.code, 'accepted')}>Accept</button>
                <button type="button" className="text-gray-600 hover:underline" onClick={() => onDecide(r.code, 'dismissed')}>Dismiss</button>
              </>
            )}
            {!disabled && r.status !== 'open' && <button type="button" className="text-gray-500 hover:underline" onClick={() => onDecide(r.code, 'open')}>Reopen</button>}
          </div>
        </li>
      ))}
    </ul>
  )
}

function ChargesAndReconciliation({ lease }: { lease: LeaseRecord }) {
  const lines = lease.reconciliation?.lines ?? []
  const charges = lease.charges ?? []
  const counts = lease.reconciliation?.counts
  const lineFor = (c: Charge): ReconciliationLine | undefined =>
    lines.find(l => l.expected && l.expected.kind === c.kind && l.expected.dueDate === c.dueDate && l.expected.amount === c.amount)
  const unexpected = lines.filter(l => l.status === 'unexpected')
  const currency = (lease.terms?.currency?.value as string | null) ?? null
  if (!charges.length) return <p className="text-sm text-gray-600">No charge schedule yet: the commencement date, rent, frequency and currency are needed first.</p>
  return (
    <div className="space-y-3">
      {counts && (
        <p className="text-sm text-gray-700">
          First twelve months{lease.leaseRef ? ` of ${lease.leaseRef}` : ''}: {charges.length} expected charges;{' '}
          <span className="text-teal-800">{counts.matched} matched</span>,{' '}
          <span className={counts.amount_differs ? 'text-amber-800' : ''}>{counts.amount_differs} with a different amount</span>,{' '}
          <span className={counts.missing ? 'text-red-700' : ''}>{counts.missing} not invoiced</span>,{' '}
          <span className={counts.unexpected ? 'text-red-700' : ''}>{counts.unexpected} invoiced but not in the lease</span>.
        </p>
      )}
      <div className="max-h-[48vh] overflow-y-auto border border-gray-200 rounded-lg">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="text-left font-medium px-2 py-1.5">Due</th>
              <th className="text-left font-medium px-2 py-1.5">Charge</th>
              <th className="text-right font-medium px-2 py-1.5">Expected</th>
              <th className="text-left font-medium px-2 py-1.5">Invoice</th>
              <th className="text-left font-medium px-2 py-1.5">Result</th>
            </tr>
          </thead>
          <tbody>
            {charges.map((c, i) => {
              const l = lineFor(c)
              const status = l?.status ?? 'missing'
              return (
                <tr key={i} className="border-t border-gray-100">
                  <td className="px-2 py-1 whitespace-nowrap">{day(c.dueDate)}</td>
                  <td className="px-2 py-1">{c.description}</td>
                  <td className="px-2 py-1 text-right whitespace-nowrap">{money(c.amount, c.currency)}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{l?.invoice ? `${l.invoice.invoiceNumber} (row ${l.invoice.row}): ${money(l.invoice.amount)}` : <span className="text-gray-400">none</span>}</td>
                  <td className="px-2 py-1"><span className={`badge ${RECON_STYLES[status]}`}>{RECON_LABELS[status]}</span></td>
                </tr>
              )
            })}
            {unexpected.map((l, i) => (
              <tr key={`u${i}`} className="border-t border-gray-100 bg-red-50/40">
                <td className="px-2 py-1 whitespace-nowrap">{day(l.invoice!.dueDate)}</td>
                <td className="px-2 py-1">{l.invoice!.description}</td>
                <td className="px-2 py-1 text-right text-gray-400">–</td>
                <td className="px-2 py-1 whitespace-nowrap">{l.invoice!.invoiceNumber} (row {l.invoice!.row}): {money(l.invoice!.amount, l.invoice!.currency)}</td>
                <td className="px-2 py-1"><span className={`badge ${RECON_STYLES.unexpected}`}>{RECON_LABELS.unexpected}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {currency && <p className="text-xs text-gray-500">Amounts in {currency}. Invoices come from the billing system's export; the row number is the line in that file.</p>}
    </div>
  )
}

function AuditTrail({ id }: { id: number }) {
  const { data, isLoading } = useQuery({ queryKey: ['lease-audit', id], queryFn: () => getLeaseAudit(id) })
  if (isLoading) return <p className="text-sm text-gray-500">Loading...</p>
  if (!data?.length) return <p className="text-sm text-gray-500">No events yet.</p>
  const show = (v: unknown) => (v === null || v === undefined ? 'nothing' : typeof v === 'object' ? JSON.stringify(v) : String(v))
  return (
    <ol className="space-y-2">
      {data.map((e: AuditEvent) => (
        <li key={e.id} className="text-sm border-l-2 border-teal-200 pl-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-gray-900">{ACTION_LABELS[e.action] ?? e.action}{e.field ? `: ${FIELD_LABELS[e.field] ?? e.field}` : ''}</span>
            <span className="text-xs text-gray-500 whitespace-nowrap">{e.user.name} · {stamp(e.createdAt)}</span>
          </div>
          {e.note && <p className="text-gray-700">{e.note}</p>}
          {e.action === 'lease.field_corrected' && <p className="text-xs text-gray-500">Before: {show(e.before)} · After: {show(e.after)}</p>}
        </li>
      ))}
    </ol>
  )
}

// ---------------------------------------------------------------------------------------------------------------

type Tab = 'terms' | 'risks' | 'charges' | 'audit'

function Review({ id, onClose, onDone }: { id: number; onClose: () => void; onDone: (text: string) => void }) {
  const qc = useQueryClient()
  const { data: lease, isLoading, isError } = useQuery({ queryKey: ['leases', id], queryFn: () => getLease(id) })
  const [blob, setBlob] = useState<Blob | null>(null)
  const [highlight, setHighlight] = useState<Highlight | null>(null)
  const [tab, setTab] = useState<Tab>('terms')
  const [actionError, setActionError] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const openedAt = useRef(Date.now())
  const nonce = useRef(0)

  useEffect(() => {
    let cancelled = false
    setBlob(null)
    getLeaseFile(id).then(b => {
      if (!cancelled) setBlob(new Blob([b], { type: 'application/pdf' }))
    })
    return () => {
      cancelled = true
    }
  }, [id])

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['leases'] })
    qc.invalidateQueries({ queryKey: ['lease-audit', id] })
  }
  const reviewSeconds = () => Math.round((Date.now() - openedAt.current) / 1000)
  const onHighlight = (page: number, quote: string | null) => setHighlight({ page, quote, nonce: ++nonce.current })

  const act = useMutation({
    mutationFn: (fn: () => Promise<LeaseRecord>) => fn(),
    onSuccess: updated => {
      qc.setQueryData(['leases', id], updated)
      refresh()
      setActionError(null)
    },
    onError: async e => setActionError(await errorMessage(e)),
  })
  const approve = useMutation({
    mutationFn: () => approveLease(id, reviewSeconds()),
    onSuccess: () => {
      refresh()
      onDone('Lease approved. The terms, risks and charge schedule are recorded.')
    },
    onError: async e => setActionError(await errorMessage(e)),
  })
  const reject = useMutation({
    mutationFn: () => rejectLease(id, reviewSeconds(), reason),
    onSuccess: () => {
      refresh()
      onDone('Lease rejected.')
    },
    onError: async e => setActionError(await errorMessage(e)),
  })

  if (isLoading) return <div className="card text-gray-500">Loading...</div>
  if (isError || !lease) return <div className="card text-red-700">This lease could not be loaded.</div>

  const disabled = lease.status !== 'needs_review'
  const currency = (lease.terms?.currency?.value as string | null) ?? null
  const pending = needsPerson(lease)
  const alarms = (lease.issues ?? []).filter(i => i.severity !== 'info')
  const groups = [...new Set(FIELDS.map(f => f.group))]

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <button type="button" onClick={onClose} className="text-sm text-teal-700 hover:underline">&larr; All leases</button>
          <h1 className="text-xl font-bold text-gray-900 mt-1">{titleOf(lease)}</h1>
          <p className="text-sm text-gray-500">
            {lease.fileName} · {COUNTRY_LABELS[lease.country ?? ''] ?? lease.country} · {lease.leaseType} · read by {ROUTE_LABELS[lease.route] ?? lease.route}
            {lease.property ? ` · matched to ${lease.property.address}, ${lease.property.suburb}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`badge ${LEASE_STATUS_STYLES[lease.status]}`}>{TABS.find(t => t.status === lease.status)?.label}</span>
          <button type="button" className="btn-secondary" onClick={() => downloadLeaseExport(id, 'json')}>Export JSON</button>
          <button type="button" className="btn-secondary" onClick={() => downloadLeaseExport(id, 'csv')}>Export CSV</button>
        </div>
      </div>

      {actionError && <div className="border border-red-200 bg-red-50 text-red-800 rounded-lg px-3 py-2 text-sm">{actionError}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-4">
        <div className="xl:sticky xl:top-0 self-start">
          <LeasePdf blob={blob} highlight={highlight} />
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-1 border-b border-gray-200" role="tablist">
            {(
              [
                ['terms', `Terms${pending ? ` (${pending} need a person)` : ''}`],
                ['risks', `Risks (${openRisks(lease)} open)`],
                ['charges', `Charges${mismatches(lease) ? ` (${mismatches(lease)} to check)` : ''}`],
                ['audit', 'Audit trail'],
              ] as [Tab, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === key ? 'border-teal-700 text-teal-800' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'terms' && (
            <div className="card p-4 space-y-3">
              {alarms.length > 0 && (
                <ul className="space-y-1">
                  {alarms.map((i, k) => (
                    <li key={k} className={`text-sm rounded-lg px-3 py-1.5 border ${i.severity === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
                      <span className="font-semibold">{i.severity === 'error' ? 'Problem' : 'Check'}:</span> {i.message}
                    </li>
                  ))}
                </ul>
              )}
              {alarms.length === 0 && <p className="text-sm text-teal-800">All checks passed: the dates are consistent, the rent agrees with the annual figure and the currency matches the country.</p>}
              <table className="w-full">
                <thead>
                  <tr className="text-xs text-gray-500">
                    <th className="text-left font-medium pb-1">Term</th>
                    <th className="text-left font-medium pb-1">Value and source text</th>
                    <th className="text-left font-medium pb-1">Page</th>
                    <th className="text-left font-medium pb-1">Confidence</th>
                    <th className="text-left font-medium pb-1">Status</th>
                  </tr>
                </thead>
                {groups.map(group => (
                  <tbody key={group}>
                    <tr>
                      <td colSpan={5} className="pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-teal-800">{group}</td>
                    </tr>
                    {FIELDS.filter(f => f.group === group).map(def => (
                      <TermRow
                        key={def.key}
                        def={def}
                        term={lease.terms?.[def.key]}
                        currency={currency}
                        disabled={disabled}
                        onHighlight={onHighlight}
                        onApprove={() => act.mutate(() => approveTerm(id, def.key))}
                        onCorrect={value => act.mutate(() => correctTerm(id, def.key, value))}
                      />
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          )}
          {tab === 'risks' && (
            <div className="card p-4">
              <Risks lease={lease} disabled={disabled} onHighlight={onHighlight} onDecide={(code, status) => act.mutate(() => reviewRisk(id, code, status))} />
            </div>
          )}
          {tab === 'charges' && (
            <div className="card p-4">
              <ChargesAndReconciliation lease={lease} />
            </div>
          )}
          {tab === 'audit' && (
            <div className="card p-4">
              <AuditTrail id={id} />
            </div>
          )}

          {!disabled && (
            <div className="card p-4 flex flex-wrap items-center gap-3">
              <button type="button" className="btn bg-teal-700 text-white hover:bg-teal-800 focus:ring-teal-500" onClick={() => approve.mutate()} disabled={approve.isPending}>
                Approve lease
              </button>
              <span className="text-sm text-gray-600">{pending ? `${pending} term${pending > 1 ? 's' : ''} still need a person.` : 'Every term that needed a person has been approved or corrected.'}</span>
              <span className="flex-1" />
              {!rejecting ? (
                <button type="button" className="btn-secondary" onClick={() => setRejecting(true)}>Reject</button>
              ) : (
                <span className="flex items-center gap-2">
                  <input className="input py-1 w-64" placeholder="Reason (optional)" value={reason} onChange={e => setReason(e.target.value)} aria-label="Rejection reason" />
                  <button type="button" className="btn-danger py-1" onClick={() => reject.mutate()} disabled={reject.isPending}>Confirm reject</button>
                  <button type="button" className="btn-secondary py-1" onClick={() => setRejecting(false)}>Cancel</button>
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------

export default function Leases() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<LeaseStatus>('needs_review')
  const [selected, setSelected] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sample, setSample] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const { data: leases = [], isLoading } = useQuery({ queryKey: ['leases'], queryFn: getLeases })
  const { data: method } = useQuery({ queryKey: ['lease-method'], queryFn: getLeaseMethod })
  const { data: samples = [] } = useQuery({ queryKey: ['lease-samples'], queryFn: getLeaseSamples })

  const add = useMutation({
    mutationFn: (fn: () => Promise<LeaseRecord>) => fn(),
    onSuccess: lease => {
      qc.invalidateQueries({ queryKey: ['leases'] })
      setError(null)
      setNotice(`${lease.fileName} read by ${ROUTE_LABELS[lease.route] ?? lease.route}: ${needsPerson(lease)} terms need a person, ${lease.risks?.length ?? 0} risk clauses, ${mismatches(lease)} charges to check.`)
      setSelected(lease.id)
    },
    onError: async e => setError(await errorMessage(e, 'The lease could not be read.')),
  })

  const shown = useMemo(() => leases.filter(l => l.status === tab), [leases, tab])
  const counts = useMemo(() => Object.fromEntries(TABS.map(t => [t.status, leases.filter(l => l.status === t.status).length])), [leases])

  if (selected !== null) {
    return (
      <Review
        id={selected}
        onClose={() => setSelected(null)}
        onDone={text => {
          setNotice(text)
          setSelected(null)
        }}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leases</h1>
          <p className="text-sm text-gray-500 mt-1">
            Commercial and residential leases from New Zealand, Australia, the UK and the US: the key terms with their page and source text, the risk clauses, the charge schedule and a check against the invoices raised.
            {method && <> New uploads are read by <span className="font-medium">{ROUTE_LABELS[method.route]}</span>{method.model ? ` (${method.model})` : ''}.</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select className="input py-1.5 w-72" value={sample} onChange={e => setSample(e.target.value)} aria-label="Pick a sample lease">
            <option value="">Pick a sample lease...</option>
            {samples.filter(s => s.available).map(s => (
              <option key={s.file} value={s.file}>{s.country} · {s.leaseType} · {s.title}</option>
            ))}
          </select>
          <button type="button" className="btn-secondary" disabled={!sample || add.isPending} onClick={() => add.mutate(() => abstractSample(sample))}>
            Abstract sample
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) add.mutate(() => uploadLease(f))
              e.target.value = ''
            }}
          />
          <button type="button" className="btn bg-teal-700 text-white hover:bg-teal-800 focus:ring-teal-500" disabled={add.isPending} onClick={() => fileInput.current?.click()}>
            {add.isPending ? 'Reading...' : 'Upload a lease PDF'}
          </button>
        </div>
      </div>

      {notice && <div className="border border-teal-200 bg-teal-50 text-teal-900 rounded-lg px-3 py-2 text-sm flex justify-between"><span>{notice}</span><button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">&times;</button></div>}
      {error && <div className="border border-red-200 bg-red-50 text-red-800 rounded-lg px-3 py-2 text-sm">{error}</div>}

      <div className="flex gap-1 border-b border-gray-200" role="tablist">
        {TABS.map(t => (
          <button
            key={t.status}
            type="button"
            role="tab"
            aria-selected={tab === t.status}
            onClick={() => setTab(t.status)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t.status ? 'border-teal-700 text-teal-800' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
          >
            {t.label} <span className="text-gray-400">({counts[t.status] ?? 0})</span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="card text-gray-500">Loading...</div>
      ) : shown.length === 0 ? (
        <div className="card text-gray-500">{TABS.find(t => t.status === tab)?.empty}</div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="text-left font-medium px-4 py-2">Lease</th>
                <th className="text-left font-medium px-4 py-2">Country</th>
                <th className="text-left font-medium px-4 py-2">Type</th>
                <th className="text-left font-medium px-4 py-2">Rent</th>
                <th className="text-left font-medium px-4 py-2">Term</th>
                <th className="text-left font-medium px-4 py-2">Needs a person</th>
                <th className="text-left font-medium px-4 py-2">Risks</th>
                <th className="text-left font-medium px-4 py-2">Charges to check</th>
                <th className="text-left font-medium px-4 py-2">Received</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(l => {
                const t = l.terms ?? {}
                const n = needsPerson(l)
                const r = openRisks(l)
                const m = mismatches(l)
                return (
                  <tr key={l.id} className="border-t border-gray-100 hover:bg-teal-50/40 cursor-pointer" onClick={() => setSelected(l.id)}>
                    <td className="px-4 py-2">
                      <button type="button" className="text-left font-medium text-gray-900 hover:text-teal-800" onClick={() => setSelected(l.id)}>{titleOf(l)}</button>
                      <p className="text-xs text-gray-500">{l.fileName}{l.leaseRef ? ` · ${l.leaseRef}` : ''}</p>
                    </td>
                    <td className="px-4 py-2">{l.country}</td>
                    <td className="px-4 py-2 capitalize">{l.leaseType}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{money(t.rentAmount?.value, t.currency?.value as string | null)}{t.rentFrequency?.value ? ` ${String(t.rentFrequency.value)}` : ''}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{day(t.commencementDate?.value)} – {day(t.expiryDate?.value)}</td>
                    <td className="px-4 py-2">{n ? <span className="badge bg-red-100 text-red-700">{n}</span> : <span className="badge bg-teal-100 text-teal-800">0</span>}</td>
                    <td className="px-4 py-2">{r ? <span className="badge bg-amber-100 text-amber-800">{r}</span> : <span className="text-gray-400">none</span>}</td>
                    <td className="px-4 py-2">{m ? <span className="badge bg-amber-100 text-amber-800">{m}</span> : <span className="text-gray-400">0</span>}</td>
                    <td className="px-4 py-2 whitespace-nowrap text-gray-500">{day(l.createdAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
