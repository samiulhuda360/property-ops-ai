import api from './client'
import { Contractor } from '../types'

export const getContractors = () => api.get<Contractor[]>('/contractors').then((r) => r.data)
