import api from './client'
import { Property } from '../types'

export const getProperties = () => api.get<Property[]>('/properties').then(r => r.data)
export const getProperty = (id: number) => api.get<Property>(`/properties/${id}`).then(r => r.data)
export const createProperty = (data: Partial<Property>) => api.post<Property>('/properties', data).then(r => r.data)
export const updateProperty = (id: number, data: Partial<Property>) => api.put<Property>(`/properties/${id}`, data).then(r => r.data)
export const deleteProperty = (id: number) => api.delete(`/properties/${id}`).then(r => r.data)
