import api from './client'
import { MaintenanceRequest } from '../types'
import { SampleRequest, TriageMethodInfo } from '../types/maintenance'

export const getMaintenanceRequests = () => api.get<MaintenanceRequest[]>('/maintenance').then(r => r.data)
export const createMaintenanceRequest = (data: Partial<MaintenanceRequest>) => api.post<MaintenanceRequest>('/maintenance', data).then(r => r.data)
export const updateMaintenanceRequest = (id: number, data: Partial<MaintenanceRequest>) => api.put<MaintenanceRequest>(`/maintenance/${id}`, data).then(r => r.data)
export const deleteMaintenanceRequest = (id: number) => api.delete(`/maintenance/${id}`).then(r => r.data)

export const getTriageMethod = () => api.get<TriageMethodInfo>('/maintenance/method').then((r) => r.data)
export const getSampleRequests = () => api.get<SampleRequest[]>('/maintenance/samples').then((r) => r.data)
export const triageRequest = (body: { propertyId: number; text: string; photoNote?: string }) => api.post<MaintenanceRequest>('/maintenance/triage', body).then((r) => r.data)
export const triageSample = (id: string) => api.post<MaintenanceRequest>(`/maintenance/samples/${id}`).then((r) => r.data)
export const approveWorkOrder = (id: number, body: { contractorId?: number | null; scope?: string; accessNotes?: string; budgetHigh?: number | null; reviewSeconds: number }) =>
  api.post<MaintenanceRequest>(`/maintenance/${id}/work-order/approve`, body).then((r) => r.data)
export const rejectWorkOrder = (id: number, body: { reason?: string; reviewSeconds: number }) =>
  api.post<MaintenanceRequest>(`/maintenance/${id}/work-order/reject`, body).then((r) => r.data)
