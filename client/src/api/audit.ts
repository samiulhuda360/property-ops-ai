import api from './client'
import { AuditEvent, AuditFilter, AuditMeta } from '../types/audit'

const clean = (f: AuditFilter) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== '' && v !== null))

export const getAuditMeta = () => api.get<AuditMeta>('/audit/meta').then((r) => r.data)
export const getAudit = (filter: AuditFilter) => api.get<AuditEvent[]>('/audit', { params: clean(filter) }).then((r) => r.data)

/** Downloads the filtered trail as CSV (the request needs the auth header, so it goes through axios). */
export async function downloadAuditCsv(filter: AuditFilter) {
  const res = await api.get('/audit/export.csv', { params: clean(filter), responseType: 'blob' })
  const url = URL.createObjectURL(res.data as Blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
