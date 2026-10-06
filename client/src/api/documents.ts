import axios from 'axios'
import api from './client'
import { ApproveResult, DocumentRecord, MethodInfo, PushResult } from '../types/documents'

export const getDocuments = () => api.get<DocumentRecord[]>('/documents').then(r => r.data)
export const getDocument = (id: number) => api.get<DocumentRecord>(`/documents/${id}`).then(r => r.data)
export const getExtractionMethod = () => api.get<MethodInfo>('/documents/method').then(r => r.data)

/** The original PDF as a blob: the request carries the token, so a plain iframe src can't be used. */
export const getDocumentFile = (id: number) =>
  api.get<Blob>(`/documents/${id}/file`, { responseType: 'blob' }).then(r => r.data)

export const uploadDocument = (file: File) => {
  const form = new FormData()
  form.append('file', file)
  return api.post<DocumentRecord>('/documents', form).then(r => r.data)
}

export const approveDocument = (id: number, fields: Record<string, unknown>, reviewSeconds: number) =>
  api.post<ApproveResult>(`/documents/${id}/approve`, { fields, reviewSeconds }).then(r => r.data)

export const rejectDocument = (id: number, reviewSeconds: number, reason?: string) =>
  api.post<DocumentRecord>(`/documents/${id}/reject`, { reviewSeconds, reason }).then(r => r.data)

export const pushDocument = (id: number) => api.post<PushResult>(`/documents/${id}/push`).then(r => r.data)

/** Downloads the Xero bill-import CSV of approved invoices (they become exported) and returns the file name. */
export async function downloadXeroBills(): Promise<string> {
  const res = await api.get<Blob>('/documents/export/xero-bills.csv', { responseType: 'blob' })
  const disposition = String(res.headers['content-disposition'] ?? '')
  const name = disposition.match(/filename="([^"]+)"/)?.[1] ?? 'xero-bills.csv'
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

/** The server's error message, including from blob responses. */
export async function errorMessage(err: unknown, fallback = 'Something went wrong.'): Promise<string> {
  if (!axios.isAxiosError(err)) return fallback
  const data = err.response?.data
  if (data instanceof Blob) {
    try {
      return JSON.parse(await data.text()).error ?? fallback
    } catch {
      return fallback
    }
  }
  return (data as { error?: string } | undefined)?.error ?? fallback
}
