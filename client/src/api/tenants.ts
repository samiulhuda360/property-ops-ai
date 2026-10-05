import api from './client'
import { Tenant } from '../types'

export const getTenants = () => api.get<Tenant[]>('/tenants').then(r => r.data)
export const getTenant = (id: number) => api.get<Tenant>(`/tenants/${id}`).then(r => r.data)
export const createTenant = (data: Partial<Tenant>) => api.post<Tenant>('/tenants', data).then(r => r.data)
export const updateTenant = (id: number, data: Partial<Tenant>) => api.put<Tenant>(`/tenants/${id}`, data).then(r => r.data)
export const deleteTenant = (id: number) => api.delete(`/tenants/${id}`).then(r => r.data)
