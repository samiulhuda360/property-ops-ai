import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getTenants, createTenant, updateTenant, deleteTenant } from '../api/tenants'
import { Tenant } from '../types'
import Modal from '../components/Modal'

const EMPTY: Partial<Tenant> = { firstName: '', lastName: '', email: '', phone: '' }

export default function Tenants() {
  const qc = useQueryClient()
  const { data: tenants = [], isLoading } = useQuery({ queryKey: ['tenants'], queryFn: getTenants })
  const [modal, setModal] = useState<'add' | 'edit' | null>(null)
  const [editing, setEditing] = useState<Tenant | null>(null)
  const [form, setForm] = useState<Partial<Tenant>>(EMPTY)
  const [deleteId, setDeleteId] = useState<number | null>(null)

  const create = useMutation({ mutationFn: createTenant, onSuccess: () => { qc.invalidateQueries({ queryKey: ['tenants'] }); setModal(null) } })
  const update = useMutation({ mutationFn: ({ id, data }: { id: number; data: Partial<Tenant> }) => updateTenant(id, data), onSuccess: () => { qc.invalidateQueries({ queryKey: ['tenants'] }); setModal(null) } })
  const remove = useMutation({ mutationFn: deleteTenant, onSuccess: () => { qc.invalidateQueries({ queryKey: ['tenants'] }); setDeleteId(null) } })

  const openAdd = () => { setForm(EMPTY); setModal('add') }
  const openEdit = (t: Tenant) => { setEditing(t); setForm(t); setModal('edit') }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (modal === 'edit' && editing) update.mutate({ id: editing.id, data: form })
    else create.mutate(form)
  }

  const f = (field: keyof Tenant, val: string) => setForm(prev => ({ ...prev, [field]: val }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tenants</h1>
          <p className="text-gray-500 mt-1">{tenants.length} tenants registered</p>
        </div>
        <button className="btn-primary" onClick={openAdd}>
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Tenant
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : tenants.length === 0 ? (
        <div className="card text-center py-16">
          <p className="text-gray-400 text-lg">No tenants yet</p>
          <button className="btn-primary mt-4" onClick={openAdd}>Add Tenant</button>
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-6 py-3">Name</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-6 py-3">Email</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-6 py-3">Phone</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide px-6 py-3">Current Property</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tenants.map(t => {
                const activeLease = t.leases?.find(l => l.status === 'active')
                return (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                          <span className="text-blue-700 text-sm font-semibold">{t.firstName.charAt(0)}</span>
                        </div>
                        <span className="font-medium text-gray-900">{t.firstName} {t.lastName}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{t.email}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{t.phone}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {activeLease ? (
                        <span>{activeLease.property?.address}</span>
                      ) : (
                        <span className="text-gray-400">No active lease</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => openEdit(t)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button onClick={() => setDeleteId(t.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={modal !== null} onClose={() => setModal(null)} title={modal === 'edit' ? 'Edit Tenant' : 'Add Tenant'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">First Name</label>
              <input className="input" value={form.firstName || ''} onChange={e => f('firstName', e.target.value)} placeholder="Sarah" required />
            </div>
            <div>
              <label className="label">Last Name</label>
              <input className="input" value={form.lastName || ''} onChange={e => f('lastName', e.target.value)} placeholder="Thompson" required />
            </div>
          </div>
          <div>
            <label className="label">Email</label>
            <input type="email" className="input" value={form.email || ''} onChange={e => f('email', e.target.value)} placeholder="sarah@example.com" required />
          </div>
          <div>
            <label className="label">Phone</label>
            <input className="input" value={form.phone || ''} onChange={e => f('phone', e.target.value)} placeholder="021 123 4567" required />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => setModal(null)}>Cancel</button>
            <button type="submit" className="btn-primary flex-1" disabled={create.isPending || update.isPending}>
              {create.isPending || update.isPending ? 'Saving...' : modal === 'edit' ? 'Save Changes' : 'Add Tenant'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={deleteId !== null} onClose={() => setDeleteId(null)} title="Remove Tenant">
        <p className="text-gray-600 mb-6">Remove this tenant? Their lease history will also be deleted.</p>
        <div className="flex gap-3">
          <button className="btn-secondary flex-1" onClick={() => setDeleteId(null)}>Cancel</button>
          <button className="btn-danger flex-1" onClick={() => deleteId && remove.mutate(deleteId)} disabled={remove.isPending}>
            {remove.isPending ? 'Removing...' : 'Remove'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
