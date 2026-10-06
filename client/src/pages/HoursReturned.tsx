import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { downloadHoursCsv, getHoursReport } from '../api/reports'

const OUTCOME_LABELS: Record<string, string> = {
  auto: 'Handled automatically',
  reviewed: 'Approved as is',
  corrected: 'Corrected, then approved',
  rejected: 'Rejected',
  failed: 'Failed',
}

const TASK_LABELS: Record<string, string> = {
  invoice_extraction: 'Supplier invoice',
  lease_extraction: 'Lease summary',
  rent_reconciliation: 'Bank line',
  inbox_triage: 'Tenant email',
}

function monthName(month: string) {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-NZ', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function Stat({ label, value, sub, tone = 'text-gray-900' }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="card">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${tone}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

export default function HoursReturned() {
  const [month, setMonth] = useState<string | undefined>()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['hours-report', month],
    queryFn: () => getHoursReport(month),
  })

  if (isLoading) return <p className="text-gray-500">Loading the report...</p>
  if (isError || !data) return <p className="text-red-600">The report could not be loaded.</p>

  const chartData = data.rows.map((r) => ({
    name: r.label,
    'By hand (baseline)': r.baselineHours,
    'Review time': r.reviewHours,
    'Hours returned': r.hoursReturned,
  }))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Hours returned</h1>
          <p className="text-gray-500 mt-1">
            Manual time the automations saved, after counting the time people spent checking their work.
          </p>
        </div>
        <div className="flex items-end gap-3">
          <div>
            <label htmlFor="month" className="label">
              Month
            </label>
            <select
              id="month"
              className="input"
              value={data.month}
              onChange={(e) => setMonth(e.target.value)}
              disabled={data.months.length === 0}
            >
              {(data.months.length ? data.months : [data.month]).map((m) => (
                <option key={m} value={m}>
                  {monthName(m)}
                </option>
              ))}
            </select>
          </div>
          <button className="btn-secondary" onClick={() => downloadHoursCsv(data.month)} disabled={!data.rows.length}>
            Download CSV
          </button>
        </div>
      </div>

      {data.rows.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-900 font-medium">No automation runs in {monthName(data.month)}</p>
          <p className="text-sm text-gray-500 mt-1">
            Process some invoices, a bank statement or tenant emails, or load the demo data (npm run demo -w server).
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <Stat
              label={`Hours returned, ${monthName(data.month)}`}
              value={`${data.totals.hoursReturned} h`}
              sub="Baseline hours minus review time"
              tone="text-emerald-600"
            />
            <Stat label="Items handled" value={String(data.totals.items)} sub="Emails, invoices, leases and bank lines" />
            <Stat label="Time by hand (baseline)" value={`${data.totals.baselineHours} h`} sub="For the items whose automated work was used" />
            <Stat label="Time spent reviewing" value={`${data.totals.reviewHours} h`} sub="Measured in the app" tone="text-amber-600" />
          </div>

          <div className="card">
            <h2 className="font-semibold text-gray-900 mb-4">By automation</h2>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ left: 0, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} unit=" h" />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="By hand (baseline)" fill="#93c5fd" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Review time" fill="#fbbf24" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Hours returned" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="overflow-x-auto mt-6">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-200">
                    <th className="py-2 pr-4 font-medium">Automation</th>
                    <th className="py-2 pr-4 font-medium text-right">Items</th>
                    <th className="py-2 pr-4 font-medium">Outcomes</th>
                    <th className="py-2 pr-4 font-medium text-right">Minutes by hand / item</th>
                    <th className="py-2 pr-4 font-medium text-right">Baseline</th>
                    <th className="py-2 pr-4 font-medium text-right">Review</th>
                    <th className="py-2 font-medium text-right">Returned</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.automation} className="border-b border-gray-100 align-top">
                      <td className="py-3 pr-4 font-medium text-gray-900">{r.label}</td>
                      <td className="py-3 pr-4 text-right">{r.items}</td>
                      <td className="py-3 pr-4">
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(r.outcomes).map(([outcome, n]) => (
                            <span key={outcome} className="badge bg-gray-100 text-gray-700">
                              {OUTCOME_LABELS[outcome] ?? outcome}: {n}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-right">{r.baselineMinutesPerItem}</td>
                      <td className="py-3 pr-4 text-right">{r.baselineHours} h</td>
                      <td className="py-3 pr-4 text-right">{r.reviewHours} h</td>
                      <td className="py-3 text-right font-semibold text-emerald-700">{r.hoursReturned} h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="font-semibold text-gray-900">How this is counted</h2>
          <p className="mt-3 text-sm text-gray-700 font-mono bg-gray-50 rounded-lg p-3">{data.method.formula}</p>
          <ul className="mt-3 space-y-1 text-sm text-gray-600 list-disc pl-5">
            {data.method.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <table className="mt-4 text-sm">
            <tbody>
              {Object.entries(data.method.baselineMinutes).map(([key, minutes]) => (
                <tr key={key}>
                  <td className="pr-6 py-1 text-gray-600">{TASK_LABELS[key] ?? key}</td>
                  <td className="py-1 font-medium">{minutes} min by hand</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2 className="font-semibold text-gray-900">Model usage, last 30 days</h2>
          {data.aiUsage.length === 0 ? (
            <p className="mt-3 text-sm text-gray-500">No model calls in the last 30 days. The automations ran on their rules.</p>
          ) : (
            <table className="mt-3 min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-2 pr-3 font-medium">Feature</th>
                  <th className="py-2 pr-3 font-medium text-right">Calls</th>
                  <th className="py-2 pr-3 font-medium text-right">Cached</th>
                  <th className="py-2 pr-3 font-medium text-right">Failed</th>
                  <th className="py-2 font-medium text-right">Median latency</th>
                </tr>
              </thead>
              <tbody>
                {data.aiUsage.map((u) => (
                  <tr key={u.feature} className="border-b border-gray-100">
                    <td className="py-2 pr-3">{u.feature}</td>
                    <td className="py-2 pr-3 text-right">{u.calls}</td>
                    <td className="py-2 pr-3 text-right">{u.cached}</td>
                    <td className="py-2 pr-3 text-right">{u.failed}</td>
                    <td className="py-2 text-right">{u.medianLatencyMs === null ? '-' : `${(u.medianLatencyMs / 1000).toFixed(1)} s`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
