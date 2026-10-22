import api from './client'
import { AuditEvent, LeaseMethodInfo, LeaseRecord, SampleLease } from '../types/leases'

const BASE = '/lease-abstracts'

export const getLeaseMethod = () => api.get<LeaseMethodInfo>(`${BASE}/method`).then(r => r.data)
export const getLeaseSamples = () => api.get<SampleLease[]>(`${BASE}/samples`).then(r => r.data)
export const abstractSample = (file: string) => api.post<LeaseRecord>(`${BASE}/samples/${encodeURIComponent(file)}`).then(r => r.data)
export const getLeases = () => api.get<LeaseRecord[]>(BASE).then(r => r.data)
export const getLease = (id: number) => api.get<LeaseRecord>(`${BASE}/${id}`).then(r => r.data)
export const getLeaseAudit = (id: number) => api.get<AuditEvent[]>(`${BASE}/${id}/audit`).then(r => r.data)

/** The original PDF as a blob: the request carries the token, so a plain URL can't be used. */
export const getLeaseFile = (id: number) => api.get<Blob>(`${BASE}/${id}/file`, { responseType: 'blob' }).then(r => r.data)

export const uploadLease = (file: File) => {
  const form = new FormData()
  form.append('file', file)
  return api.post<LeaseRecord>(BASE, form).then(r => r.data)
}

export const approveTerm = (id: number, field: string) => api.post<LeaseRecord>(`${BASE}/${id}/fields/${field}`, { approve: true }).then(r => r.data)
export const correctTerm = (id: number, field: string, value: unknown) => api.post<LeaseRecord>(`${BASE}/${id}/fields/${field}`, { value }).then(r => r.data)
export const reviewRisk = (id: number, code: string, status: string, note?: string) =>
  api.post<LeaseRecord>(`${BASE}/${id}/risks/${code}`, { status, note }).then(r => r.data)
export const approveLease = (id: number, reviewSeconds: number) => api.post<LeaseRecord>(`${BASE}/${id}/approve`, { reviewSeconds }).then(r => r.data)
export const rejectLease = (id: number, reviewSeconds: number, reason?: string) =>
  api.post<LeaseRecord>(`${BASE}/${id}/reject`, { reviewSeconds, reason }).then(r => r.data)

/** Downloads the abstraction as JSON or CSV and returns the file name. */
export async function downloadLeaseExport(id: number, format: 'json' | 'csv'): Promise<string> {
  const res = await api.get<Blob>(`${BASE}/${id}/export`, { params: format === 'csv' ? { format } : {}, responseType: 'blob' })
  const disposition = String(res.headers['content-disposition'] ?? '')
  const name = disposition.match(/filename="([^"]+)"/)?.[1] ?? `lease-abstract.${format}`
  const url = URL.createObjectURL(res.data)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return name
}
