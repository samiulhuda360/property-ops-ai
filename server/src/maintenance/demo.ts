// Demo data for maintenance triage: the labelled tenant requests (data/maintenance/requests.json) for one company
// pushed through the real pipeline, as if received in September 2026. With a model configured (or AI_DRIVER=replay)
// it uses llm+rules through the committed reply cache; without one, the rules.
//
//   npx tsx src/maintenance/demo.ts [email]      (from server/; defaults to demo@example.com)
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { actorFor, type Actor } from '../lib/actor'
import { prisma } from '../lib/prisma'
import { defaultMethod } from './pipeline'
import { createFromRequest, itemRef } from './service'
import type { Category, SafetyFlag, Urgency } from './types'

export const REQUESTS_PATH = resolve(__dirname, '../../../data/maintenance/requests.json')

export interface LabelledRequest {
  id: string
  split: 'dev' | 'heldout'
  company: string
  code: string
  tenant: string | null
  text: string
  photoNote: string | null
  labels: { category: Category; urgency: Urgency; safety: SafetyFlag[] }
}

export const loadRequests = (): LabelledRequest[] => (JSON.parse(readFileSync(REQUESTS_PATH, 'utf8')) as { requests: LabelledRequest[] }).requests

/** Earlier completed jobs for Acme, so the budget bands and contractor records have a history to draw on. */
const ACME_HISTORY: [string, string, string, string, string, number, string, string][] = [
  ['TAK9', 'Acme Plumbing', 'Blocked shower drain', 'Shower draining slowly; cleared the trap and the line.', 'medium', 190, '2026-05-14', 'plumbing'],
  ['HND5', 'Acme Plumbing', 'Burst pipe under the kitchen sink', 'Water across the kitchen floor; isolated and replaced the fitting.', 'urgent', 650, '2026-03-02', 'water_leak'],
  ['MRB6', 'Acme Gas & Heating', 'Gas hob not igniting', 'Hob igniter faulty; replaced and tested for leaks.', 'high', 330, '2026-04-22', 'gas_heating'],
  ['PON7', 'Acme Gas & Heating', 'Califont service', 'Annual service of the gas water heater.', 'low', 210, '2026-02-10', 'gas_heating'],
  ['GLN22', 'Acme Electrical', 'Power points dead in lounge', 'Two sockets dead; tracked to a failed RCD, replaced.', 'high', 285, '2026-06-30', 'electrical'],
  ['AVD25', 'Acme Locksmiths', 'Lockout, replacement keys', 'Tenant locked out; gained entry and cut two keys.', 'urgent', 180, '2026-07-19', 'security'],
  ['NLN11', 'Acme Roofing', 'Roof leak over bedroom', 'Water stain on the ceiling after heavy rain; replaced two cracked tiles.', 'high', 720, '2026-06-08', 'water_leak'],
  ['BLK2', 'Acme Handyman', 'Fence panel down', 'Side fence panel blown out; re-fixed to the posts.', 'low', 160, '2026-07-02', 'structural'],
  ['ONE3', 'Acme Handyman', 'Oven door hinge', 'Oven door not closing; replaced the hinges.', 'low', 140, '2026-05-27', 'appliance'],
  ['MTE14', 'Acme Pest Control', 'Wasp nest in the eaves', 'Nest above the back door; treated and removed.', 'medium', 150, '2026-02-24', 'pest'],
  ['TAK9', 'Acme Gas & Heating', 'Smell of gas near the meter', 'Tenant smelt gas by the meter; leak at a union, repaired and certified.', 'urgent', 410, '2026-01-15', 'gas_heating'],
]

export interface MaintenanceDemoResult {
  company: string
  loaded: number
  method: string
  urgent: number
  /** Earlier completed jobs added as history (Acme only). */
  history: number
}

/** Loads the company's labelled requests through the pipeline, replacing an earlier demo load. */
export async function loadDemo(actor: Actor): Promise<MaintenanceDemoResult> {
  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: actor.organisationId } })
  const requests = loadRequests().filter((r) => r.company === org.slug)
  const earlier = await prisma.maintenanceRequest.findMany({
    where: { property: { organisationId: actor.organisationId }, source: 'tenant_request', triage: { path: ['sampleId'], string_starts_with: 'M' } },
    select: { id: true },
  })
  if (earlier.length) {
    await prisma.automationRun.deleteMany({ where: { organisationId: actor.organisationId, itemRef: { in: earlier.map((j) => itemRef(j.id)) } } })
    await prisma.auditEvent.deleteMany({ where: { organisationId: actor.organisationId, entity: 'maintenance', entityId: { in: earlier.map((j) => j.id) } } })
    await prisma.maintenanceRequest.deleteMany({ where: { id: { in: earlier.map((j) => j.id) } } })
  }
  let history = 0
  if (org.slug === 'acme') {
    for (const [code, contractorName, title, description, priority, cost, completed, category] of ACME_HISTORY) {
      const property = await prisma.property.findFirst({ where: { organisationId: actor.organisationId, code } })
      const contractor = await prisma.contractor.findFirst({ where: { organisationId: actor.organisationId, name: contractorName } })
      if (!property || !contractor) continue
      const exists = await prisma.maintenanceRequest.findFirst({ where: { propertyId: property.id, title } })
      if (exists) continue
      await prisma.maintenanceRequest.create({
        data: { propertyId: property.id, contractorId: contractor.id, title, description, priority, status: 'completed', category, quoteAmount: cost, cost, completedAt: new Date(`${completed}T00:00:00Z`), createdAt: new Date(`${completed}T00:00:00Z`) },
      })
      history++
    }
  }
  let urgent = 0
  for (const [i, r] of requests.entries()) {
    const property = await prisma.property.findFirst({ where: { organisationId: actor.organisationId, code: r.code } })
    if (!property) continue
    const dayOfMonth = 1 + Math.floor((i * 28) / Math.max(1, requests.length))
    const job = await createFromRequest({
      actor,
      propertyId: property.id,
      text: r.text,
      photoNote: r.photoNote,
      receivedAt: new Date(`2026-09-${String(dayOfMonth).padStart(2, '0')}T${i % 2 ? '16' : '08'}:${String((i * 7) % 60).padStart(2, '0')}:00+12:00`),
      sampleId: r.id,
    })
    if (job.priority === 'urgent') urgent++
  }
  return { company: org.name, loaded: requests.length, method: defaultMethod(), urgent, history }
}

if (require.main === module) {
  require('dotenv/config')
  const email = process.argv[2] || 'demo@example.com'
  prisma.user
    .findUnique({ where: { email } })
    .then(async (user) => {
      if (!user) throw new Error(`No user with email ${email}. Run the seed first.`)
      const r = await loadDemo(actorFor(user))
      console.log(`${r.company}: ${r.loaded} requests triaged with ${r.method}; ${r.urgent} urgent.`)
    })
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e)
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
