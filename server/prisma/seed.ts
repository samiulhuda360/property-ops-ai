// Demo data for a fictional Auckland property manager. Every person, address and business is invented.
// Dates are fixed (August and September 2026) so the demo documents, bank statement and inbox always line up.
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

const PROPERTIES = [
  { code: 'MTE14', address: '14 Kowhai Road', suburb: 'Mount Eden', bedrooms: 3, bathrooms: 1.5, rent: 720 },
  { code: 'PON7', address: '7 Vine Street', suburb: 'Ponsonby', bedrooms: 2, bathrooms: 1, rent: 650 },
  { code: 'GLN22', address: '22 Ash Street', suburb: 'Glen Innes', bedrooms: 3, bathrooms: 1, rent: 610 },
  { code: 'HND5', address: '5 Rimu Crescent', suburb: 'Henderson', bedrooms: 4, bathrooms: 2, rent: 680 },
  { code: 'TAK9', address: '9 Totara Avenue', suburb: 'Takapuna', bedrooms: 3, bathrooms: 2, rent: 780 },
  { code: 'ONE3', address: '3/41 Arthur Street', suburb: 'Onehunga', bedrooms: 2, bathrooms: 1, rent: 560 },
  { code: 'PAP18', address: '18 Matai Road', suburb: 'Papatoetoe', bedrooms: 3, bathrooms: 1, rent: 590 },
  { code: 'NLN11', address: '11 Kauri Lane', suburb: 'New Lynn', bedrooms: 2, bathrooms: 1, rent: 540 },
  { code: 'MRB6', address: '6 Tui Terrace', suburb: 'Mairangi Bay', bedrooms: 4, bathrooms: 2, rent: 850 },
  { code: 'AVD25', address: '25 Puriri Street', suburb: 'Avondale', bedrooms: 3, bathrooms: 1, rent: 600 },
  { code: 'BLK2', address: '2/8 Manuka Road', suburb: 'Blockhouse Bay', bedrooms: 1, bathrooms: 1, rent: 450 },
  { code: 'HOW30', address: '30 Pohutukawa Drive', suburb: 'Howick', bedrooms: 4, bathrooms: 2, rent: 760 },
]

// [property code, first name, last name, lease start, lease end]
const TENANCIES: [string, string, string, string, string | null][] = [
  ['MTE14', 'Aroha', 'Ngata', '2025-02-10', null],
  ['PON7', 'Daniel', 'Kim', '2024-11-04', null],
  ['GLN22', 'Mele', 'Fifita', '2025-06-02', null],
  ['HND5', 'Rajesh', 'Patel', '2023-09-18', null],
  ['TAK9', 'Sophie', 'Clarke', '2025-01-13', null],
  ['ONE3', 'Tom', 'Wright', '2026-03-02', null],
  ['PAP18', 'Ana', 'Tupou', '2024-07-22', null],
  ['NLN11', 'Liam', "O'Brien", '2025-10-06', null],
  ['MRB6', 'Hannah', 'Lee', '2024-04-15', null],
  ['AVD25', 'Wiremu', 'Parata', '2025-08-25', null],
  ['HOW30', 'Grace', 'Chen', '2023-05-01', '2026-08-31'],
]

const CONTRACTORS = [
  { name: 'Acme Plumbing', trade: 'plumbing', gstBase: '10234567', bank: '12-3140-0456781-00' },
  { name: 'Acme Electrical', trade: 'electrical', gstBase: '11345678', bank: '02-0500-0123456-001' },
  { name: 'Acme Cleaning Co', trade: 'cleaning', gstBase: '12456789', bank: '06-0193-0654321-00' },
  { name: 'Acme Gardens', trade: 'gardening', gstBase: '13567890', bank: '38-9012-0345678-00' },
  { name: 'Acme Locksmiths', trade: 'locksmith', gstBase: '10987654', bank: '12-3077-0789012-00' },
  { name: 'Acme Roofing', trade: 'roofing', gstBase: '11876543', bank: '01-0102-0234567-00' },
  { name: 'Acme Pest Control', trade: 'pest_control', gstBase: '12765432', bank: '03-0254-0876543-00' },
  { name: 'Acme Insurance', trade: 'insurance', gstBase: '13654321', bank: '02-0100-0998877-000' },
  { name: 'Acme Water', trade: 'utilities', gstBase: '14543210', bank: '12-3011-0112233-00' },
]

// [property code, contractor, title, description, priority, status, quote, completed]
const JOBS: [string, string, string, string, string, string, number, string | null][] = [
  ['MTE14', 'Acme Plumbing', 'Hot water cylinder element', 'No hot water since Sunday; element likely failed.', 'urgent', 'in_progress', 480, null],
  ['PON7', 'Acme Plumbing', 'Leaking kitchen mixer', 'Kitchen mixer drips constantly; washer or cartridge.', 'medium', 'completed', 220, '2026-09-08'],
  ['GLN22', 'Acme Electrical', 'Smoke alarms to standard', 'Replace hallway and bedroom smoke alarms with 10-year photoelectric units.', 'high', 'completed', 360, '2026-09-03'],
  ['HND5', 'Acme Roofing', 'Gutter clean and downpipe', 'Overflowing gutters at the back; one downpipe bracket loose.', 'medium', 'in_progress', 540, null],
  ['TAK9', 'Acme Locksmiths', 'Front door lock', 'Front door lock sticking; replace cylinder and re-key.', 'high', 'completed', 295, '2026-09-11'],
  ['ONE3', 'Acme Electrical', 'Bathroom extractor fan', 'Extractor fan not running; needed for the healthy homes ventilation standard.', 'medium', 'open', 310, null],
  ['PAP18', 'Acme Gardens', 'Lawn and hedge tidy', 'Tidy before the routine inspection.', 'low', 'completed', 180, '2026-09-15'],
  ['NLN11', 'Acme Cleaning Co', 'Mould treatment, bedroom 2', 'Black mould on the ceiling corner; treat and check ventilation.', 'high', 'open', 420, null],
  ['MRB6', 'Acme Electrical', 'Heat pump service', 'Annual heat pump service.', 'low', 'completed', 240, '2026-09-17'],
  ['AVD25', 'Acme Pest Control', 'Rodent treatment', 'Tenant reports rats in the ceiling space.', 'high', 'in_progress', 260, null],
  ['HOW30', 'Acme Cleaning Co', 'End of tenancy clean', 'Full clean after the tenancy ended.', 'medium', 'completed', 520, '2026-09-04'],
]

const MONDAYS_AUGUST = ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31']
const MONDAYS_SEPTEMBER = ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']

async function main() {
  await prisma.user.deleteMany({ where: { email: 'demo@example.com' } })
  const user = await prisma.user.create({
    data: { email: 'demo@example.com', password: await bcrypt.hash('demo1234', 10), name: 'Demo Manager' },
  })

  const properties = new Map<string, number>()
  for (const p of PROPERTIES) {
    const tenanted = TENANCIES.some(([code, , , , end]) => code === p.code && end === null)
    const created = await prisma.property.create({
      data: {
        userId: user.id,
        code: p.code,
        address: p.address,
        suburb: p.suburb,
        city: 'Auckland',
        bedrooms: p.bedrooms,
        bathrooms: p.bathrooms,
        rentPrice: p.rent,
        status: tenanted ? 'tenanted' : p.code === 'HOW30' ? 'maintenance' : 'vacant',
      },
    })
    properties.set(p.code, created.id)
  }

  for (const [index, [code, firstName, lastName, start, end]] of TENANCIES.entries()) {
    const rent = PROPERTIES.find((p) => p.code === code)!.rent
    const tenant = await prisma.tenant.create({
      data: {
        userId: user.id,
        firstName,
        lastName,
        email: `${firstName}.${lastName}`.toLowerCase().replace(/'/g, '') + '@example.com',
        phone: `021 555 0${100 + index}`,
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
    // August is reconciled (paid); September's rent is due and waits for the bank statement import.
    const mondays = end ? MONDAYS_AUGUST.filter((d) => d <= end) : [...MONDAYS_AUGUST, ...MONDAYS_SEPTEMBER]
    await prisma.payment.createMany({
      data: mondays.map((d) => ({
        leaseId: lease.id,
        amount: rent,
        dueDate: day(d),
        paidDate: d.startsWith('2026-08') ? day(d) : null,
        status: d.startsWith('2026-08') ? 'paid' : 'pending',
      })),
    })
  }

  const contractors = new Map<string, number>()
  for (const c of CONTRACTORS) {
    const created = await prisma.contractor.create({
      data: {
        userId: user.id,
        name: c.name,
        trade: c.trade,
        email: `accounts@${c.name.toLowerCase().replace(/[^a-z]+/g, '-')}.example.com`,
        gstNumber: gst(c.gstBase),
        bankAccount: c.bank,
      },
    })
    contractors.set(c.name, created.id)
  }

  for (const [code, contractor, title, description, priority, status, quote, completed] of JOBS) {
    await prisma.maintenanceRequest.create({
      data: {
        propertyId: properties.get(code)!,
        contractorId: contractors.get(contractor)!,
        title,
        description,
        priority,
        status,
        quoteAmount: quote,
        completedAt: completed ? day(completed) : null,
        createdAt: day('2026-08-28'),
      },
    })
  }

  const counts = await Promise.all([
    prisma.property.count(),
    prisma.lease.count(),
    prisma.payment.count(),
    prisma.contractor.count(),
    prisma.maintenanceRequest.count(),
  ])
  console.log(
    `Seed complete: ${counts[0]} properties, ${counts[1]} leases, ${counts[2]} rent payments, ${counts[3]} contractors, ` +
      `${counts[4]} maintenance jobs. Demo login: demo@example.com / demo1234`,
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
