import api from './client'
import { MaintenanceRequest } from '../types'

export const getMaintenanceRequests = () => api.get<MaintenanceRequest[]>('/maintenance').then(r => r.data)
export const createMaintenanceRequest = (data: Partial<MaintenanceRequest>) => api.post<MaintenanceRequest>('/maintenance', data).then(r => r.data)
export const updateMaintenanceRequest = (id: number, data: Partial<MaintenanceRequest>) => api.put<MaintenanceRequest>(`/maintenance/${id}`, data).then(r => r.data)
export const deleteMaintenanceRequest = (id: number) => api.delete(`/maintenance/${id}`).then(r => r.data)
