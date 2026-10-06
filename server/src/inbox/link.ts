// Links an email to the records it is about: sender -> tenant -> active lease -> property.
// When the sender address isn't on file, the signature (name or phone number plus the property address) can still
// identify the tenant; an address or property code alone identifies the property but not the sender.
import { prisma } from '../lib/prisma'

export interface DirLease {
  id: number
  status: string
  startDate: Date
  propertyId: number
  rentReference: string | null
}

export interface DirTenant {
  id: number
  firstName: string
  lastName: string
  email: string
  phone: string
  leases: DirLease[]
}

export interface DirProperty {
  id: number
  code: string | null
  address: string
  suburb: string
}

export interface DirContractor {
  id: number
  name: string
  email: string | null
}

/** The account's tenants, properties and contractors: small enough to match in memory. */
export interface Directory {
  tenants: DirTenant[]
  properties: DirProperty[]
  contractors: DirContractor[]
}

export async function loadDirectory(userId: number): Promise<Directory> {
  const [tenants, properties, contractors] = await Promise.all([
    prisma.tenant.findMany({
      where: { userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        leases: { select: { id: true, status: true, startDate: true, propertyId: true, rentReference: true } },
      },
      orderBy: { id: 'asc' },
    }),
    prisma.property.findMany({ where: { userId }, select: { id: true, code: true, address: true, suburb: true }, orderBy: { id: 'asc' } }),
    prisma.contractor.findMany({ where: { userId }, select: { id: true, name: true, email: true }, orderBy: { id: 'asc' } }),
  ])
  return { tenants, properties, contractors }
}

export type LinkMethod = 'sender' | 'signature' | 'address' | 'none'

export interface LinkResult {
  senderEmail: string
  senderName: string | null
  /** The sender address belongs to a tenant on file. */
  knownSender: boolean
  tenant: DirTenant | null
  lease: DirLease | null
  property: DirProperty | null
  contractor: DirContractor | null
  method: LinkMethod
  note: string
}

/** "Aroha Ngata <aroha.ngata@example.com>" -> address and display name. */
export function parseFrom(raw: string): { email: string; name: string | null } {
  const angle = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (angle) return { email: angle[2].trim().toLowerCase(), name: angle[1].trim() || null }
  const bare = raw.match(/[^\s<>"]+@[^\s<>"]+/)
  return { email: (bare ? bare[0] : raw).trim().toLowerCase(), name: null }
}

/** The active lease, or the most recent one when the tenancy has ended. */
export function currentLease(tenant: DirTenant): DirLease | null {
  const byStart = [...tenant.leases].sort((a, b) => b.startDate.getTime() - a.startDate.getTime())
  return byStart.find((l) => l.status === 'active') ?? byStart[0] ?? null
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Matches "41 Arthur" for "3/41 Arthur Street", with or without the unit, any street-type spelling. */
export function addressPattern(address: string): RegExp | null {
  const m = address.match(/^(?:\d+[a-z]?\s*\/\s*)?(\d+[a-z]?)\s+([A-Za-zĀ-ſ'’-]+)/i)
  if (!m) return null
  return new RegExp(`\\b${escapeRe(m[1])}\\s+${escapeRe(m[2])}\\b`, 'i')
}

function namePattern(t: DirTenant): RegExp {
  const last = escapeRe(t.lastName).replace(/'/g, "['’]?")
  return new RegExp(`\\b${escapeRe(t.firstName)}\\s+${last}\\b`, 'i')
}

const digits = (s: string) => s.replace(/\D/g, '')

function mentionsPhone(t: DirTenant, text: string): boolean {
  const target = digits(t.phone)
  if (target.length < 7) return false
  return (text.match(/\b0\d[\d\s-]{6,12}\d\b/g) ?? []).some((p) => digits(p) === target)
}

function mentionsProperty(p: DirProperty, text: string): boolean {
  const addr = addressPattern(p.address)
  if (addr?.test(text)) return true
  return Boolean(p.code && new RegExp(`\\b${escapeRe(p.code)}\\b`, 'i').test(text))
}

const fullName = (t: DirTenant) => `${t.firstName} ${t.lastName}`

export function linkSender(email: { from: string; subject: string; text: string }, dir: Directory): LinkResult {
  const sender = parseFrom(email.from)
  const propertyById = (id: number) => dir.properties.find((p) => p.id === id) ?? null
  const base = { senderEmail: sender.email, senderName: sender.name, contractor: null as DirContractor | null }

  const tenant = dir.tenants.find((t) => t.email.toLowerCase() === sender.email)
  if (tenant) {
    const lease = currentLease(tenant)
    const property = lease ? propertyById(lease.propertyId) : null
    const where = property ? (lease?.status === 'active' ? ` (active lease at ${property.address})` : ` (ended lease at ${property.address})`) : ''
    return { ...base, knownSender: true, tenant, lease, property, method: 'sender', note: `Sender is the tenant ${fullName(tenant)}${where}.` }
  }

  const contractor = dir.contractors.find((c) => c.email?.toLowerCase() === sender.email) ?? null
  const text = `${email.subject}\n${email.text}`
  const properties = dir.properties.filter((p) => mentionsProperty(p, text))

  // A tenant named (or phoned from) in the signature, at an address the email also mentions.
  for (const t of dir.tenants) {
    if (!namePattern(t).test(text) && !mentionsPhone(t, text)) continue
    const lease = currentLease(t)
    const property = lease ? properties.find((p) => p.id === lease.propertyId) : undefined
    if (lease && property) {
      return {
        ...base,
        contractor,
        knownSender: false,
        tenant: t,
        lease,
        property,
        method: 'signature',
        note: `Sent from ${sender.email}, which isn't on file. The signature matches the tenant ${fullName(t)} at ${property.address}.`,
      }
    }
  }

  const who = contractor ? `the contractor ${contractor.name}` : `${sender.email}, which isn't a tenant on file`
  if (properties.length === 1) {
    return {
      ...base,
      contractor,
      knownSender: false,
      tenant: null,
      lease: null,
      property: properties[0],
      method: 'address',
      note: `Sender is ${who}. The email mentions ${properties[0].address}.`,
    }
  }
  const extra = properties.length > 1 ? ` The email mentions ${properties.length} properties, so none was linked.` : ''
  return { ...base, contractor, knownSender: false, tenant: null, lease: null, property: null, method: 'none', note: `Sender is ${who}.${extra}` }
}
