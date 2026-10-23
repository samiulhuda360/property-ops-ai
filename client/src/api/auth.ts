import api from './client'
import { User } from '../types'

export interface CompanyUser {
  id: number
  email: string
  name: string
  role: string
  createdAt: string
}

export interface RoleInfo {
  role: string
  label: string
  limits: { invoice: number | null; workOrder: number | null; canDecide: boolean }
}

export const getMe = () => api.get<User>('/auth/me').then((r) => r.data)
export const getCompanyUsers = () => api.get<{ roles: RoleInfo[]; users: CompanyUser[] }>('/auth/users').then((r) => r.data)
export const setUserRole = (id: number, role: string) => api.put<CompanyUser>(`/auth/users/${id}/role`, { role }).then((r) => r.data)
