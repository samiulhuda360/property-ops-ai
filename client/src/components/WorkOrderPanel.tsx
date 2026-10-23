import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { getContractors } from '../api/contractors'
import { approveWorkOrder, rejectWorkOrder } from '../api/maintenance'
import { useAuth } from '../contexts/AuthContext'
import { MaintenanceRequest } from '../types'

const CATEGORY_LABELS: Record<string, string> = {
  plumbing: 'Plumbing',
  electrical: 'Electrical',
  gas_heating: 'Gas and heating',
  water_leak: 'Water leak or flooding',
  security: 'Locks and security',
  pest: 'Pests',
  appliance: 'Appliances',
  structural: 'Building and grounds',
  general: 'General repair',
}

const SAFETY_LABELS: Record<string, string> = {
  gas: 'Gas: possible leak',
  electrical: 'Electrical: risk of fire or shock',
  flooding: 'Water: flooding or water near electrics',
  security: 'Security: the home cannot be secured',
}

const URGENCY_TONE: Record<string, string> = { urgent: 'bg-red-100 text-red-700', high: 'bg-orange-100 text-orange-700', normal: 'bg-blue-100 text-blue-700', low: 'bg-gray-100 text-gray-600' }

export default function WorkOrderPanel({ job, onClose }: { job: MaintenanceRequest; onClose: () => void }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const limit = user?.limits?.workOrder ?? null
  const canDecide = user?.limits?.canDecide !== false
  const { data: contractors = [] } = useQuery({ queryKey: ['contractors'], queryFn: getContractors })
  const order = job.workOrder
  const triage = job.triage
  const [contractorId, setContractorId] = useState<number | ''>(order?.contractor?.id ?? '')
  const [scope, setScope] = useState(order?.scope ?? '')
  const [access, setAccess] = useState(order?.accessNotes ?? '')
  const [budget, setBudget] = useState<string>(order?.budget ? String(order.budget.high) : '')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const opened = useRef(Date.now())

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    setContractorId(order?.contractor?.id ?? '')
    setScope(order?.scope ?? '')
    setAccess(order?.accessNotes ?? '')
    setBudget(order?.budget ? String(order.budget.high) : '')
    opened.current = Date.now()
  }, [job.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const seconds = () => Math.round((Date.now() - opened.current) / 1000)
  const done = () => {
    qc.invalidateQueries({ queryKey: ['maintenance'] })
    setError('')
    onClose()
  }
  const approve = useMutation({
    mutationFn: () => approveWorkOrder(job.id, { contractorId: contractorId === '' ? null : contractorId, scope, accessNotes: access, budgetHigh: budget === '' ? null : Number(budget), reviewSeconds: seconds() }),
    onSuccess: done,
    onError: (e: any) => setError(e.response?.data?.error || 'The work order could not be approved.'),
  })
  const reject = useMutation({
    mutationFn: () => rejectWorkOrder(job.id, { reason, reviewSeconds: seconds() }),
    onSuccess: done,
    onError: (e: any) => setError(e.response?.data?.error || 'The work order could not be rejected.'),
  })

  const overLimit = limit !== null && budget !== '' && Number(budget) > limit
  const currency = order?.budget?.currency || user?.organisation?.currency || ''

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white w-full max-w-2xl h-full overflow-y-auto shadow-xl p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">{job.title}</h2>
            <p className="text-sm text-gray-500">
              {job.property?.address}
              {job.property?.code ? ` (${job.property.code})` : ''} · logged {format(new Date(job.createdAt), 'd MMM yyyy')}
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="card p-4 space-y-2">
          <p className="text-sm font-medium text-gray-700">The tenant's request</p>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{job.description}</p>
        </div>

        {triage && (
          <div className="card p-4 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="badge bg-gray-100 text-gray-700">{CATEGORY_LABELS[triage.category] ?? triage.category}</span>
              <span className={`badge ${URGENCY_TONE[triage.urgency]}`}>{triage.urgency}</span>
              {triage.safety.map((s) => (
                <span key={s} className="badge bg-red-100 text-red-700">
                  {SAFETY_LABELS[s]}
                </span>
              ))}
              <span className="text-xs text-gray-400">triaged by {triage.method === 'rules' ? 'the rules' : 'the model with the rules as a safety net'}</span>
            </div>
            <ul className="list-disc pl-5 text-sm text-gray-600 space-y-0.5">
              {triage.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}

        {order ? (
          <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700">Work order</p>
              <span className={`badge ${order.status === 'approved' ? 'bg-green-100 text-green-700' : order.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{order.status}</span>
            </div>
            {order.safetyNotes.length > 0 && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800 space-y-1">
                {order.safetyNotes.map((n, i) => (
                  <p key={i}>{n}</p>
                ))}
              </div>
            )}
            <div>
              <label className="label">Scope of work</label>
              <textarea className="input" rows={4} value={scope} onChange={(e) => setScope(e.target.value)} disabled={order.status !== 'draft' || !canDecide} />
            </div>
            <div>
              <label className="label">Access</label>
              <input className="input" value={access} onChange={(e) => setAccess(e.target.value)} disabled={order.status !== 'draft' || !canDecide} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Contractor</label>
                <select className="input" value={contractorId} onChange={(e) => setContractorId(e.target.value ? Number(e.target.value) : '')} disabled={order.status !== 'draft' || !canDecide}>
                  <option value="">Choose later</option>
                  {contractors.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.trade.replace('_', ' ')}){c.available === false ? ' – unavailable' : ''}
                    </option>
                  ))}
                </select>
                {order.contractor && (
                  <p className="text-xs text-gray-500 mt-1">
                    Suggested: {order.contractor.name}: {order.contractor.why}.
                  </p>
                )}
                {order.alternatives.length > 0 && <p className="text-xs text-gray-400 mt-1">Also: {order.alternatives.map((a) => `${a.name} (${a.why})`).join('; ')}.</p>}
              </div>
              <div>
                <label className="label">Budget up to ({currency})</label>
                <input type="number" className="input" min={0} value={budget} onChange={(e) => setBudget(e.target.value)} disabled={order.status !== 'draft' || !canDecide} />
                {order.budget && (
                  <p className="text-xs text-gray-500 mt-1">
                    Similar jobs cost {order.budget.currency} {order.budget.low}–{order.budget.high} ({order.budget.basis}).
                  </p>
                )}
                {overLimit && <p className="text-xs text-amber-700 mt-1">Above your approval limit of {limit?.toLocaleString()}: a manager must approve this one.</p>}
              </div>
            </div>
            {order.status === 'draft' ? (
              <>
                <input className="input" placeholder="Reason, if rejecting (optional)" value={reason} onChange={(e) => setReason(e.target.value)} disabled={!canDecide} />
                {error && <p className="text-sm text-red-600">{error}</p>}
                <div className="flex gap-3">
                  <button className="btn-primary flex-1" onClick={() => approve.mutate()} disabled={!canDecide || approve.isPending || overLimit}>
                    Approve the work order
                  </button>
                  <button className="btn-secondary flex-1" onClick={() => reject.mutate()} disabled={!canDecide || reject.isPending}>
                    Reject
                  </button>
                </div>
                <p className="text-xs text-gray-400">Approving assigns the contractor and moves the job to in progress. The contractor is not contacted by the app.</p>
              </>
            ) : (
              <p className="text-sm text-gray-500">
                {order.status === 'approved' ? 'Approved' : 'Rejected'}
                {job.approvedAt ? ` ${format(new Date(job.approvedAt), 'd MMM yyyy HH:mm')}` : ''}
                {job.contractor ? ` · ${job.contractor.name}` : ''}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-500">This job was logged by hand, so there is no triage or draft work order.</p>
        )}
      </div>
    </div>
  )
}
