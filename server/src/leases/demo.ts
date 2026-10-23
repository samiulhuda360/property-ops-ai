// Demo data for the Leases page: the billing system's issued invoices (data/leases/invoices.csv, with eight planted
// mismatches) and the 24 sample leases pushed through the real pipeline, as if received in September 2026.
// With a model configured (or AI_DRIVER=replay) it uses the hybrid route through the committed reply cache; without
// one, the rules.
//
//   npx tsx src/leases/demo.ts [email]      (from server/; defaults to demo@example.com)
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { prisma } from '../lib/prisma'
import { defaultRoute, importIssuedInvoices, itemRef, processLease, removeStoredFile } from './service'
import { actorFor, type Actor } from '../lib/actor'

export const DEMO_LEASES_DIR = resolve(__dirname, '../../../data/leases')

export interface DemoLease {
  file: string
  title: string
  country: 'NZ' | 'AU' | 'UK' | 'US'
  leaseType: 'commercial' | 'residential'
}

/** The samples, in the order they arrived. Titles are for the "pick a sample" list. */
export const DEMO_LEASES: DemoLease[] = [
  { file: 'lease-c-nz-01.pdf', title: 'Deed of lease, cafe at 118 Quay Street, Auckland', country: 'NZ', leaseType: 'commercial' },
  { file: 'lease-c-nz-02.pdf', title: 'Deed of lease, physio clinic, Hamilton', country: 'NZ', leaseType: 'commercial' },
  { file: 'lease-c-nz-03.pdf', title: 'Deed of lease, warehouse, Hobsonville', country: 'NZ', leaseType: 'commercial' },
  { file: 'lease-c-au-01.pdf', title: 'Retail lease, gelato shop, Parramatta NSW', country: 'AU', leaseType: 'commercial' },
  { file: 'lease-c-au-02.pdf', title: 'Office lease, Collins Street, Melbourne VIC', country: 'AU', leaseType: 'commercial' },
  { file: 'lease-c-au-03.pdf', title: 'Industrial unit, Brisbane QLD', country: 'AU', leaseType: 'commercial' },
  { file: 'lease-c-uk-01.pdf', title: 'Lease of business premises, bookshop, Bristol', country: 'UK', leaseType: 'commercial' },
  { file: 'lease-c-uk-02.pdf', title: 'Office suite, Deansgate, Manchester', country: 'UK', leaseType: 'commercial' },
  { file: 'lease-c-uk-03.pdf', title: 'Industrial unit, Oakwood Estate, Leeds', country: 'UK', leaseType: 'commercial' },
  { file: 'lease-c-us-01.pdf', title: 'Commercial lease, dental office, Atlanta GA', country: 'US', leaseType: 'commercial' },
  { file: 'lease-c-us-02.pdf', title: 'Commercial lease, fitness studio, Austin TX', country: 'US', leaseType: 'commercial' },
  { file: 'lease-c-us-03.pdf', title: 'Commercial lease, bakery, Denver CO', country: 'US', leaseType: 'commercial' },
  { file: 'lease-r-nz-01.pdf', title: 'Residential tenancy, Devonport, Auckland', country: 'NZ', leaseType: 'residential' },
  { file: 'lease-r-nz-02.pdf', title: 'Residential tenancy, Remuera, Auckland', country: 'NZ', leaseType: 'residential' },
  { file: 'lease-r-nz-03.pdf', title: 'Residential tenancy, Te Atatu Peninsula, Auckland', country: 'NZ', leaseType: 'residential' },
  { file: 'lease-r-au-01.pdf', title: 'Residential tenancy, Bondi NSW', country: 'AU', leaseType: 'residential' },
  { file: 'lease-r-au-02.pdf', title: 'Residential tenancy, Carindale QLD', country: 'AU', leaseType: 'residential' },
  { file: 'lease-r-au-03.pdf', title: 'Residential tenancy, St Kilda VIC', country: 'AU', leaseType: 'residential' },
  { file: 'lease-r-uk-01.pdf', title: 'Assured shorthold tenancy, Clifton, Bristol', country: 'UK', leaseType: 'residential' },
  { file: 'lease-r-uk-02.pdf', title: 'Assured shorthold tenancy, Leeds', country: 'UK', leaseType: 'residential' },
  { file: 'lease-r-uk-03.pdf', title: 'Assured shorthold tenancy, Quayside, Newcastle', country: 'UK', leaseType: 'residential' },
  { file: 'lease-r-us-01.pdf', title: 'Residential lease, Upper West Side, New York NY', country: 'US', leaseType: 'residential' },
  { file: 'lease-r-us-02.pdf', title: 'Residential lease, Portland OR', country: 'US', leaseType: 'residential' },
  { file: 'lease-r-us-03.pdf', title: 'Residential lease, Lakeshore, Chicago IL', country: 'US', leaseType: 'residential' },
]

export interface DemoResult {
  invoices: number
  loaded: number
  route: string
  needsAttention: number
}

/** Loads the sample for one manager, replacing an earlier demo load (its leases, audit events and automation runs). */
export async function loadDemo(actor: Actor): Promise<DemoResult> {
  const files = DEMO_LEASES.map((s) => s.file)
  const earlier = await prisma.leaseAbstract.findMany({ where: { organisationId: actor.organisationId, fileName: { in: files } }, select: { id: true, storagePath: true } })
  if (earlier.length) {
    await prisma.automationRun.deleteMany({ where: { organisationId: actor.organisationId, itemRef: { in: earlier.map((l) => itemRef(l.id)) } } })
    await prisma.leaseAbstract.deleteMany({ where: { id: { in: earlier.map((l) => l.id) } } })
    for (const l of earlier) removeStoredFile(l.storagePath)
  }
  await prisma.issuedInvoice.deleteMany({ where: { organisationId: actor.organisationId } })
  const invoices = await importIssuedInvoices(actor, readFileSync(join(DEMO_LEASES_DIR, 'invoices.csv'), 'utf8'))

  let needsAttention = 0
  for (const [i, sample] of DEMO_LEASES.entries()) {
    const lease = await processLease({
      actor,
      fileName: sample.file,
      data: readFileSync(join(DEMO_LEASES_DIR, sample.file)),
      receivedAt: new Date(`2026-09-${String(3 + Math.floor(i / 2)).padStart(2, '0')}T${i % 2 ? '14' : '09'}:30:00+12:00`),
    })
    const terms = lease.terms as Record<string, { status?: string }>
    const risks = lease.risks as { status: string }[]
    if (Object.values(terms).some((t) => t.status === 'needs_person') || risks.length) needsAttention++
  }
  return { invoices, loaded: DEMO_LEASES.length, route: defaultRoute(), needsAttention }
}

if (require.main === module) {
  require('dotenv/config')
  const email = process.argv[2] || 'demo@example.com'
  prisma.user
    .findUnique({ where: { email } })
    .then(async (user) => {
      if (!user) throw new Error(`No user with email ${email}. Run the seed first.`)
      const result = await loadDemo(actorFor(user))
      console.log(`Loaded ${result.invoices} issued invoices and ${result.loaded} leases for ${email} with ${result.route}; ${result.needsAttention} need attention.`)
    })
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e)
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
