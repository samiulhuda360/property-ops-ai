import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getCompanyUsers, setUserRole } from '../api/auth'
import { useAuth } from '../contexts/AuthContext'

export default function Company() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const { data, isLoading } = useQuery({ queryKey: ['company-users'], queryFn: getCompanyUsers })
  const [error, setError] = useState('')
  const change = useMutation({
    mutationFn: ({ id, role }: { id: number; role: string }) => setUserRole(id, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company-users'] })
      setError('')
    },
    onError: (e: any) => setError(e.response?.data?.error || 'The role could not be changed.'),
  })
  const isManager = user?.role === 'manager'
  const money = (n: number | null) => (n === null ? 'no limit' : `up to ${n.toLocaleString()}`)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{user?.organisation?.name ?? 'Company'}</h1>
        <p className="text-gray-500 mt-1">Who can see and approve what. Every user only ever sees this company's data.</p>
      </div>

      {isLoading || !data ? (
        <p className="text-gray-500">Loading...</p>
      ) : (
        <>
          <div className="card overflow-hidden p-0">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Role', 'Can decide', 'Supplier invoices', 'Work orders'].map((h) => (
                    <th key={h} className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-6 py-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm">
                {data.roles.map((r) => (
                  <tr key={r.role}>
                    <td className="px-6 py-3 font-medium text-gray-900">{r.label}</td>
                    <td className="px-6 py-3 text-gray-600">{r.limits.canDecide ? 'Approve, correct, dismiss' : 'Look only'}</td>
                    <td className="px-6 py-3 text-gray-600">{r.limits.canDecide ? money(r.limits.invoice) : '–'}</td>
                    <td className="px-6 py-3 text-gray-600">{r.limits.canDecide ? money(r.limits.workOrder) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card overflow-hidden p-0">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Name', 'Email', 'Role'].map((h) => (
                    <th key={h} className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-6 py-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm">
                {data.users.map((u) => (
                  <tr key={u.id}>
                    <td className="px-6 py-3 font-medium text-gray-900">
                      {u.name}
                      {u.id === user?.id && <span className="text-xs text-gray-400"> (you)</span>}
                    </td>
                    <td className="px-6 py-3 text-gray-600">{u.email}</td>
                    <td className="px-6 py-3">
                      {isManager && u.id !== user?.id ? (
                        <select className="input w-auto" value={u.role} onChange={(e) => change.mutate({ id: u.id, role: e.target.value })} disabled={change.isPending}>
                          {data.roles.map((r) => (
                            <option key={r.role} value={r.role}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-gray-600">{data.roles.find((r) => r.role === u.role)?.label ?? u.role}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!isManager && <p className="text-xs text-gray-400">Only a manager can change roles. Every role change is written to the audit trail.</p>}
        </>
      )}
    </div>
  )
}
