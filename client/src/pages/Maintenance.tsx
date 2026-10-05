import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getMaintenanceRequests, createMaintenanceRequest, updateMaintenanceRequest, deleteMaintenanceRequest } from '../api/maintenance'
import { getProperties } from '../api/properties'
import { MaintenanceRequest } from '../types'
import Modal from '../components/Modal'
import { format } from 'date-fns'

const EMPTY: Partial<MaintenanceRequest> = { title: '', description: '', priority: 'medium', status: 'open' }

const priorityColors: Record<string, string> = {
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
}

const statusColors: Record<string, string> = {
  open: 'bg-yellow-100 text-yellow-700',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
}

export default function Maintenance() {
  const qc = useQueryClient()
  const { data: requests = [], isLoading } = useQuery({ queryKey: ['maintenance'], queryFn: getMaintenanceRequests })
  const { data: properties = [] } = useQuery({ queryKey: ['properties'], queryFn: getProperties })
  const [modal, setModal] = useState<'add' | 'edit' | null>(null)
  const [editing, setEditing] = useState<MaintenanceRequest | null>(null)
  const [form, setForm] = useState<Partial<MaintenanceRequest>>(EMPTY)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [filter, setFilter] = useState<string>('all')

  const create = useMutation({ mutationFn: createMaintenanceRequest, onSuccess: () => { qc.invalidateQueries({ queryKey: ['maintenance'] }); setModal(null) } })
  const update = useMutation({ mutationFn: ({ id, data }: { id: number; data: Partial<MaintenanceRequest> }) => updateMaintenanceRequest(id, data), onSuccess: () => { qc.invalidateQueries({ queryKey: ['maintenance'] }); setModal(null) } })
  const remove = useMutation({ mutationFn: deleteMaintenanceRequest, onSuccess: () => { qc.invalidateQueries({ queryKey: ['maintenance'] }); setDeleteId(null) } })

  const openAdd = () => { setForm(EMPTY); setModal('add') }
  const openEdit = (r: MaintenanceRequest) => { setEditing(r); setForm(r); setModal('edit') }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (modal === 'edit' && editing) update.mutate({ id: editing.id, data: form })
    else create.mutate(form)
  }

  const f = (field: keyof MaintenanceRequest, val: string | number) => setForm(prev => ({ ...prev, [field]: val }))

  const filtered = filter === 'all' ? requests : requests.filter(r => r.status === filter)
  const openCount = requests.filter(r => r.status === 'open').length
  const inProgressCount = requests.filter(r => r.status === 'in_progress').length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Maintenance</h1>
          <p className="text-gray-500 mt-1">{openCount} open · {inProgressCount} in progress</p>
        </div>
        <button className="btn-primary" onClick={openAdd}>
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Request
        </button>
      </div>

      <div className="flex gap-2">
        {['all', 'open', 'in_progress', 'completed'].map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === s ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {s === 'in_progress' ? 'In Progress' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-16">
          <p className="text-gray-400 text-lg">No maintenance requests</p>
          {filter === 'all' && <button className="btn-primary mt-4" onClick={openAdd}>Add Request</button>}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(r => (
            <div key={r.id} className="card hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h3 className="font-semibold text-gray-900">{r.title}</h3>
                    <span className={`badge ${priorityColors[r.priority]}`}>{r.priority}</span>
                    <span className={`badge ${statusColors[r.status]}`}>{r.status.replace('_', ' ')}</span>
                  </div>
                  <p className="text-sm text-gray-500 mb-2">{r.property?.address}</p>
                  <p className="text-sm text-gray-600">{r.description}</p>
                  <div className="mt-2 flex items-center gap-4 text-xs text-gray-400">
                    <span>Logged {format(new Date(r.createdAt), 'd MMM yyyy')}</span>
                    {r.completedAt && <span>Completed {format(new Date(r.completedAt), 'd MMM yyyy')}</span>}
                    {r.cost && <span>Cost: ${r.cost}</span>}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => openEdit(r)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button onClick={() => setDeleteId(r.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={modal !== null} onClose={() => setModal(null)} title={modal === 'edit' ? 'Edit Request' : 'New Maintenance Request'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Property</label>
            <select className="input" value={form.propertyId || ''} onChange={e => f('propertyId', Number(e.target.value))} required>
              <option value="">Select property...</option>
              {properties.map(p => (
                <option key={p.id} value={p.id}>{p.address}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Title</label>
            <input className="input" value={form.title || ''} onChange={e => f('title', e.target.value)} placeholder="e.g. Fix leaking tap" required />
          </div>
          <div>
            <label className="label">Description</label>
            <textarea className="input" rows={3} value={form.description || ''} onChange={e => f('description', e.target.value)} placeholder="Describe the issue..." required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Priority</label>
              <select className="input" value={form.priority || 'medium'} onChange={e => f('priority', e.target.value)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input" value={form.status || 'open'} onChange={e => f('status', e.target.value)}>
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          </div>
          {(form.status === 'completed' || modal === 'edit') && (
            <div>
              <label className="label">Cost (optional)</label>
              <input type="number" className="input" value={form.cost || ''} onChange={e => f('cost', e.target.value)} min={0} placeholder="0.00" />
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => setModal(null)}>Cancel</button>
            <button type="submit" className="btn-primary flex-1" disabled={create.isPending || update.isPending}>
              {create.isPending || update.isPending ? 'Saving...' : modal === 'edit' ? 'Save Changes' : 'Create Request'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={deleteId !== null} onClose={() => setDeleteId(null)} title="Delete Request">
        <p className="text-gray-600 mb-6">Delete this maintenance request?</p>
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
