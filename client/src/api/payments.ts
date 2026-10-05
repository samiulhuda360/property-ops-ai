import api from './client'
import { Payment } from '../types'

export const getPayments = () => api.get<Payment[]>('/payments').then(r => r.data)
export const createPayment = (data: Partial<Payment>) => api.post<Payment>('/payments', data).then(r => r.data)
export const updatePayment = (id: number, data: Partial<Payment>) => api.put<Payment>(`/payments/${id}`, data).then(r => r.data)
export const deletePayment = (id: number) => api.delete(`/payments/${id}`).then(r => r.data)
