import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  approveDocument,
  downloadXeroBills,
  errorMessage,
  getDocument,
  getDocumentFile,
  getDocuments,
  getExtractionMethod,
  pushDocument,
  rejectDocument,
  uploadDocument,
} from '../api/documents'
import {
  Confidence,
  DocumentIssue,
  DocumentRecord,
  DocumentStatus,
  ExtractedField,
  ExtractionMethod,
  FieldSource,
  IssueSeverity,
  LineItem,
} from '../types/documents'

const TABS: { status: DocumentStatus; label: string; empty: string }[] = [
  { status: 'needs_review', label: 'Needs review', empty: 'Nothing is waiting. Upload a supplier invoice or a tenancy summary PDF to start.' },
  { status: 'approved', label: 'Approved', empty: 'No approved documents. Approved invoices wait here until you export them.' },
  { status: 'exported', label: 'Exported', empty: 'Nothing has been exported yet.' },
  { status: 'rejected', label: 'Rejected', empty: 'No rejected documents.' },
]

const METHOD_LABELS: Record<ExtractionMethod, string> = {
  rules: 'Rules',
  llm: 'Model',
  'llm+validation': 'Model + validation',
}
const SOURCE_LABELS: Record<FieldSource, string> = {
  rules: 'read by the rules',
  llm: 'read by the model',
  'llm-repair': 'corrected by the model on a second look',
  person: 'entered by you',
}
const CONFIDENCE_STYLES: Record<Confidence, string> = {
  high: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-red-100 text-red-700',
}
const SEVERITY_STYLES: Record<IssueSeverity, string> = {
  error: 'border-red-200 bg-red-50 text-red-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  info: 'border-gray-200 bg-gray-50 text-gray-700',
}
const SEVERITY_LABELS: Record<IssueSeverity, string> = { error: 'Problem', warning: 'Check', info: 'Note' }
const STATUS_STYLES: Record<DocumentStatus, string> = {
  needs_review: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-blue-100 text-blue-700',
  exported: 'bg-green-100 text-green-700',
  rejected: 'bg-gray-100 text-gray-600',
}
const STATUS_LABELS: Record<DocumentStatus, string> = {
  needs_review: 'Needs review',
  approved: 'Approved',
  exported: 'Exported',
  rejected: 'Rejected',
}

type FieldType = 'text' | 'date' | 'money' | 'names' | 'endDate' | 'frequency' | 'yesno' | 'integer'
interface FieldDef {
  key: string
  label: string
  type: FieldType
  hint?: string
}

const INVOICE_FIELDS: FieldDef[] = [
  { key: 'supplierName', label: 'Supplier', type: 'text' },
  { key: 'supplierGstNumber', label: 'GST number', type: 'text', hint: 'For example 123-456-789' },
  { key: 'supplierBankAccount', label: 'Bank account', type: 'text' },
  { key: 'invoiceNumber', label: 'Invoice number', type: 'text' },
  { key: 'invoiceDate', label: 'Invoice date', type: 'date' },
  { key: 'dueDate', label: 'Due date', type: 'date' },
  { key: 'propertyAddress', label: 'Property address', type: 'text' },
  { key: 'subtotal', label: 'Subtotal (excl. GST)', type: 'money' },
  { key: 'gst', label: 'GST', type: 'money' },
  { key: 'total', label: 'Total (incl. GST)', type: 'money' },
]

const LEASE_FIELDS: FieldDef[] = [
  { key: 'tenantNames', label: 'Tenant names', type: 'names', hint: 'Separate names with commas' },
  { key: 'propertyAddress', label: 'Property address', type: 'text' },
  { key: 'startDate', label: 'Start date', type: 'date' },
  { key: 'endDate', label: 'End date', type: 'endDate' },
  { key: 'weeklyRent', label: 'Weekly rent', type: 'money' },
  { key: 'bond', label: 'Bond', type: 'money' },
  { key: 'rentFrequency', label: 'Rent paid', type: 'frequency' },
  { key: 'petsAllowed', label: 'Pets allowed', type: 'yesno' },
  { key: 'maxOccupants', label: 'Maximum occupants', type: 'integer' },
]

const FIELD_LABELS: Record<string, string> = Object.fromEntries(
  [...INVOICE_FIELDS, ...LEASE_FIELDS, { key: 'lineItems', label: 'Line items', type: 'text' as const }].map(f => [f.key, f.label]),
)

const money = (n: unknown) =>
  typeof n === 'number' ? `$${n.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '–'
const day = (value: unknown) => {
  if (typeof value !== 'string' || !value) return '–'
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value)
  return Number.isNaN(date.getTime()) ? value : format(date, 'd MMM yyyy')
}
const valueOf = (doc: DocumentRecord, key: string) => doc.extracted?.[key]?.value ?? null
const alarms = (doc: DocumentRecord) => (doc.issues ?? []).filter(i => i.severity !== 'info' && i.code !== 'rejected')

function titleOf(doc: DocumentRecord): string {
  if (doc.kind === 'lease') {
    const names = valueOf(doc, 'tenantNames')
    return Array.isArray(names) && names.length ? `Tenancy summary: ${names.join(' and ')}` : 'Tenancy summary'
  }
  const supplier = doc.contractor?.name ?? (valueOf(doc, 'supplierName') as string | null) ?? 'Unknown supplier'
  const number = valueOf(doc, 'invoiceNumber')
  return number ? `${supplier}, invoice ${number}` : `Invoice from ${supplier}`
}

// ---------------------------------------------------------------------------------------------------------------
// Form state: every field as text, converted back to typed values on approval.

interface LineDraft {
  description: string
  quantity: string
  unitAmount: string
  amount: string
}
interface FormState {
  values: Record<string, string>
  periodic: boolean
  lines: LineDraft[]
}

const numText = (n: unknown, decimals?: number) =>
  typeof n === 'number' ? (decimals === undefined ? String(n) : n.toFixed(decimals)) : ''

function toForm(doc: DocumentRecord): FormState {
  const defs = doc.kind === 'invoice' ? INVOICE_FIELDS : LEASE_FIELDS
  const values: Record<string, string> = {}
  let periodic = false
  for (const def of defs) {
    const v = valueOf(doc, def.key)
    switch (def.type) {
      case 'money':
        values[def.key] = numText(v, 2)
        break
      case 'integer':
        values[def.key] = numText(v)
        break
      case 'names':
        values[def.key] = Array.isArray(v) ? v.join(', ') : ''
        break
      case 'yesno':
        values[def.key] = v === true ? 'yes' : v === false ? 'no' : ''
        break
      case 'endDate':
        periodic = v === 'periodic'
        values[def.key] = typeof v === 'string' && v !== 'periodic' ? v : ''
        break
      default:
        values[def.key] = typeof v === 'string' ? v : ''
    }
  }
  const items = valueOf(doc, 'lineItems')
  const lines = Array.isArray(items)
    ? (items as LineItem[]).map(l => ({
        description: l.description ?? '',
        quantity: numText(l.quantity),
        unitAmount: numText(l.unitAmount),
        amount: numText(l.amount, 2),
      }))
    : []
  return { values, periodic, lines }
}

const parseAmount = (text: string): number | null | 'invalid' => {
  const cleaned = text.replace(/[$,\s]/g, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 'invalid'
}

function fromForm(doc: DocumentRecord, form: FormState): { fields: Record<string, unknown>; errors: string[] } {
  const defs = doc.kind === 'invoice' ? INVOICE_FIELDS : LEASE_FIELDS
  const fields: Record<string, unknown> = {}
  const errors: string[] = []
  for (const def of defs) {
    const text = (form.values[def.key] ?? '').trim()
    switch (def.type) {
      case 'money': {
        const n = parseAmount(text)
        if (n === 'invalid') errors.push(`${def.label} must be an amount.`)
        else fields[def.key] = n
        break
      }
      case 'integer': {
        if (!text) fields[def.key] = null
        else if (/^\d+$/.test(text)) fields[def.key] = Number(text)
        else errors.push(`${def.label} must be a whole number.`)
        break
      }
      case 'names': {
        const names = text.split(',').map(n => n.trim()).filter(Boolean)
        fields[def.key] = names.length ? names : null
        break
      }
      case 'yesno':
        fields[def.key] = text === 'yes' ? true : text === 'no' ? false : null
        break
      case 'endDate':
        fields[def.key] = form.periodic ? 'periodic' : text || null
        break
      default:
        fields[def.key] = text || null
    }
  }
  if (doc.kind === 'invoice') {
    const lines: LineItem[] = []
    form.lines.forEach((l, i) => {
      if (!l.description.trim() && !l.amount.trim()) return
      const amount = parseAmount(l.amount)
      const quantity = parseAmount(l.quantity)
      const unitAmount = parseAmount(l.unitAmount)
      if (amount === null || amount === 'invalid') errors.push(`Line ${i + 1} needs an amount.`)
      else if (quantity === 'invalid' || unitAmount === 'invalid') errors.push(`Line ${i + 1} has a quantity or unit price that isn't a number.`)
      else if (!l.description.trim()) errors.push(`Line ${i + 1} needs a description.`)
      else lines.push({ description: l.description.trim(), quantity, unitAmount, amount })
    })
    fields.lineItems = lines.length ? lines : null
  }
  return { fields, errors }
}

// ---------------------------------------------------------------------------------------------------------------

function ConfidenceBadge({ field }: { field?: ExtractedField }) {
  if (!field) return null
  if (field.source === 'person') return <span className="badge bg-blue-100 text-blue-700">Entered by you</span>
  return (
    <span className={`badge ${CONFIDENCE_STYLES[field.confidence]}`} title={`This value was ${SOURCE_LABELS[field.source]}.`}>
      {field.confidence === 'high' ? 'High' : field.confidence === 'medium' ? 'Medium' : 'Low'} confidence
    </span>
  )
}

function IssueList({ issues }: { issues: DocumentIssue[] }) {
  const shown = issues.filter(i => i.code !== 'rejected')
  const rejected = issues.find(i => i.code === 'rejected')
  const problems = shown.filter(i => i.severity !== 'info')
  return (
    <section aria-labelledby="checks-heading" className="card">
      <h2 id="checks-heading" className="font-semibold text-gray-900 mb-3">Checks</h2>
      {problems.length === 0 && (
        <p className="text-sm text-green-700 mb-2">
          All checks passed: the amounts add up, the GST number is valid and the document matches the records.
        </p>
      )}
      <ul className="space-y-2">
        {shown.map((issue, i) => (
          <li key={i} className={`border rounded-lg px-3 py-2 text-sm ${SEVERITY_STYLES[issue.severity]}`}>
            <span className="font-semibold">{SEVERITY_LABELS[issue.severity]}:</span> {issue.message}
          </li>
        ))}
        {rejected && <li className={`border rounded-lg px-3 py-2 text-sm ${SEVERITY_STYLES.info}`}>{rejected.message}</li>}
      </ul>
    </section>
  )
}

function Links({ doc }: { doc: DocumentRecord }) {
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex gap-3 text-sm py-1.5 border-b border-gray-100 last:border-0">
      <dt className="w-28 shrink-0 text-gray-500">{label}</dt>
      <dd className="text-gray-900">{value}</dd>
    </div>
  )
  const none = (text: string) => <span className="text-gray-400">{text}</span>
  const noJobNeeded = doc.contractor && ['insurance', 'utilities'].includes(doc.contractor.trade)
  return (
    <section aria-labelledby="links-heading" className="card">
      <h2 id="links-heading" className="font-semibold text-gray-900 mb-2">Matched records</h2>
      <dl>
        {row('Property', doc.property ? `${doc.property.address}, ${doc.property.suburb}` : none('Not matched to a property'))}
        {doc.kind === 'invoice' && (
          <>
            {row(
              'Contractor',
              doc.contractor
                ? `${doc.contractor.name}${doc.contractor.gstNumber ? ` (GST ${doc.contractor.gstNumber})` : ''}`
                : none('Not matched to a contractor'),
            )}
            {row(
              'Job',
              doc.maintenanceRequest
                ? `${doc.maintenanceRequest.title}: quote ${money(doc.maintenanceRequest.quoteAmount)}, ${doc.maintenanceRequest.status.replace('_', ' ')}`
                : noJobNeeded
                  ? none('Not needed for utilities and insurance')
                  : none('No maintenance job matched'),
            )}
          </>
        )}
        {doc.kind === 'lease' &&
          row(
            'Lease',
            doc.lease
              ? `${doc.lease.tenant.firstName} ${doc.lease.tenant.lastName}: ${money(doc.lease.weeklyRent)} a week, bond ${money(doc.lease.bondAmount)} (${doc.lease.status})`
              : none('No lease matched'),
          )}
      </dl>
    </section>
  )
}

function PdfViewer({ id, fileName }: { id: number; fileName: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    setUrl(null)
    setError(null)
    getDocumentFile(id)
      .then(blob => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }))
        setUrl(objectUrl)
      })
      .catch(async e => {
        if (!cancelled) setError(await errorMessage(e, 'The PDF could not be loaded.'))
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [id])

  if (error) return <div className="card text-sm text-red-700">{error}</div>
  if (!url) return <div className="card h-[78vh] flex items-center justify-center text-gray-400">Loading the PDF...</div>
  return (
    <div className="space-y-2">
      <iframe title={`Original document: ${fileName}`} src={url} className="w-full h-[78vh] rounded-xl border border-gray-200 bg-white" />
      <a href={url} target="_blank" rel="noreferrer" className="text-sm text-blue-600 hover:underline">
        Open the PDF in a new tab
      </a>
    </div>
  )
}

function FieldInput({
  def,
  form,
  setForm,
  disabled,
  flagged,
}: {
  def: FieldDef
  form: FormState
  setForm: (f: FormState) => void
  disabled: boolean
  flagged: boolean
}) {
  const id = `field-${def.key}`
  const value = form.values[def.key] ?? ''
  const set = (v: string) => setForm({ ...form, values: { ...form.values, [def.key]: v } })
  const cls = `input ${flagged ? 'border-red-300 bg-red-50' : ''}`
  switch (def.type) {
    case 'date':
      return <input id={id} type="date" className={cls} value={value} onChange={e => set(e.target.value)} disabled={disabled} />
    case 'money':
      return (
        <div className="relative">
          <span className="absolute left-3 top-2 text-sm text-gray-400" aria-hidden="true">$</span>
          <input id={id} inputMode="decimal" className={`${cls} pl-6`} value={value} onChange={e => set(e.target.value)} disabled={disabled} />
        </div>
      )
    case 'integer':
      return <input id={id} inputMode="numeric" className={cls} value={value} onChange={e => set(e.target.value)} disabled={disabled} />
    case 'frequency':
      return (
        <select id={id} className={cls} value={value} onChange={e => set(e.target.value)} disabled={disabled}>
          <option value="">Not stated</option>
          <option value="weekly">Weekly</option>
          <option value="fortnightly">Fortnightly</option>
          <option value="monthly">Monthly</option>
        </select>
      )
    case 'yesno':
      return (
        <select id={id} className={cls} value={value} onChange={e => set(e.target.value)} disabled={disabled}>
          <option value="">Not stated</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      )
    case 'endDate':
      return (
        <div className="flex items-center gap-3">
          <input
            id={id}
            type="date"
            className={cls}
            value={value}
            onChange={e => set(e.target.value)}
            disabled={disabled || form.periodic}
          />
          <label className="flex items-center gap-1.5 text-sm text-gray-700 shrink-0">
            <input
              type="checkbox"
              checked={form.periodic}
              onChange={e => setForm({ ...form, periodic: e.target.checked })}
              disabled={disabled}
            />
            Periodic
          </label>
        </div>
      )
    default:
      return <input id={id} className={cls} value={value} onChange={e => set(e.target.value)} disabled={disabled} />
  }
}

function LineItemsEditor({
  form,
  setForm,
  disabled,
  field,
  flagged,
}: {
  form: FormState
  setForm: (f: FormState) => void
  disabled: boolean
  field?: ExtractedField
  flagged: boolean
}) {
  const update = (i: number, key: keyof LineDraft, v: string) =>
    setForm({ ...form, lines: form.lines.map((l, j) => (j === i ? { ...l, [key]: v } : l)) })
  const sum = form.lines.reduce((s, l) => {
    const n = parseAmount(l.amount)
    return typeof n === 'number' ? s + n : s
  }, 0)
  return (
    <fieldset className={`rounded-lg border p-3 ${flagged ? 'border-red-300' : 'border-gray-200'}`}>
      <legend className="px-1 text-sm font-medium text-gray-700 flex items-center gap-2">
        Line items (excl. GST) <ConfidenceBadge field={field} />
      </legend>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500">
            <th className="font-medium pb-1">Description</th>
            <th className="font-medium pb-1 w-16">Qty</th>
            <th className="font-medium pb-1 w-24">Unit</th>
            <th className="font-medium pb-1 w-24">Amount</th>
            <th className="w-8"><span className="sr-only">Remove</span></th>
          </tr>
        </thead>
        <tbody>
          {form.lines.map((l, i) => (
            <tr key={i}>
              <td className="pr-1 py-0.5">
                <input aria-label={`Line ${i + 1} description`} className="input py-1" value={l.description} onChange={e => update(i, 'description', e.target.value)} disabled={disabled} />
              </td>
              <td className="pr-1 py-0.5">
                <input aria-label={`Line ${i + 1} quantity`} inputMode="decimal" className="input py-1" value={l.quantity} onChange={e => update(i, 'quantity', e.target.value)} disabled={disabled} />
              </td>
              <td className="pr-1 py-0.5">
                <input aria-label={`Line ${i + 1} unit price`} inputMode="decimal" className="input py-1" value={l.unitAmount} onChange={e => update(i, 'unitAmount', e.target.value)} disabled={disabled} />
              </td>
              <td className="pr-1 py-0.5">
                <input aria-label={`Line ${i + 1} amount`} inputMode="decimal" className="input py-1" value={l.amount} onChange={e => update(i, 'amount', e.target.value)} disabled={disabled} />
              </td>
              <td className="py-0.5 text-center">
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) })}
                    className="p-1 text-gray-400 hover:text-red-600 rounded"
                    aria-label={`Remove line ${i + 1}`}
                  >
                    &times;
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center justify-between mt-2 text-sm">
        {!disabled ? (
          <button
            type="button"
            className="text-blue-600 hover:underline"
            onClick={() => setForm({ ...form, lines: [...form.lines, { description: '', quantity: '1', unitAmount: '', amount: '' }] })}
          >
            Add a line
          </button>
        ) : (
          <span />
        )}
        <span className="text-gray-600">Lines add up to {money(Math.round(sum * 100) / 100)}</span>
      </div>
    </fieldset>
  )
}

function Review({ id, onClose, onDone }: { id: number; onClose: () => void; onDone: (text: string) => void }) {
  const qc = useQueryClient()
  const { data: doc, isLoading, isError } = useQuery({ queryKey: ['documents', id], queryFn: () => getDocument(id) })
  const openedAt = useRef(Date.now())
  const [elapsed, setElapsed] = useState(0)
  const [form, setForm] = useState<FormState | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const initial = useMemo(() => (doc ? toForm(doc) : null), [doc])

  useEffect(() => {
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - openedAt.current) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (initial && !form) setForm(initial)
  }, [initial, form])

  const reviewSeconds = () => Math.round((Date.now() - openedAt.current) / 1000)
  const refresh = () => qc.invalidateQueries({ queryKey: ['documents'] })

  const approve = useMutation({
    mutationFn: (fields: Record<string, unknown>) => approveDocument(id, fields, reviewSeconds()),
    onSuccess: res => {
      refresh()
      const corrected = res.changedFields.map(f => FIELD_LABELS[f] ?? f)
      onDone(
        corrected.length
          ? `Approved with ${corrected.length} correction${corrected.length > 1 ? 's' : ''} (${corrected.join(', ')}). Nothing was paid or sent.`
          : 'Approved. Nothing was paid or sent.',
      )
    },
    onError: async e => setActionError(await errorMessage(e)),
  })
  const reject = useMutation({
    mutationFn: () => rejectDocument(id, reviewSeconds(), reason.trim() || undefined),
    onSuccess: () => {
      refresh()
      onDone('Rejected. It stays in the Rejected tab for the record.')
    },
    onError: async e => setActionError(await errorMessage(e)),
  })
  const push = useMutation({
    mutationFn: () => pushDocument(id),
    onSuccess: res => {
      refresh()
      onDone(`Sent to ${res.adapter} as draft bill ${res.bill.id}. It waits there for approval; nothing is paid.`)
    },
    onError: async e => setActionError(await errorMessage(e)),
  })

  if (isLoading || (doc && !form)) return <div className="text-center py-12 text-gray-400">Loading the document...</div>
  if (isError || !doc || !form) {
    return (
      <div className="card text-center py-12">
        <p className="text-gray-600">This document could not be loaded.</p>
        <button className="btn-secondary mt-4" onClick={onClose}>Back to the queue</button>
      </div>
    )
  }

  const editable = doc.status === 'needs_review'
  const defs = doc.kind === 'invoice' ? INVOICE_FIELDS : LEASE_FIELDS
  const flaggedFields = new Set(alarms(doc).flatMap(i => i.fields))
  const changed = (key: string) =>
    initial !== null &&
    (key === 'endDate'
      ? form.values[key] !== initial.values[key] || form.periodic !== initial.periodic
      : form.values[key] !== initial.values[key])
  const busy = approve.isPending || reject.isPending || push.isPending

  const submitApproval = () => {
    setActionError(null)
    const { fields, errors } = fromForm(doc, form)
    if (errors.length) {
      setActionError(errors.join(' '))
      return
    }
    approve.mutate(fields)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <button onClick={onClose} className="text-sm text-blue-600 hover:underline">&larr; Back to the queue</button>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">{titleOf(doc)}</h1>
          <div className="flex items-center gap-2 flex-wrap mt-1 text-sm text-gray-500">
            <span className={`badge ${STATUS_STYLES[doc.status]}`}>{STATUS_LABELS[doc.status]}</span>
            <span className="badge bg-gray-100 text-gray-700">Read by {METHOD_LABELS[doc.method]}</span>
            <span>{doc.fileName}</span>
            <span>&middot; received {day(doc.createdAt)}</span>
          </div>
        </div>
        {editable && (
          <p className="text-sm text-gray-500" aria-live="off">
            Time on this item: {Math.floor(elapsed / 60)}m {String(elapsed % 60).padStart(2, '0')}s
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        <div className="xl:sticky xl:top-0">
          <PdfViewer id={doc.id} fileName={doc.fileName} />
        </div>

        <div className="space-y-4">
          <IssueList issues={doc.issues ?? []} />
          <Links doc={doc} />

          <section aria-labelledby="fields-heading" className="card space-y-4">
            <div>
              <h2 id="fields-heading" className="font-semibold text-gray-900">
                {editable ? 'Check and correct the fields' : 'Fields'}
              </h2>
              {editable && (
                <p className="text-sm text-gray-500 mt-1">
                  Compare each value with the PDF. Low confidence means a check failed or the model and the rules
                  disagree.
                </p>
              )}
            </div>
            {defs.map(def => (
              <div key={def.key}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label htmlFor={`field-${def.key}`} className="text-sm font-medium text-gray-700">
                    {def.label}
                  </label>
                  <span className="flex items-center gap-1">
                    {changed(def.key) && <span className="badge bg-blue-100 text-blue-700">Edited</span>}
                    <ConfidenceBadge field={doc.extracted?.[def.key]} />
                  </span>
                </div>
                <FieldInput def={def} form={form} setForm={setForm} disabled={!editable || busy} flagged={flaggedFields.has(def.key)} />
                {def.hint && editable && <p className="text-xs text-gray-400 mt-1">{def.hint}</p>}
              </div>
            ))}
            {doc.kind === 'invoice' && (
              <LineItemsEditor
                form={form}
                setForm={setForm}
                disabled={!editable || busy}
                field={doc.extracted?.lineItems}
                flagged={flaggedFields.has('lineItems')}
              />
            )}
          </section>

          {actionError && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {actionError}
            </div>
          )}

          {editable && (
            <div className="card space-y-3">
              {!rejecting ? (
                <div className="flex gap-3 flex-wrap">
                  <button className="btn-primary" onClick={submitApproval} disabled={busy}>
                    {approve.isPending ? 'Approving...' : 'Approve, nothing is paid or sent'}
                  </button>
                  <button className="btn-secondary" onClick={() => setRejecting(true)} disabled={busy}>
                    Reject
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <label htmlFor="reject-reason" className="label">Why are you rejecting it? (optional)</label>
                  <input
                    id="reject-reason"
                    className="input"
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    placeholder="For example: duplicate of an invoice already paid"
                  />
                  <div className="flex gap-3">
                    <button className="btn-danger" onClick={() => reject.mutate()} disabled={busy}>
                      {reject.isPending ? 'Rejecting...' : 'Reject, nothing is paid'}
                    </button>
                    <button className="btn-secondary" onClick={() => setRejecting(false)} disabled={busy}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              <p className="text-xs text-gray-500">
                Approving records your check{doc.kind === 'invoice' ? ' and queues the invoice for the accounting export' : ''}.
                Corrections you make are saved with the document.
              </p>
            </div>
          )}

          {doc.status === 'approved' && (
            <div className="card space-y-3">
              {doc.kind === 'invoice' && (
                <p className="text-sm text-gray-600">
                  Approved invoices go to accounting when you export the CSV from the queue, or one at a time here.
                </p>
              )}
              <div className="flex gap-3 flex-wrap">
                {doc.kind === 'invoice' && (
                  <button className="btn-primary" onClick={() => push.mutate()} disabled={busy}>
                    {push.isPending ? 'Sending...' : 'Send to accounting as a draft bill (nothing is paid)'}
                  </button>
                )}
                <button className="btn-secondary" onClick={() => reject.mutate()} disabled={busy}>
                  {reject.isPending ? 'Rejecting...' : 'Reject instead, it will not be exported'}
                </button>
              </div>
            </div>
          )}

          {doc.reviewedAt && (
            <p className="text-xs text-gray-500">
              Reviewed {day(doc.reviewedAt)}
              {doc.reviewSeconds ? ` in ${Math.floor(doc.reviewSeconds / 60)}m ${doc.reviewSeconds % 60}s` : ''}.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------

function ChecksSummary({ doc }: { doc: DocumentRecord }) {
  const problems = alarms(doc)
  if (doc.status === 'rejected') return <span className="text-gray-400">Rejected</span>
  if (problems.length === 0) return <span className="badge bg-green-100 text-green-700">Checks passed</span>
  const errors = problems.filter(i => i.severity === 'error').length
  return (
    <span className={`badge ${errors ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`} title={problems.map(i => i.message).join('\n')}>
      {problems.length} {problems.length === 1 ? 'issue' : 'issues'} to check
    </span>
  )
}

export default function Documents() {
  const qc = useQueryClient()
  const { data: documents = [], isLoading, isError } = useQuery({ queryKey: ['documents'], queryFn: getDocuments })
  const { data: methodInfo } = useQuery({ queryKey: ['documents-method'], queryFn: getExtractionMethod })
  const [tab, setTab] = useState<DocumentStatus>('needs_review')
  const [openId, setOpenId] = useState<number | null>(null)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const counts = useMemo(() => {
    const c: Record<DocumentStatus, number> = { needs_review: 0, approved: 0, exported: 0, rejected: 0 }
    for (const d of documents) c[d.status]++
    return c
  }, [documents])
  const approvedInvoices = documents.filter(d => d.status === 'approved' && d.kind === 'invoice').length
  const shown = documents.filter(d => d.status === tab)

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setMessage(null)
    const done: string[] = []
    const failed: string[] = []
    const list = Array.from(files)
    for (const [i, file] of list.entries()) {
      setUploading(list.length > 1 ? `Reading ${i + 1} of ${list.length}...` : 'Reading the PDF...')
      try {
        const doc = await uploadDocument(file)
        const n = alarms(doc).length
        done.push(`${file.name} (${n ? `${n} ${n === 1 ? 'issue' : 'issues'} to check` : 'checks passed'})`)
      } catch (e) {
        failed.push(`${file.name}: ${await errorMessage(e, 'upload failed')}`)
      }
    }
    setUploading(null)
    qc.invalidateQueries({ queryKey: ['documents'] })
    setTab('needs_review')
    if (failed.length) setMessage({ tone: 'error', text: [...(done.length ? [`Read ${done.join(', ')}.`] : []), ...failed].join(' ') })
    else setMessage({ tone: 'success', text: `Read ${done.join(', ')}. ${done.length === 1 ? 'It is' : 'They are'} waiting for your review.` })
  }

  const onExport = async () => {
    setExporting(true)
    setMessage(null)
    try {
      const name = await downloadXeroBills()
      qc.invalidateQueries({ queryKey: ['documents'] })
      setMessage({
        tone: 'success',
        text: `Downloaded ${name}. Those invoices are now marked exported. In Xero, import the file under Bills and choose "tax exclusive" amounts. Nothing has been paid.`,
      })
    } catch (e) {
      setMessage({ tone: 'error', text: await errorMessage(e, 'The export failed.') })
    } finally {
      setExporting(false)
    }
  }

  if (openId !== null) {
    return (
      <Review
        key={openId}
        id={openId}
        onClose={() => setOpenId(null)}
        onDone={text => {
          setOpenId(null)
          setMessage({ tone: 'success', text })
        }}
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Documents</h1>
          <p className="text-gray-500 mt-1">
            Supplier invoices and tenancy summaries, read and checked for you. Nothing is paid, posted or sent until you act.
          </p>
          {methodInfo && (
            <p className="text-sm text-gray-500 mt-1">
              New uploads are read by <span className="font-medium text-gray-700">{METHOD_LABELS[methodInfo.method]}</span>
              {methodInfo.aiEnabled && methodInfo.model ? ` (${methodInfo.model})` : ': no model is configured, so the rules read every document'}.
            </p>
          )}
        </div>
        <div className="flex gap-3 flex-wrap">
          <button className="btn-secondary" onClick={onExport} disabled={exporting || approvedInvoices === 0} title={approvedInvoices === 0 ? 'Approve invoices first' : undefined}>
            {exporting ? 'Exporting...' : `Export approved to Xero CSV (${approvedInvoices})`}
          </button>
          <label className={`btn-primary cursor-pointer focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2 ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
            <input
              type="file"
              accept="application/pdf,.pdf"
              multiple
              className="sr-only"
              disabled={uploading !== null}
              onChange={e => {
                onFiles(e.target.files)
                e.target.value = ''
              }}
            />
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            {uploading ?? 'Upload PDF'}
          </label>
        </div>
      </div>

      {message && (
        <div
          role="status"
          className={`rounded-lg border px-4 py-3 text-sm flex items-start justify-between gap-4 ${
            message.tone === 'success' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          <span>{message.text}</span>
          <button className="shrink-0 underline" onClick={() => setMessage(null)}>Dismiss</button>
        </div>
      )}

      <div role="tablist" aria-label="Document status" className="flex gap-2 flex-wrap">
        {TABS.map(t => (
          <button
            key={t.status}
            role="tab"
            aria-selected={tab === t.status}
            onClick={() => setTab(t.status)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === t.status ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {t.label} ({counts[t.status]})
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading documents...</div>
      ) : isError ? (
        <div className="card text-center py-12 text-red-700">The documents could not be loaded. Refresh the page to try again.</div>
      ) : shown.length === 0 ? (
        <div className="card text-center py-16">
          <p className="text-gray-500">{TABS.find(t => t.status === tab)?.empty}</p>
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Document</th>
                <th scope="col" className="px-4 py-3 font-medium">Property</th>
                <th scope="col" className="px-4 py-3 font-medium text-right">Amount</th>
                <th scope="col" className="px-4 py-3 font-medium">Checks</th>
                <th scope="col" className="px-4 py-3 font-medium">Read by</th>
                <th scope="col" className="px-4 py-3"><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shown.map(doc => {
                const address = valueOf(doc, 'propertyAddress')
                return (
                  <tr key={doc.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`badge ${doc.kind === 'invoice' ? 'bg-blue-100 text-blue-700' : 'bg-teal-100 text-teal-700'}`}>
                          {doc.kind === 'invoice' ? 'Invoice' : 'Tenancy'}
                        </span>
                        <span className="font-medium text-gray-900">{titleOf(doc)}</span>
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {doc.fileName} &middot; received {day(doc.createdAt)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {doc.property ? (
                        doc.property.address
                      ) : (
                        <span className="text-gray-400">{typeof address === 'string' ? `${address} (not matched)` : 'Not found'}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap text-gray-900">
                      {doc.kind === 'invoice'
                        ? money(valueOf(doc, 'total'))
                        : typeof valueOf(doc, 'weeklyRent') === 'number'
                          ? `${money(valueOf(doc, 'weeklyRent'))} / week`
                          : '–'}
                    </td>
                    <td className="px-4 py-3"><ChecksSummary doc={doc} /></td>
                    <td className="px-4 py-3 text-gray-500">{METHOD_LABELS[doc.method]}</td>
                    <td className="px-4 py-3 text-right">
                      <button className="btn-secondary py-1.5" onClick={() => setOpenId(doc.id)} aria-label={`${doc.status === 'needs_review' ? 'Review' : 'Open'} ${titleOf(doc)}`}>
                        {doc.status === 'needs_review' ? 'Review' : 'Open'}
                      </button>
                    </td>
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
