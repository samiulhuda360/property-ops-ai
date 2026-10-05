import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getPayments, createPayment, updatePayment, deletePayment } from '../api/payments'
import { getLeases } from '../api/leases'
import { Payment } from '../types'
import Modal from '../components/Modal'
import { format } from 'date-fns'

const EMPTY: Partial<Payment> = { leaseId: undefined, amount: 0, dueDate: '', status: 'pending' }

function statusBadge(status: string) {
  const map: Record<string, string> = {
    paid: 'bg-green-100 text-green-700',
    overdue: 'bg-red-100 text-red-700',
    pending: 'bg-yellow-100 text-yellow-700',
  }
  return <span className={`badge ${map[status] || ''}`}>{status}</span>
}

export default function Payments() {
  const qc = useQueryClient()
  const { data: payments = [], isLoading } = useQuery({ queryKey: ['payments'], queryFn: getPayments })
  const { data: leases = [] } = useQuery({ queryKey: ['leases'], queryFn: getLeases })
  const [modal, setModal] = useState<'add' | 'edit' | null>(null)
  const [editing, setEditing] = useState<Payment | null>(null)
  const [form, setForm] = useState<Partial<Payment>>(EMPTY)
  const [deleteId, setDeleteId] = useState<number | null>(null)

  const create = useMutation({ mutationFn: createPayment, onSuccess: () => { qc.invalidateQueries({ queryKey: ['payments'] }); setModal(null) } })
  const update = useMutation({ mutationFn: ({ id, data }: { id: number; data: Partial<Payment> }) => updatePayment(id, data), onSuccess: () => { qc.invalidateQueries({ queryKey: ['payments'] }); setModal(null) } })
  const remove = useMutation({ mutationFn: deletePayment, onSuccess: () => { qc.invalidateQueries({ queryKey: ['payments'] }); setDeleteId(null) } })

  const openAdd = () => { setForm(EMPTY); setModal('add') }
  const openEdit = (p: Payment) => {
    setEditing(p)
    setForm({ ...p, dueDate: p.dueDate.substring(0, 10), paidDate: p.paidDate?.substring(0, 10) })
    setModal('edit')
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (modal === 'edit' && editing) update.mutate({ id: editing.id, data: form })
    else create.mutate(form)
  }

  const f = (field: keyof Payment, val: string | number) => setForm(prev => ({ ...prev, [field]: val }))

  const activeLeases = leases.filter(l => l.status === 'active')
  const totalCollected = payments.filter(p => p.status === 'paid').reduce((sum, p) => sum + p.amount, 0)
  const totalPending = payments.filter(p => p.status !== 'paid').reduce((sum, p) => sum + p.amount, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payments</h1>
          <p className="text-gray-500 mt-1">Track rent payments and arrears</p>
        </div>
        <button className="btn-primary" onClick={openAdd}>
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Record Payment
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="card">
          <p className="text-sm text-gray-500">Total Collected</p>
          <p className="text-2xl font-bold text-green-600">${totalCollected.toLocaleString()}</p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500">Pending / Overdue</p>
          <p className="text-2xl font-bold text-yellow-600">${totalPending.toLocaleString()}</p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500">Total Transactions</p>
          <p className="text-2xl font-bold text-gray-900">{payments.length}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : payments.length === 0 ? (
        <div className="card text-center py-16">
          <p className="text-gray-400 text-lg">No payments recorded yet</p>
          <button className="btn-primary mt-4" onClick={openAdd}>Record Payment</button>
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-6 py-3">Tenant</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-6 py-3">Property</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-6 py-3">Amount</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-6 py-3">Due Date</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-6 py-3">Status</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {payments.map(p => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">
                    {p.lease?.tenant?.firstName} {p.lease?.tenant?.lastName}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{p.lease?.property?.address}</td>
                  <td className="px-6 py-4 text-sm font-semibold text-gray-900">${p.amount}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {format(new Date(p.dueDate), 'd MMM yyyy')}
                  </td>
                  <td className="px-6 py-4">{statusBadge(p.status)}</td>
                  <td className="px-6 py-4">
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => openEdit(p)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button onClick={() => setDeleteId(p.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={modal !== null} onClose={() => setModal(null)} title={modal === 'edit' ? 'Edit Payment' : 'Record Payment'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Lease</label>
            <select className="input" value={form.leaseId || ''} onChange={e => f('leaseId', Number(e.target.value))} required>
              <option value="">Select lease...</option>
              {activeLeases.map(l => (
                <option key={l.id} value={l.id}>
                  {l.tenant?.firstName} {l.tenant?.lastName} — {l.property?.address}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Amount ($)</label>
              <input type="number" className="input" value={form.amount || ''} onChange={e => f('amount', e.target.value)} min={0} required />
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input" value={form.status || 'pending'} onChange={e => f('status', e.target.value)}>
                <option value="pending">Pending</option>
                <option value="paid">Paid</option>
                <option value="overdue">Overdue</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Due Date</label>
              <input type="date" className="input" value={form.dueDate as string || ''} onChange={e => f('dueDate', e.target.value)} required />
            </div>
            <div>
              <label className="label">Paid Date (optional)</label>
              <input type="date" className="input" value={form.paidDate as string || ''} onChange={e => f('paidDate', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Notes (optional)</label>
            <input className="input" value={form.notes || ''} onChange={e => f('notes', e.target.value)} placeholder="Any notes..." />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => setModal(null)}>Cancel</button>
            <button type="submit" className="btn-primary flex-1" disabled={create.isPending || update.isPending}>
              {create.isPending || update.isPending ? 'Saving...' : modal === 'edit' ? 'Save Changes' : 'Record'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={deleteId !== null} onClose={() => setDeleteId(null)} title="Delete Payment">
        <p className="text-gray-600 mb-6">Delete this payment record? This cannot be undone.</p>
        <div className="flex gap-3">
          <button className="btn-secondary flex-1" onClick={() => setDeleteId(null)}>Cancel</button>
          <button className="btn-danger flex-1" onClick={() => deleteId && remove.mutate(deleteId)} disabled={remove.isPending}>
            {remove.isPending ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
