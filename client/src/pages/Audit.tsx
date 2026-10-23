import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { downloadAuditCsv, getAudit, getAuditMeta } from '../api/audit'
import { AuditEvent, AuditFilter } from '../types/audit'

const ENTITY_LABELS: Record<string, string> = {
  lease: 'Lease',
  document: 'Document',
  inbox: 'Tenant email',
  bank: 'Bank line',
  risk: 'Arrears risk',
  maintenance: 'Maintenance',
  user: 'User',
}

const ACTION_TONE = (action: string) =>
  action.endsWith('approved') || action.endsWith('resolved')
    ? 'bg-green-100 text-green-700'
    : action.endsWith('corrected') || action.includes('role')
      ? 'bg-amber-100 text-amber-700'
      : action.endsWith('rejected') || action.endsWith('dismissed')
        ? 'bg-red-100 text-red-700'
        : 'bg-gray-100 text-gray-600'

function Value({ value, full }: { value: unknown; full: boolean }) {
  if (value === null || value === undefined) return <span className="text-gray-300">–</span>
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value)
    return <span className={full ? 'whitespace-pre-wrap' : ''}>{full || text.length <= 80 ? text : `${text.slice(0, 77)}...`}</span>
  }
  const text = Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('; ') : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}`)
    .join(' · ')
  return <span className={`text-xs text-gray-600 ${full ? 'whitespace-pre-wrap break-words' : ''}`}>{full || text.length <= 90 ? text : `${text.slice(0, 87)}...`}</span>
}

export default function Audit() {
  const [filter, setFilter] = useState<AuditFilter>({})
  const [expanded, setExpanded] = useState<number | null>(null)
  const { data: meta } = useQuery({ queryKey: ['audit-meta'], queryFn: getAuditMeta })
  const { data: events = [], isLoading, isError } = useQuery({ queryKey: ['audit', filter], queryFn: () => getAudit(filter) })

  const set = (key: keyof AuditFilter, value: string) => setFilter((f) => ({ ...f, [key]: value || undefined }))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Audit trail</h1>
          <p className="text-gray-500 mt-1">
            Every AI extraction, approval, correction and decision: who, when, and the value before and after.
            {meta && <span className="text-gray-400"> {meta.total.toLocaleString()} events on file.</span>}
          </p>
        </div>
        <button className="btn-secondary" onClick={() => downloadAuditCsv(filter)} disabled={events.length === 0}>
          Download CSV
        </button>
      </div>

      <div className="card grid grid-cols-2 md:grid-cols-6 gap-3">
        <div>
          <label className="label">What</label>
          <select className="input" value={filter.entity ?? ''} onChange={(e) => set('entity', e.target.value)}>
            <option value="">Everything</option>
            {(meta?.entities ?? []).map((e) => (
              <option key={e} value={e}>
                {ENTITY_LABELS[e] ?? e}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Action</label>
          <select className="input" value={filter.action ?? ''} onChange={(e) => set('action', e.target.value)}>
            <option value="">Any</option>
            {Object.entries(meta?.actions ?? {})
              .filter(([a]) => !filter.entity || a.startsWith(`${filter.entity}.`))
              .map(([a, label]) => (
                <option key={a} value={a}>
                  {label}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label className="label">Who</label>
          <select className="input" value={filter.userId ?? ''} onChange={(e) => setFilter((f) => ({ ...f, userId: e.target.value ? Number(e.target.value) : undefined }))}>
            <option value="">Anyone</option>
            {(meta?.users ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">From</label>
          <input type="date" className="input" value={filter.from ?? ''} onChange={(e) => set('from', e.target.value)} />
        </div>
        <div>
          <label className="label">To</label>
          <input type="date" className="input" value={filter.to ?? ''} onChange={(e) => set('to', e.target.value)} />
        </div>
        <div>
          <label className="label">Search notes</label>
          <input className="input" placeholder="e.g. rent, MTE14" value={filter.search ?? ''} onChange={(e) => set('search', e.target.value)} />
        </div>
      </div>

      {isLoading ? (
        <p className="text-gray-500">Loading the trail...</p>
      ) : isError ? (
        <p className="text-red-600">The audit trail could not be loaded.</p>
      ) : events.length === 0 ? (
        <div className="card text-center py-16 text-gray-400">Nothing matches these filters.</div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['When', 'Who', 'Action', 'What', 'Before', 'After', 'Note'].map((h) => (
                  <th key={h} className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-4 py-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {events.map((e: AuditEvent) => (
                <tr key={e.id} className="hover:bg-gray-50 align-top cursor-pointer" onClick={() => setExpanded(expanded === e.id ? null : e.id)}>
                  <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{format(new Date(e.createdAt), 'd MMM yyyy HH:mm')}</td>
                  <td className="px-4 py-3 text-sm">
                    <p className="font-medium text-gray-900">{e.user.name}</p>
                    <p className="text-xs text-gray-400">{e.user.role.replace('_', ' ')}</p>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`badge ${ACTION_TONE(e.action)}`}>{meta?.actions[e.action] ?? e.action}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                    {ENTITY_LABELS[e.entity ?? ''] ?? e.entity ?? '–'}
                    {e.entityId ? <span className="text-gray-400"> #{e.entityId}</span> : null}
                    {e.field ? <p className="text-xs text-gray-400">{e.field}</p> : null}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 max-w-[14rem]">
                    <Value value={e.before} full={expanded === e.id} />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 max-w-[16rem]">
                    <Value value={e.after} full={expanded === e.id} />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 max-w-[22rem]">{expanded === e.id || !e.note || e.note.length <= 110 ? e.note : `${e.note.slice(0, 107)}...`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
