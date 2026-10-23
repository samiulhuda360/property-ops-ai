import api from './client'
import { RentMonthRow, RiskModelInfo, TenantRisk } from '../types/risk'

export const getRisks = (band?: string) => api.get<TenantRisk[]>('/risk', { params: band ? { band } : {} }).then((r) => r.data)
export const getRisk = (id: number) => api.get<TenantRisk & { history: RentMonthRow[] }>(`/risk/${id}`).then((r) => r.data)
export const getRiskModel = () => api.get<RiskModelInfo>('/risk/model').then((r) => r.data)
export const rescoreRisks = () => api.post('/risk/rescore', {}).then((r) => r.data)
export const reviewRisk = (id: number, body: { decision: 'approve' | 'dismiss'; draft?: string; nextStep?: string; note?: string; reviewSeconds: number }) =>
  api.post<TenantRisk>(`/risk/${id}/review`, body).then((r) => r.data)
