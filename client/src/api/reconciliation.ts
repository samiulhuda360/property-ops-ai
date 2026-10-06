import api from './client'
import type {
  BankLine,
  BatchInfo,
  BatchSummary,
  ImportResult,
  JobOption,
  LeaseOption,
  ResolveInput,
  StatusFilter,
} from '../types/reconciliation'

export const getBatches = () => api.get<BatchInfo[]>('/reconciliation/batches').then((r) => r.data)

export const getSummary = (batch?: string) =>
  api.get<BatchSummary>('/reconciliation/summary', { params: { batch } }).then((r) => r.data)

export const getLines = (batch?: string, status: StatusFilter = 'all') =>
  api.get<BankLine[]>('/reconciliation/transactions', { params: { batch, status } }).then((r) => r.data)

export const importStatement = (file: File) => {
  const form = new FormData()
  form.append('file', file)
  return api.post<ImportResult>('/reconciliation/import', form).then((r) => r.data)
}

export const loadDemoStatement = () => api.post<ImportResult>('/reconciliation/demo').then((r) => r.data)

export const resolveLine = (id: number, input: ResolveInput) =>
  api.post<BankLine>(`/reconciliation/transactions/${id}/resolve`, input).then((r) => r.data)

export const getLeaseOptions = () => api.get<LeaseOption[]>('/leases').then((r) => r.data)

export const getJobOptions = () => api.get<JobOption[]>('/maintenance').then((r) => r.data)

/** Downloads the Excel workbook for a statement (the request carries the sign-in token, so it can't be a plain link). */
export async function downloadWorkbook(batch?: string) {
  const res = await api.get<Blob>('/reconciliation/export.xlsx', { params: { batch }, responseType: 'blob' })
  const disposition = String(res.headers['content-disposition'] ?? '')
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'reconciliation.xlsx'
  const url = URL.createObjectURL(res.data)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
