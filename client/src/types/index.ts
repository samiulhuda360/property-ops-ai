export type Role = 'manager' | 'accounts' | 'property_manager' | 'read_only'

export interface User {
  id: number
  email: string
  name: string
  role?: Role
  roleLabel?: string
  limits?: { invoice: number | null; workOrder: number | null; canDecide: boolean }
  organisation?: { id: number; name: string; slug: string; country: string; currency: string }
}

export interface Contractor {
  id: number
  name: string
  trade: string
  email?: string | null
  available?: boolean
  availableFrom?: string | null
  notes?: string | null
}

export interface Property {
  id: number
  userId: number
  code?: string | null
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
  contractorId?: number | null
  contractor?: Contractor | null
  title: string
  description: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  status: 'open' | 'in_progress' | 'completed'
  source?: 'manual' | 'inbox' | 'tenant_request'
  category?: string | null
  triage?: import('./maintenance').Triage | null
  workOrder?: import('./maintenance').WorkOrder | null
  triageMethod?: string | null
  photoNote?: string | null
  quoteAmount?: number | null
  cost?: number
  completedAt?: string
  approvedAt?: string | null
  createdAt: string
}
