// Demo data for the Risk tab: the 60-tenancy roster and its 24 months of rent history (data/risk/, generated and
// labelled by server/ml/arrears.py) loaded into the company's tenants, properties, leases and RentMonth rows, then
// scored with the exported model. Tenancies the seed already has keep their records; the rest are created.
//
//   npx tsx src/risk/demo.ts [email]      (from server/; defaults to demo@example.com)
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { actorFor, type Actor } from '../lib/actor'
import { prisma } from '../lib/prisma'
import { scoreOrganisation, type ScoreSummary } from './service'

export const RISK_DATA_DIR = resolve(__dirname, '../../../data/risk')

export interface RosterTenancy {
  id: string
  company: string
  code: string
  firstName: string
  lastName: string
  address: string
  suburb: string
  city: string
  weeklyRent: number
  weeklyMarketRent: number
  start: string
  bedrooms: number
  bathrooms: number
}

export interface HistoryRow {
  month: string
  dueDate: string
  rentDue: number
  paidAmount: number
  paidDate: string | null
  daysLate: number
  arrears30: boolean
}

export interface HistoryTenancy {
  id: string
  company: string
  code: string
  profile: string
  rentMonthly: number
  marketMonthly: number
  start: string
  months: HistoryRow[]
}

export interface History {
  seed: number
  months: string[]
  cutoff: string
  labelMonths: string[]
  tenancies: HistoryTenancy[]
  truth: Record<string, boolean>
}

export const loadRoster = (): RosterTenancy[] => (JSON.parse(readFileSync(resolve(RISK_DATA_DIR, 'roster.json'), 'utf8')) as { tenancies: RosterTenancy[] }).tenancies
export const loadHistory = (): History => JSON.parse(readFileSync(resolve(RISK_DATA_DIR, 'history.json'), 'utf8')) as History

export interface RiskDemoResult extends ScoreSummary {
  company: string
  tenancies: number
  created: number
  months: number
}

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

/** Loads the roster and history for one company (its slug must match the roster's company), then scores it. */
export async function loadDemo(actor: Actor): Promise<RiskDemoResult> {
  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: actor.organisationId } })
  const roster = loadRoster().filter((t) => t.company === org.slug)
  const history = loadHistory()
  const byId = new Map(history.tenancies.map((t) => [t.id, t]))
  const owner = { userId: actor.userId, organisationId: actor.organisationId }
  let created = 0
  let months = 0

  for (const t of roster) {
    let property = await prisma.property.findFirst({ where: { organisationId: actor.organisationId, code: t.code } })
    if (!property) {
      property = await prisma.property.create({
        data: { ...owner, code: t.code, address: t.address, suburb: t.suburb, city: t.city, bedrooms: t.bedrooms, bathrooms: t.bathrooms, rentPrice: t.weeklyRent, marketRent: t.weeklyMarketRent, status: 'tenanted' },
      })
    } else if (property.marketRent === null) {
      property = await prisma.property.update({ where: { id: property.id }, data: { marketRent: t.weeklyMarketRent } })
    }
    let lease = await prisma.lease.findFirst({ where: { propertyId: property.id, status: 'active' }, orderBy: { startDate: 'desc' } })
    if (!lease) {
      const email = `${t.firstName}.${t.lastName}`.toLowerCase().replace(/[^a-z.]/g, '') + '@example.com'
      const tenant =
        (await prisma.tenant.findFirst({ where: { organisationId: actor.organisationId, email } })) ??
        (await prisma.tenant.create({ data: { ...owner, firstName: t.firstName, lastName: t.lastName, email, phone: org.country === 'UK' ? `07700 900${200 + created}` : `021 555 0${200 + created}` } }))
      lease = await prisma.lease.create({
        data: {
          propertyId: property.id,
          tenantId: tenant.id,
          startDate: day(t.start),
          weeklyRent: t.weeklyRent,
          bondAmount: t.weeklyRent * 4,
          rentReference: `${t.lastName.toUpperCase().replace(/[^A-Z]/g, '')} ${t.code}`,
          status: 'active',
        },
      })
      created++
    }
    const h = byId.get(t.id)
    if (!h) continue
    await prisma.rentMonth.deleteMany({ where: { leaseId: lease.id } })
    await prisma.rentMonth.createMany({
      data: h.months.map((m) => ({
        organisationId: actor.organisationId,
        leaseId: lease!.id,
        month: m.month,
        dueDate: day(m.dueDate),
        rentDue: m.rentDue,
        paidAmount: m.paidAmount,
        paidDate: m.paidDate ? day(m.paidDate) : null,
        daysLate: m.daysLate,
        arrears30: m.arrears30,
      })),
    })
    months += h.months.length
  }
  const summary = await scoreOrganisation(actor)
  return { ...summary, company: org.name, tenancies: roster.length, created, months }
}

if (require.main === module) {
  require('dotenv/config')
  const email = process.argv[2] || 'demo@example.com'
  prisma.user
    .findUnique({ where: { email } })
    .then(async (user) => {
      if (!user) throw new Error(`No user with email ${email}. Run the seed first.`)
      const r = await loadDemo(actorFor(user))
      console.log(`${r.company}: ${r.tenancies} tenancies (${r.created} created), ${r.months} months of rent history, ${r.scored} scored as of ${r.asOf}: ${JSON.stringify(r.bands)}.`)
    })
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e)
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
