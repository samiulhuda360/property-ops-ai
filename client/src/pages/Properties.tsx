import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getProperties, createProperty, updateProperty, deleteProperty } from '../api/properties'
import { Property } from '../types'
import Modal from '../components/Modal'

const EMPTY: Partial<Property> = { address: '', suburb: '', city: '', bedrooms: 3, bathrooms: 1, rentPrice: 500, status: 'vacant', description: '' }

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    tenanted: 'bg-green-100 text-green-700',
    vacant: 'bg-gray-100 text-gray-600',
    maintenance: 'bg-orange-100 text-orange-700',
  }
  return <span className={`badge ${map[status] || ''}`}>{status}</span>
}

export default function Properties() {
  const qc = useQueryClient()
  const { data: properties = [], isLoading } = useQuery({ queryKey: ['properties'], queryFn: getProperties })
  const [modal, setModal] = useState<'add' | 'edit' | null>(null)
  const [editing, setEditing] = useState<Property | null>(null)
  const [form, setForm] = useState<Partial<Property>>(EMPTY)
  const [deleteId, setDeleteId] = useState<number | null>(null)

  const create = useMutation({ mutationFn: createProperty, onSuccess: () => { qc.invalidateQueries({ queryKey: ['properties'] }); setModal(null) } })
  const update = useMutation({ mutationFn: ({ id, data }: { id: number; data: Partial<Property> }) => updateProperty(id, data), onSuccess: () => { qc.invalidateQueries({ queryKey: ['properties'] }); setModal(null) } })
  const remove = useMutation({ mutationFn: deleteProperty, onSuccess: () => { qc.invalidateQueries({ queryKey: ['properties'] }); setDeleteId(null) } })

  const openAdd = () => { setForm(EMPTY); setModal('add') }
  const openEdit = (p: Property) => { setEditing(p); setForm(p); setModal('edit') }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (modal === 'edit' && editing) update.mutate({ id: editing.id, data: form })
    else create.mutate(form)
  }

  const f = (field: keyof Property, val: string | number) => setForm(prev => ({ ...prev, [field]: val }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Properties</h1>
          <p className="text-gray-500 mt-1">{properties.length} properties in your portfolio</p>
        </div>
        <button className="btn-primary" onClick={openAdd}>
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Property
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : properties.length === 0 ? (
        <div className="card text-center py-16">
          <p className="text-gray-400 text-lg">No properties yet</p>
          <p className="text-gray-400 text-sm mt-1">Add your first rental property to get started</p>
          <button className="btn-primary mt-4" onClick={openAdd}>Add Property</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {properties.map(p => (
            <div key={p.id} className="card hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <StatusBadge status={p.status} />
                <div className="flex gap-1">
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
              </div>
              <h3 className="font-semibold text-gray-900">{p.address}</h3>
              <p className="text-sm text-gray-500">{p.suburb}, {p.city}</p>
              <div className="mt-3 flex items-center justify-between text-sm">
                <span className="text-gray-500">{p.bedrooms}bd / {p.bathrooms}ba</span>
                <span className="font-semibold text-gray-900">${p.rentPrice}/wk</span>
              </div>
              {p.leases && p.leases.length > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-100">
                  <p className="text-xs text-gray-500">
                    Tenant: {p.leases[0].tenant?.firstName} {p.leases[0].tenant?.lastName}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={modal !== null} onClose={() => setModal(null)} title={modal === 'edit' ? 'Edit Property' : 'Add Property'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Street Address</label>
            <input className="input" value={form.address || ''} onChange={e => f('address', e.target.value)} placeholder="12 Example St" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Suburb</label>
              <input className="input" value={form.suburb || ''} onChange={e => f('suburb', e.target.value)} placeholder="Ponsonby" required />
            </div>
            <div>
              <label className="label">City</label>
              <input className="input" value={form.city || ''} onChange={e => f('city', e.target.value)} placeholder="Auckland" required />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">Bedrooms</label>
              <input type="number" className="input" value={form.bedrooms || ''} onChange={e => f('bedrooms', e.target.value)} min={1} required />
            </div>
            <div>
              <label className="label">Bathrooms</label>
              <input type="number" step="0.5" className="input" value={form.bathrooms || ''} onChange={e => f('bathrooms', e.target.value)} min={1} required />
            </div>
            <div>
              <label className="label">Rent ($/wk)</label>
              <input type="number" className="input" value={form.rentPrice || ''} onChange={e => f('rentPrice', e.target.value)} min={0} required />
            </div>
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={form.status || 'vacant'} onChange={e => f('status', e.target.value)}>
              <option value="vacant">Vacant</option>
              <option value="tenanted">Tenanted</option>
              <option value="maintenance">Maintenance</option>
            </select>
          </div>
          <div>
            <label className="label">Description (optional)</label>
            <textarea className="input" rows={3} value={form.description || ''} onChange={e => f('description', e.target.value)} placeholder="Property details..." />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => setModal(null)}>Cancel</button>
            <button type="submit" className="btn-primary flex-1" disabled={create.isPending || update.isPending}>
              {create.isPending || update.isPending ? 'Saving...' : modal === 'edit' ? 'Save Changes' : 'Add Property'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={deleteId !== null} onClose={() => setDeleteId(null)} title="Delete Property">
        <p className="text-gray-600 mb-6">Are you sure you want to delete this property? This will also remove all associated leases, payments, and maintenance requests.</p>
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
