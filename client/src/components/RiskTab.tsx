import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { getRisk, getRiskModel, getRisks, rescoreRisks, reviewRisk } from '../api/risk'
import { useAuth } from '../contexts/AuthContext'
import { NextStep, RiskBand, TenantRisk } from '../types/risk'

const BAND_TONE: Record<RiskBand, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-green-100 text-green-700',
}

const STEP_LABELS: Record<NextStep, string> = {
  none: 'No action',
  reminder: 'Send a reminder',
  call: 'Call the tenant',
  payment_plan: 'Offer a payment plan',
}

const STATUS_TONE: Record<string, string> = { draft: 'bg-gray-100 text-gray-600', approved: 'bg-green-100 text-green-700', dismissed: 'bg-gray-100 text-gray-400' }

function Drawer({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const canDecide = user?.limits?.canDecide !== false
  const { data: risk } = useQuery({ queryKey: ['risk', id], queryFn: () => getRisk(id) })
  const [draft, setDraft] = useState('')
  const [nextStep, setNextStep] = useState<NextStep>('none')
  const [note, setNote] = useState('')
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
    if (risk) {
      setDraft(risk.draft)
      setNextStep(risk.nextStep)
      opened.current = Date.now()
    }
  }, [risk?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const review = useMutation({
    mutationFn: (decision: 'approve' | 'dismiss') => reviewRisk(id, { decision, draft, nextStep, note, reviewSeconds: Math.round((Date.now() - opened.current) / 1000) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['risks'] })
      qc.invalidateQueries({ queryKey: ['risk', id] })
      setError('')
    },
    onError: (e: any) => setError(e.response?.data?.error || 'The decision could not be saved.'),
  })

  if (!risk) return null
  const currency = user?.organisation?.currency ?? 'NZD'
  const history = [...risk.history].reverse()

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white w-full max-w-2xl h-full overflow-y-auto shadow-xl p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              {risk.tenant.firstName} {risk.tenant.lastName}
            </h2>
            <p className="text-sm text-gray-500">
              {risk.lease.property.address}, {risk.lease.property.suburb}
              {risk.lease.property.code ? ` (${risk.lease.property.code})` : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <span className={`badge ${BAND_TONE[risk.band]}`}>{risk.band} risk</span>
          <span className="text-sm text-gray-600">{Math.round(risk.probability * 100)}% chance of falling 30+ days behind in the next three months</span>
          <span className={`badge ${STATUS_TONE[risk.status]}`}>{risk.status}</span>
        </div>

        <div className="card p-4">
          <p className="text-sm font-medium text-gray-700 mb-2">Why</p>
          <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700">
            {risk.reasons.map((r) => (
              <li key={r.feature}>{r.text}</li>
            ))}
          </ul>
          <p className="text-xs text-gray-400 mt-2">
            Scored {format(new Date(risk.scoredAt), 'd MMM yyyy')} from rent history to {risk.asOfMonth}, model {risk.modelVersion}.
          </p>
        </div>

        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-gray-700">Suggested next step</p>
            <select className="input w-auto" value={nextStep} disabled={risk.status !== 'draft' || !canDecide} onChange={(e) => setNextStep(e.target.value as NextStep)}>
              {(Object.keys(STEP_LABELS) as NextStep[]).map((s) => (
                <option key={s} value={s}>
                  {STEP_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <textarea className="input font-mono text-xs" rows={9} value={draft} disabled={risk.status !== 'draft' || !canDecide} onChange={(e) => setDraft(e.target.value)} />
          {risk.status === 'draft' ? (
            <>
              <input className="input" placeholder="Note for the file (optional)" value={note} onChange={(e) => setNote(e.target.value)} disabled={!canDecide} />
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex gap-3">
                <button className="btn-primary flex-1" disabled={!canDecide || review.isPending} onClick={() => review.mutate('approve')}>
                  Approve the step
                </button>
                <button className="btn-secondary flex-1" disabled={!canDecide || review.isPending} onClick={() => review.mutate('dismiss')}>
                  Dismiss
                </button>
              </div>
              <p className="text-xs text-gray-400">Approving records the decision for the file. Nothing is sent to the tenant from here.</p>
            </>
          ) : (
            <p className="text-sm text-gray-500">
              {risk.status === 'approved' ? 'Approved' : 'Dismissed'} {risk.approvedAt ? format(new Date(risk.approvedAt), 'd MMM yyyy HH:mm') : ''}
              {risk.note ? ` · ${risk.note}` : ''}
            </p>
          )}
        </div>

        <div className="card p-0 overflow-hidden">
          <p className="text-sm font-medium text-gray-700 px-4 pt-4 pb-2">Rent history (latest first)</p>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="text-left px-4 py-2">Month</th>
                <th className="text-right px-4 py-2">Due</th>
                <th className="text-right px-4 py-2">Paid</th>
                <th className="text-right px-4 py-2">Days late</th>
                <th className="text-left px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {history.map((m) => (
                <tr key={m.id} className={m.arrears30 ? 'bg-red-50' : m.daysLate > 0 ? 'bg-amber-50/50' : ''}>
                  <td className="px-4 py-1.5">{m.month}</td>
                  <td className="px-4 py-1.5 text-right">{currency} {m.rentDue.toLocaleString()}</td>
                  <td className="px-4 py-1.5 text-right">{m.paidAmount ? `${currency} ${m.paidAmount.toLocaleString()}` : <span className="text-red-600">none</span>}</td>
                  <td className="px-4 py-1.5 text-right">{m.daysLate || '–'}</td>
                  <td className="px-4 py-1.5 text-xs">
                    {m.arrears30 ? <span className="text-red-700">30+ days behind</span> : m.paidAmount < m.rentDue ? <span className="text-amber-700">partial</span> : m.daysLate > 0 ? <span className="text-amber-700">late</span> : <span className="text-green-700">on time</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default function RiskTab() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const [band, setBand] = useState<string>('')
  const [open, setOpen] = useState<number | null>(null)
  const { data: risks = [], isLoading } = useQuery({ queryKey: ['risks', band], queryFn: () => getRisks(band || undefined) })
  const { data: model } = useQuery({ queryKey: ['risk-model'], queryFn: getRiskModel })
  const rescore = useMutation({ mutationFn: rescoreRisks, onSuccess: () => qc.invalidateQueries({ queryKey: ['risks'] }) })

  const counts = { high: 0, medium: 0, low: 0, draft: 0 }
  for (const r of risks) {
    if (!band) counts[r.band]++
    if (r.status === 'draft' && r.nextStep !== 'none') counts.draft++
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-600">
          Which tenants are likely to fall 30 or more days behind in the next three months, and why. The next step is a draft for a person to approve.
        </p>
        <div className="flex items-center gap-2">
          <select className="input w-auto" value={band} onChange={(e) => setBand(e.target.value)}>
            <option value="">All bands</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <button className="btn-secondary" onClick={() => rescore.mutate()} disabled={rescore.isPending || user?.limits?.canDecide === false}>
            {rescore.isPending ? 'Scoring...' : 'Score again'}
          </button>
        </div>
      </div>

      {model && (
        <p className="text-xs text-gray-400">
          Model {model.version}: logistic regression on {model.features.length} features from the rent history, trained on {model.training.rows} tenancy-months and backtested on held-out months
          (AUC {Number(model.backtest.auc).toFixed(2)}, {model.backtest.positives} of {model.backtest.rows} tenancies went into arrears). High ≥ {Math.round(model.bands.high * 100)}%, medium ≥{' '}
          {Math.round(model.bands.medium * 100)}%.
        </p>
      )}

      {isLoading ? (
        <p className="text-gray-500">Loading...</p>
      ) : risks.length === 0 ? (
        <div className="card text-center py-16 text-gray-400">No rent history to score yet. Load the demo data, or import rent payments.</div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Tenant', 'Property', 'Risk', 'Why', 'Suggested step', ''].map((h, i) => (
                  <th key={i} className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-4 py-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {risks.map((r: TenantRisk) => (
                <tr key={r.id} className="hover:bg-gray-50 cursor-pointer align-top" onClick={() => setOpen(r.id)}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">
                      {r.tenant.firstName} {r.tenant.lastName}
                    </p>
                    <p className="text-xs text-gray-400">since {format(new Date(r.lease.startDate), 'MMM yyyy')}</p>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {r.lease.property.address}
                    <p className="text-xs text-gray-400">{r.lease.property.suburb}</p>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`badge ${BAND_TONE[r.band]}`}>{r.band}</span>
                    <p className="text-xs text-gray-400 mt-1">{Math.round(r.probability * 100)}%</p>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    <ul className="space-y-0.5">
                      {r.reasons.slice(0, 3).map((x) => (
                        <li key={x.feature}>{x.text}</li>
                      ))}
                    </ul>
                  </td>
                  <td className="px-4 py-3 text-sm whitespace-nowrap">
                    <p className="text-gray-900">{STEP_LABELS[r.nextStep]}</p>
                    <span className={`badge mt-1 ${STATUS_TONE[r.status]}`}>{r.status}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-blue-600">Open</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!band && risks.length > 0 && (
        <p className="text-xs text-gray-400">
          {counts.high} high, {counts.medium} medium, {counts.low} low; {counts.draft} suggested step{counts.draft === 1 ? '' : 's'} waiting for a person.
        </p>
      )}
      {open !== null && <Drawer id={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
