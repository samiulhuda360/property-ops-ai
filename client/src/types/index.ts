export interface User {
  id: number
  email: string
  name: string
}

export interface Property {
  id: number
  userId: number
  address: string
  suburb: string
  city: string
  bedrooms: number
  bathrooms: number
  rentPrice: number
  status: 'vacant' | 'tenanted' | 'maintenance'
  description?: string
  createdAt: string
  leases?: Lease[]
  _count?: { maintenance: number }
}

export interface Tenant {
  id: number
  userId: number
  firstName: string
  lastName: string
  email: string
  phone: string
  createdAt: string
  leases?: Lease[]
}

export interface Lease {
  id: number
  propertyId: number
  tenantId: number
  property?: Property
  tenant?: Tenant
  startDate: string
  endDate?: string
  weeklyRent: number
  bondAmount: number
  status: 'active' | 'ended'
  notes?: string
  createdAt: string
  payments?: Payment[]
}

export interface Payment {
  id: number
  leaseId: number
  lease?: Lease
  amount: number
  dueDate: string
  paidDate?: string
  status: 'pending' | 'paid' | 'overdue'
  notes?: string
  createdAt: string
}

export interface MaintenanceRequest {
  id: number
  propertyId: number
  property?: Property
  title: string
  description: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  status: 'open' | 'in_progress' | 'completed'
  cost?: number
  completedAt?: string
  createdAt: string
}
