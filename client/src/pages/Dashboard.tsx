import { useQuery } from '@tanstack/react-query'
import { getProperties } from '../api/properties'
import { getTenants } from '../api/tenants'
import { getPayments } from '../api/payments'
import { getMaintenanceRequests } from '../api/maintenance'
import { useAuth } from '../contexts/AuthContext'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { Link } from 'react-router-dom'
import { getWorkQueue } from '../api/reports'

function QueueTile({ to, label, count, hint, urgent }: { to: string; label: string; count: number; hint: string; urgent?: boolean }) {
  return (
    <Link
      to={to}
      className={`block rounded-lg border p-4 transition-colors hover:bg-gray-50 ${
        urgent && count > 0 ? 'border-red-200 bg-red-50 hover:bg-red-100' : 'border-gray-200'
      }`}
    >
      <p className={`text-2xl font-bold ${urgent && count > 0 ? 'text-red-600' : count > 0 ? 'text-gray-900' : 'text-gray-400'}`}>{count}</p>
      <p className="text-sm font-medium text-gray-900 mt-1">{label}</p>
      <p className="text-xs text-gray-500 mt-0.5">{hint}</p>
    </Link>
  )
}

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div className="card">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  const { data: properties = [] } = useQuery({ queryKey: ['properties'], queryFn: getProperties })
  const { data: tenants = [] } = useQuery({ queryKey: ['tenants'], queryFn: getTenants })
  const { data: payments = [] } = useQuery({ queryKey: ['payments'], queryFn: getPayments })
  const { data: maintenance = [] } = useQuery({ queryKey: ['maintenance'], queryFn: getMaintenanceRequests })
  const { data: queue } = useQuery({ queryKey: ['work-queue'], queryFn: getWorkQueue })

  const totalRent = properties
    .filter(p => p.status === 'tenanted')
    .reduce((sum, p) => sum + p.rentPrice, 0)

  const overduePayments = payments.filter(p => p.status === 'overdue' || p.status === 'pending').length
  const openMaintenance = maintenance.filter(m => m.status !== 'completed').length
  const vacantProperties = properties.filter(p => p.status === 'vacant').length

  const chartData = [...properties]
    .sort((a, b) => b.rentPrice - a.rentPrice)
    .map((p) => ({ property: p.code || p.suburb, rent: p.rentPrice }))

  const recentPayments = [...payments]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Welcome back, {user?.name?.split(' ')[0]}</h1>
        <p className="text-gray-500 mt-1">Here's your portfolio overview</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Properties" value={properties.length} sub={`${vacantProperties} vacant`} color="text-blue-600" />
        <StatCard label="Active Tenants" value={tenants.filter(t => t.leases && t.leases.length > 0).length} sub={`${tenants.length} total`} color="text-green-600" />
        <StatCard label="Weekly Rent" value={`$${totalRent.toLocaleString()}`} sub="from tenanted properties" color="text-emerald-600" />
        <StatCard label="Open Issues" value={overduePayments + openMaintenance} sub={`${overduePayments} payments · ${openMaintenance} maintenance`} color={overduePayments + openMaintenance > 0 ? 'text-red-600' : 'text-gray-900'} />
      </div>

      {queue && (
        <div className="card">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
            <h2 className="text-base font-semibold text-gray-900">Waiting for a person</h2>
            <p className="text-xs text-gray-500">The automations prepare the work; these need a decision.</p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <QueueTile to="/inbox" label="Urgent tenant emails" count={queue.urgentInbox} hint="Safety or no essential service" urgent />
            <QueueTile to="/inbox" label="Emails to approve" count={queue.inboxNeedsPerson} hint="Reply drafts and new tickets" />
            <QueueTile to="/documents" label="Documents to review" count={queue.documentsToReview} hint="Invoices and lease summaries" />
            <QueueTile to="/reconciliation" label="Bank exceptions" count={queue.bankExceptions} hint="Lines that didn't match cleanly" />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Weekly rent by property</h2>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="property" tick={{ fontSize: 11 }} interval={0} />
                <YAxis tick={{ fontSize: 12 }} unit="$" />
                <Tooltip formatter={(v: number) => [`$${v}`, 'Weekly rent']} />
                <Bar dataKey="rent" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-gray-400 text-center py-8">No properties yet</p>
          )}
        </div>

        <div className="card">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Recent Payments</h2>
          {recentPayments.length > 0 ? (
            <div className="space-y-3">
              {recentPayments.map(p => (
                <div key={p.id} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {p.lease?.tenant?.firstName} {p.lease?.tenant?.lastName}
                    </p>
                    <p className="text-xs text-gray-500">{p.lease?.property?.address}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-900">${p.amount}</p>
                    <span className={`badge text-xs ${
                      p.status === 'paid' ? 'bg-green-100 text-green-700' :
                      p.status === 'overdue' ? 'bg-red-100 text-red-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      {p.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-8">No payments recorded yet</p>
          )}
        </div>
      </div>

      <div className="card">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Property Portfolio</h2>
        {properties.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {properties.map(p => (
              <div key={p.id} className="py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{p.address}</p>
                  <p className="text-xs text-gray-500">{p.suburb}, {p.city} · {p.bedrooms}bd / {p.bathrooms}ba</p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm font-medium text-gray-700">${p.rentPrice}/wk</span>
                  <span className={`badge ${
                    p.status === 'tenanted' ? 'bg-green-100 text-green-700' :
                    p.status === 'vacant' ? 'bg-gray-100 text-gray-600' :
                    'bg-orange-100 text-orange-700'
                  }`}>
                    {p.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400 text-center py-8">No properties added yet</p>
        )}
      </div>
    </div>
  )
}
