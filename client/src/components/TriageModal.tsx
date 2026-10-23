import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSampleRequests, getTriageMethod, triageRequest, triageSample } from '../api/maintenance'
import { getProperties } from '../api/properties'
import { MaintenanceRequest } from '../types'
import Modal from './Modal'

export default function TriageModal({ isOpen, onClose, onDone }: { isOpen: boolean; onClose: () => void; onDone: (job: MaintenanceRequest) => void }) {
  const qc = useQueryClient()
  const { data: properties = [] } = useQuery({ queryKey: ['properties'], queryFn: getProperties })
  const { data: samples = [] } = useQuery({ queryKey: ['maintenance-samples'], queryFn: getSampleRequests, enabled: isOpen })
  const { data: method } = useQuery({ queryKey: ['triage-method'], queryFn: getTriageMethod, enabled: isOpen })
  const [propertyId, setPropertyId] = useState<number | ''>('')
  const [text, setText] = useState('')
  const [photoNote, setPhotoNote] = useState('')
  const [sample, setSample] = useState('')
  const [error, setError] = useState('')

  const finish = (job: MaintenanceRequest) => {
    qc.invalidateQueries({ queryKey: ['maintenance'] })
    setText('')
    setPhotoNote('')
    setSample('')
    setError('')
    onDone(job)
  }
  const run = useMutation({
    mutationFn: () => (sample ? triageSample(sample) : triageRequest({ propertyId: Number(propertyId), text, photoNote: photoNote || undefined })),
    onSuccess: finish,
    onError: (e: any) => setError(e.response?.data?.error || 'The request could not be triaged.'),
  })

  const pick = (id: string) => {
    setSample(id)
    const s = samples.find((x) => x.id === id)
    if (s) {
      setText(s.text)
      setPhotoNote(s.photoNote ?? '')
      const p = properties.find((x) => x.code === s.code)
      setPropertyId(p?.id ?? '')
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Triage a tenant request">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          run.mutate()
        }}
      >
        <p className="text-sm text-gray-500">
          Paste what the tenant sent. The app classifies it, flags safety cases as urgent, suggests a contractor and drafts a work order for you to approve.
          {method && <span className="text-gray-400"> Method right now: {method.method === 'rules' ? 'rules only' : `${method.model} with the rules as a safety net`}.</span>}
        </p>
        {samples.length > 0 && (
          <div>
            <label className="label">Or pick a sample request</label>
            <select className="input" value={sample} onChange={(e) => pick(e.target.value)}>
              <option value="">Write my own</option>
              {samples.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id} · {s.code} · {s.text.slice(0, 70)}
                  {s.text.length > 70 ? '...' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="label">Property</label>
          <select className="input" value={propertyId} onChange={(e) => setPropertyId(e.target.value ? Number(e.target.value) : '')} required disabled={Boolean(sample)}>
            <option value="">Select property...</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.address}
                {p.code ? ` (${p.code})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">The tenant's message</label>
          <textarea className="input" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. There's a smell of gas in the kitchen since this morning..." required disabled={Boolean(sample)} />
        </div>
        <div>
          <label className="label">Photo description (optional)</label>
          <input className="input" value={photoNote} onChange={(e) => setPhotoNote(e.target.value)} placeholder="What the attached photo shows" disabled={Boolean(sample)} />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-3 pt-2">
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary flex-1" disabled={run.isPending}>
            {run.isPending ? 'Triaging...' : 'Triage'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
