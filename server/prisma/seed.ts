// Demo data for two invented property companies. Every person, address and business is invented.
// - Acme Property Group (Auckland): the original demo portfolio, so the documents, bank statement and inbox line up.
// - Kestrel Lettings (Manchester and Leeds): a second company, to show that users only ever see their own company.
// Each company gets a user per role; every demo password is demo1234. Dates are fixed (August and September 2026).
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { formatIrdNumber, irdCheckDigitFor } from '../src/lib/ird'

const prisma = new PrismaClient()

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

/** A valid-looking GST number built from an 8-digit base (the check digit is computed, not invented). */
function gst(base: string): string {
  for (let n = Number(base); ; n++) {
    const check = irdCheckDigitFor(String(n))
    if (check !== null) return formatIrdNumber(`${n}${check}`)
  }
}

interface SeedProperty {
  code: string
  address: string
  suburb: string
  city: string
  bedrooms: number
  bathrooms: number
  rent: number
  marketRent?: number
}
/** [property code, first name, last name, lease start, lease end] */
type SeedTenancy = [string, string, string, string, string | null]
interface SeedContractor {
  name: string
  trade: string
  taxNumber: string
  bank: string
  available?: boolean
  availableFrom?: string
  notes?: string
}
/** [property code, contractor, title, description, priority, status, quote, completed, category] */
type SeedJob = [string, string, string, string, string, string, number, string | null, string]
interface SeedUser {
  email: string
  name: string
  role: 'manager' | 'accounts' | 'property_manager' | 'read_only'
}
interface SeedCompany {
  name: string
  slug: string
  country: string
  currency: string
  users: SeedUser[]
  properties: SeedProperty[]
  tenancies: SeedTenancy[]
  contractors: SeedContractor[]
  jobs: SeedJob[]
  /** Rent due dates: the first list is already paid, the second is waiting for the bank statement. */
  paidDueDates: string[]
  pendingDueDates: string[]
  phonePrefix: string
}

// ---------------------------------------------------------------------------------------------------------------
// Acme Property Group, Auckland

const ACME: SeedCompany = {
  name: 'Acme Property Group',
  slug: 'acme',
  country: 'NZ',
  currency: 'NZD',
  users: [
    { email: 'demo@example.com', name: 'Emma Walker', role: 'manager' },
    { email: 'james@acme.example.com', name: 'James Hart', role: 'accounts' },
    { email: 'sarah@acme.example.com', name: 'Sarah Bell', role: 'property_manager' },
    { email: 'tom@acme.example.com', name: 'Tom Reid', role: 'read_only' },
  ],
  properties: [
    { code: 'MTE14', address: '14 Kowhai Road', suburb: 'Mount Eden', city: 'Auckland', bedrooms: 3, bathrooms: 1.5, rent: 720, marketRent: 740 },
    { code: 'PON7', address: '7 Vine Street', suburb: 'Ponsonby', city: 'Auckland', bedrooms: 2, bathrooms: 1, rent: 650, marketRent: 640 },
    { code: 'GLN22', address: '22 Ash Street', suburb: 'Glen Innes', city: 'Auckland', bedrooms: 3, bathrooms: 1, rent: 610, marketRent: 600 },
    { code: 'HND5', address: '5 Rimu Crescent', suburb: 'Henderson', city: 'Auckland', bedrooms: 4, bathrooms: 2, rent: 680, marketRent: 700 },
    { code: 'TAK9', address: '9 Totara Avenue', suburb: 'Takapuna', city: 'Auckland', bedrooms: 3, bathrooms: 2, rent: 780, marketRent: 790 },
    { code: 'ONE3', address: '3/41 Arthur Street', suburb: 'Onehunga', city: 'Auckland', bedrooms: 2, bathrooms: 1, rent: 560, marketRent: 540 },
    { code: 'PAP18', address: '18 Matai Road', suburb: 'Papatoetoe', city: 'Auckland', bedrooms: 3, bathrooms: 1, rent: 590, marketRent: 580 },
    { code: 'NLN11', address: '11 Kauri Lane', suburb: 'New Lynn', city: 'Auckland', bedrooms: 2, bathrooms: 1, rent: 540, marketRent: 520 },
    { code: 'MRB6', address: '6 Tui Terrace', suburb: 'Mairangi Bay', city: 'Auckland', bedrooms: 4, bathrooms: 2, rent: 850, marketRent: 860 },
    { code: 'AVD25', address: '25 Puriri Street', suburb: 'Avondale', city: 'Auckland', bedrooms: 3, bathrooms: 1, rent: 600, marketRent: 590 },
    { code: 'BLK2', address: '2/8 Manuka Road', suburb: 'Blockhouse Bay', city: 'Auckland', bedrooms: 1, bathrooms: 1, rent: 450, marketRent: 450 },
    { code: 'HOW30', address: '30 Pohutukawa Drive', suburb: 'Howick', city: 'Auckland', bedrooms: 4, bathrooms: 2, rent: 760, marketRent: 770 },
  ],
  tenancies: [
    ['MTE14', 'Aroha', 'Ngata', '2025-02-10', null],
    ['PON7', 'Daniel', 'Kim', '2024-11-04', null],
    ['GLN22', 'Mele', 'Fifita', '2025-06-02', null],
    ['HND5', 'Ben', 'Carter', '2023-09-18', null],
    ['TAK9', 'Sophie', 'Clarke', '2025-01-13', null],
    ['ONE3', 'Tom', 'Wright', '2026-03-02', null],
    ['PAP18', 'Ana', 'Tupou', '2024-07-22', null],
    ['NLN11', 'Liam', "O'Brien", '2025-10-06', null],
    ['MRB6', 'Hannah', 'Lee', '2024-04-15', null],
    ['AVD25', 'Wiremu', 'Parata', '2025-08-25', null],
    ['HOW30', 'Grace', 'Chen', '2023-05-01', '2026-08-31'],
  ],
  contractors: [
    { name: 'Acme Plumbing', trade: 'plumbing', taxNumber: gst('10234567'), bank: '12-3140-0456781-00', notes: 'After-hours call-outs' },
    { name: 'Acme Electrical', trade: 'electrical', taxNumber: gst('11345678'), bank: '02-0500-0123456-001' },
    { name: 'Acme Cleaning Co', trade: 'cleaning', taxNumber: gst('12456789'), bank: '06-0193-0654321-00' },
    { name: 'Acme Gardens', trade: 'gardening', taxNumber: gst('13567890'), bank: '38-9012-0345678-00' },
    { name: 'Acme Locksmiths', trade: 'locksmith', taxNumber: gst('10987654'), bank: '12-3077-0789012-00', notes: '24-hour lockouts' },
    { name: 'Acme Roofing', trade: 'roofing', taxNumber: gst('11876543'), bank: '01-0102-0234567-00', available: false, availableFrom: '2026-10-12', notes: 'Booked out on a re-roof' },
    { name: 'Acme Pest Control', trade: 'pest_control', taxNumber: gst('12765432'), bank: '03-0254-0876543-00' },
    { name: 'Acme Insurance', trade: 'insurance', taxNumber: gst('13654321'), bank: '02-0100-0998877-000' },
    { name: 'Acme Water', trade: 'utilities', taxNumber: gst('14543210'), bank: '12-3011-0112233-00' },
    { name: 'Acme Gas & Heating', trade: 'gas_heating', taxNumber: gst('15432109'), bank: '12-3222-0445566-00', notes: 'Certifying gasfitter; same-day for gas leaks' },
    { name: 'Acme Handyman', trade: 'general', taxNumber: gst('16321098'), bank: '06-0555-0778899-00', notes: 'Small repairs, doors, decks, fences' },
  ],
  jobs: [
    ['MTE14', 'Acme Plumbing', 'Hot water cylinder element', 'No hot water since Sunday; element likely failed.', 'urgent', 'in_progress', 480, null, 'plumbing'],
    ['PON7', 'Acme Plumbing', 'Leaking kitchen mixer', 'Kitchen mixer drips constantly; washer or cartridge.', 'medium', 'completed', 220, '2026-09-08', 'plumbing'],
    ['GLN22', 'Acme Electrical', 'Smoke alarms to standard', 'Replace hallway and bedroom smoke alarms with 10-year photoelectric units.', 'high', 'completed', 360, '2026-09-03', 'electrical'],
    ['HND5', 'Acme Roofing', 'Gutter clean and downpipe', 'Overflowing gutters at the back; one downpipe bracket loose.', 'medium', 'in_progress', 540, null, 'structural'],
    ['TAK9', 'Acme Locksmiths', 'Front door lock', 'Front door lock sticking; replace cylinder and re-key.', 'high', 'completed', 295, '2026-09-11', 'security'],
    ['ONE3', 'Acme Electrical', 'Bathroom extractor fan', 'Extractor fan not running; needed for the healthy homes ventilation standard.', 'medium', 'open', 310, null, 'electrical'],
    ['PAP18', 'Acme Gardens', 'Lawn and hedge tidy', 'Tidy before the routine inspection.', 'low', 'completed', 180, '2026-09-15', 'general'],
    ['NLN11', 'Acme Cleaning Co', 'Mould treatment, bedroom 2', 'Black mould on the ceiling corner; treat and check ventilation.', 'high', 'open', 420, null, 'general'],
    ['MRB6', 'Acme Electrical', 'Heat pump service', 'Annual heat pump service.', 'low', 'completed', 240, '2026-09-17', 'appliance'],
    ['AVD25', 'Acme Pest Control', 'Rodent treatment', 'Tenant reports rats in the ceiling space.', 'high', 'in_progress', 260, null, 'pest'],
    ['HOW30', 'Acme Cleaning Co', 'End of tenancy clean', 'Full clean after the tenancy ended.', 'medium', 'completed', 520, '2026-09-04', 'general'],
  ],
  paidDueDates: ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31'],
  pendingDueDates: ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'],
  phonePrefix: '021 555 0',
}

// ---------------------------------------------------------------------------------------------------------------
// Kestrel Lettings, Manchester and Leeds. Rents are weekly in the app; the market rent is the weekly benchmark.

const KESTREL: SeedCompany = {
  name: 'Kestrel Lettings',
  slug: 'kestrel',
  country: 'UK',
  currency: 'GBP',
  users: [
    { email: 'claire@kestrel.example.com', name: 'Claire Fox', role: 'manager' },
    { email: 'daniel@kestrel.example.com', name: 'Daniel Price', role: 'accounts' },
    { email: 'lucy@kestrel.example.com', name: 'Lucy Grant', role: 'property_manager' },
    { email: 'oliver@kestrel.example.com', name: 'Oliver Shaw', role: 'read_only' },
  ],
  properties: [
    { code: 'DID14', address: '14 Burton Road', suburb: 'Didsbury', city: 'Manchester', bedrooms: 2, bathrooms: 1, rent: 265, marketRent: 270 },
    { code: 'ANC7B', address: 'Flat 7B, 3 Mill Street', suburb: 'Ancoats', city: 'Manchester', bedrooms: 1, bathrooms: 1, rent: 230, marketRent: 225 },
    { code: 'HEA22', address: '22 Heaton Moor Road', suburb: 'Heaton Moor', city: 'Stockport', bedrooms: 3, bathrooms: 1, rent: 300, marketRent: 310 },
    { code: 'HDG9', address: '9 Cardigan Road', suburb: 'Headingley', city: 'Leeds', bedrooms: 4, bathrooms: 2, rent: 390, marketRent: 380 },
    { code: 'SAL41', address: '41 Washway Road', suburb: 'Sale', city: 'Manchester', bedrooms: 3, bathrooms: 1.5, rent: 285, marketRent: 290 },
    { code: 'CHO18', address: '18 Beech Road', suburb: 'Chorlton', city: 'Manchester', bedrooms: 2, bathrooms: 1, rent: 275, marketRent: 265 },
    { code: 'PRE5', address: '5 Bury Old Road', suburb: 'Prestwich', city: 'Manchester', bedrooms: 3, bathrooms: 1, rent: 255, marketRent: 260 },
    { code: 'KIR27', address: '27 Kirkstall Lane', suburb: 'Kirkstall', city: 'Leeds', bedrooms: 2, bathrooms: 1, rent: 215, marketRent: 220 },
  ],
  tenancies: [
    ['DID14', 'Oliver', 'Brooks', '2024-09-02', null],
    ['ANC7B', 'Amelia', 'Hughes', '2025-03-10', null],
    ['HEA22', 'George', 'Turner', '2023-11-06', null],
    ['HDG9', 'Isla', 'Morgan', '2025-07-01', null],
    ['SAL41', 'Harry', 'Evans', '2024-05-20', null],
    ['CHO18', 'Freya', 'Collins', '2026-01-12', null],
    ['PRE5', 'Jack', 'Murphy', '2024-02-05', null],
  ],
  contractors: [
    { name: 'Kestrel Plumbing & Heating', trade: 'plumbing', taxNumber: 'GB 412 7781 06', bank: '40-11-22 31245678', notes: 'Emergency call-outs until 10 pm' },
    { name: 'Kestrel Gas Safe Ltd', trade: 'gas_heating', taxNumber: 'GB 318 2204 55', bank: '20-45-67 55667788', notes: 'Gas Safe registered; boilers and gas leaks' },
    { name: 'Kestrel Electrical', trade: 'electrical', taxNumber: 'GB 276 9931 12', bank: '30-98-76 12349876', available: false, availableFrom: '2026-10-05', notes: 'On a rewire until early October' },
    { name: 'Kestrel Locks', trade: 'locksmith', taxNumber: 'GB 509 4412 38', bank: '60-83-71 45671234', notes: '24-hour lockouts and break-in repairs' },
    { name: 'Kestrel Roofing', trade: 'roofing', taxNumber: 'GB 633 1150 79', bank: '09-01-28 78901234' },
    { name: 'Kestrel Pest Control', trade: 'pest_control', taxNumber: 'GB 187 6623 90', bank: '40-47-84 23456789' },
    { name: 'Kestrel Cleaning', trade: 'cleaning', taxNumber: 'GB 344 0087 21', bank: '20-20-15 34567890' },
    { name: 'Kestrel Property Repairs', trade: 'general', taxNumber: 'GB 721 5566 03', bank: '30-15-99 67890123', notes: 'Joinery, plaster, small jobs' },
  ],
  jobs: [
    ['DID14', 'Kestrel Gas Safe Ltd', 'Boiler losing pressure', 'Boiler drops to zero pressure every few days; expansion vessel recharged.', 'high', 'completed', 180, '2026-02-18', 'gas_heating'],
    ['ANC7B', 'Kestrel Plumbing & Heating', 'Leak under the bathroom basin', 'Drip from the waste trap; replaced.', 'medium', 'completed', 95, '2026-04-09', 'plumbing'],
    ['HEA22', 'Kestrel Electrical', 'Consumer unit tripping', 'RCD trips when the shower runs; faulty shower isolator replaced.', 'high', 'completed', 210, '2026-03-21', 'electrical'],
    ['HDG9', 'Kestrel Locks', 'Back door lock replaced', 'Euro cylinder snapped; replaced with an anti-snap cylinder.', 'high', 'completed', 120, '2026-06-02', 'security'],
    ['SAL41', 'Kestrel Roofing', 'Slipped roof tiles', 'Two tiles slipped after a storm; refixed.', 'medium', 'completed', 260, '2026-01-27', 'water_leak'],
    ['CHO18', 'Kestrel Pest Control', 'Mice in the kitchen', 'Droppings behind the units; baited and proofed.', 'medium', 'completed', 140, '2026-05-13', 'pest'],
    ['PRE5', 'Kestrel Property Repairs', 'Kitchen cupboard doors', 'Three doors off their hinges; re-hung.', 'low', 'completed', 85, '2026-07-07', 'general'],
    ['KIR27', 'Kestrel Cleaning', 'End of tenancy clean', 'Full clean before re-letting.', 'medium', 'completed', 240, '2026-08-21', 'general'],
    ['HEA22', 'Kestrel Gas Safe Ltd', 'Annual gas safety check', 'CP12 certificate; boiler and hob checked.', 'low', 'completed', 75, '2026-06-19', 'gas_heating'],
    ['HDG9', 'Kestrel Plumbing & Heating', 'Washing machine flooded the kitchen', 'Hose split; water through to the hallway. Isolated, hose replaced, floor dried.', 'urgent', 'completed', 320, '2026-02-04', 'water_leak'],
    ['DID14', 'Kestrel Electrical', 'Smoke alarm replacement', 'Both alarms past their date; replaced with interlinked units.', 'medium', 'completed', 160, '2026-08-11', 'electrical'],
    ['SAL41', 'Kestrel Property Repairs', 'Garden gate', 'Gate dropped on its hinges; re-hung and latch fitted.', 'low', 'in_progress', 110, null, 'structural'],
  ],
  paidDueDates: ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31'],
  pendingDueDates: ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'],
  phonePrefix: '07700 900',
}

// ---------------------------------------------------------------------------------------------------------------

async function seedCompany(c: SeedCompany) {
  // Replace an earlier seed of this company (the cascade removes its users and data).
  await prisma.organisation.deleteMany({ where: { slug: c.slug } })
  await prisma.user.deleteMany({ where: { email: { in: c.users.map((u) => u.email) } } })
  const org = await prisma.organisation.create({ data: { name: c.name, slug: c.slug, country: c.country, currency: c.currency } })
  const password = await bcrypt.hash('demo1234', 10)
  const users = []
  for (const u of c.users) {
    users.push(await prisma.user.create({ data: { ...u, password, organisationId: org.id } }))
  }
  const manager = users[0]
  const owner = { userId: manager.id, organisationId: org.id }

  const properties = new Map<string, number>()
  for (const p of c.properties) {
    const tenanted = c.tenancies.some(([code, , , , end]) => code === p.code && end === null)
    const created = await prisma.property.create({
      data: {
        ...owner,
        code: p.code,
        address: p.address,
        suburb: p.suburb,
        city: p.city,
        bedrooms: p.bedrooms,
        bathrooms: p.bathrooms,
        rentPrice: p.rent,
        marketRent: p.marketRent ?? null,
        status: tenanted ? 'tenanted' : p.code === 'HOW30' ? 'maintenance' : 'vacant',
      },
    })
    properties.set(p.code, created.id)
  }

  for (const [index, [code, firstName, lastName, start, end]] of c.tenancies.entries()) {
    const rent = c.properties.find((p) => p.code === code)!.rent
    const tenant = await prisma.tenant.create({
      data: {
        ...owner,
        firstName,
        lastName,
        email: `${firstName}.${lastName}`.toLowerCase().replace(/'/g, '') + '@example.com',
        phone: `${c.phonePrefix}${100 + index}`,
      },
    })
    const lease = await prisma.lease.create({
      data: {
        propertyId: properties.get(code)!,
        tenantId: tenant.id,
        startDate: day(start),
        endDate: end ? day(end) : null,
        weeklyRent: rent,
        bondAmount: rent * 4,
        rentReference: `${lastName.toUpperCase().replace(/'/g, '')} ${code}`,
        status: end ? 'ended' : 'active',
      },
    })
    // The first list is reconciled (paid); the second is due and waits for the bank statement import.
    const paid = end ? c.paidDueDates.filter((d) => d <= end) : c.paidDueDates
    const pending = end ? [] : c.pendingDueDates
    await prisma.payment.createMany({
      data: [
        ...paid.map((d) => ({ leaseId: lease.id, amount: rent, dueDate: day(d), paidDate: day(d), status: 'paid' })),
        ...pending.map((d) => ({ leaseId: lease.id, amount: rent, dueDate: day(d), paidDate: null, status: 'pending' })),
      ],
    })
  }

  const contractors = new Map<string, number>()
  for (const k of c.contractors) {
    const created = await prisma.contractor.create({
      data: {
        ...owner,
        name: k.name,
        trade: k.trade,
        email: `accounts@${k.name.toLowerCase().replace(/[^a-z]+/g, '-')}.example.com`,
        gstNumber: k.taxNumber,
        bankAccount: k.bank,
        available: k.available ?? true,
        availableFrom: k.availableFrom ? day(k.availableFrom) : null,
        notes: k.notes ?? null,
      },
    })
    contractors.set(k.name, created.id)
  }

  for (const [code, contractor, title, description, priority, status, quote, completed, category] of c.jobs) {
    await prisma.maintenanceRequest.create({
      data: {
        propertyId: properties.get(code)!,
        contractorId: contractors.get(contractor)!,
        title,
        description,
        priority,
        status,
        category,
        quoteAmount: quote,
        cost: completed ? quote : null,
        completedAt: completed ? day(completed) : null,
        createdAt: completed ? day(completed) : day('2026-08-28'),
      },
    })
  }
  return org
}

async function main() {
  for (const company of [ACME, KESTREL]) await seedCompany(company)
  // Companies left without any user (for example after an upgrade from a single-user database) are dropped.
  await prisma.organisation.deleteMany({ where: { users: { none: {} } } })

  const counts = await Promise.all([
    prisma.organisation.count(),
    prisma.user.count(),
    prisma.property.count(),
    prisma.lease.count(),
    prisma.payment.count(),
    prisma.contractor.count(),
    prisma.maintenanceRequest.count(),
  ])
  console.log(
    `Seed complete: ${counts[0]} companies, ${counts[1]} users, ${counts[2]} properties, ${counts[3]} leases, ${counts[4]} rent payments, ` +
      `${counts[5]} contractors, ${counts[6]} maintenance jobs. Demo login: demo@example.com / demo1234 (Acme manager); ` +
      `claire@kestrel.example.com / demo1234 (Kestrel manager).`,
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
