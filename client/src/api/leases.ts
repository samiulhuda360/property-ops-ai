import api from './client'
import { Lease } from '../types'

export const getLeases = () => api.get<Lease[]>('/leases').then(r => r.data)
export const createLease = (data: Partial<Lease>) => api.post<Lease>('/leases', data).then(r => r.data)
export const updateLease = (id: number, data: Partial<Lease>) => api.put<Lease>(`/leases/${id}`, data).then(r => r.data)
export const deleteLease = (id: number) => api.delete(`/leases/${id}`).then(r => r.data)
