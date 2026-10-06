import api from './client'
import type { InboxMessage, InboxMessageDetail, InboxMeta, InboxStatusFilter } from '../types/inbox'

export const getInboxMeta = () => api.get<InboxMeta>('/inbox/meta').then((r) => r.data)

export const getInbox = (filters: { status: InboxStatusFilter; category: string }) =>
  api
    .get<InboxMessage[]>('/inbox', {
      params: { status: filters.status === 'all' ? undefined : filters.status, category: filters.category === 'all' ? undefined : filters.category },
    })
    .then((r) => r.data)

export const getInboxMessage = (id: number) => api.get<InboxMessageDetail>(`/inbox/${id}`).then((r) => r.data)

/** Stores the reply as approved. The server sends nothing. */
export const approveInboxMessage = (id: number, data: { replyDraft: string; reviewSeconds: number }) =>
  api.post<InboxMessage>(`/inbox/${id}/approve`, data).then((r) => r.data)

export const dismissInboxMessage = (id: number, data: { reviewSeconds: number }) =>
  api.post<InboxMessage>(`/inbox/${id}/dismiss`, data).then((r) => r.data)

export const retriageInboxMessage = (id: number) => api.post<InboxMessage>(`/inbox/${id}/retriage`).then((r) => r.data)

export const loadInboxDemo = () =>
  api.post<{ loaded: number; alreadyLoaded: number; method: string }>('/inbox/demo').then((r) => r.data)
