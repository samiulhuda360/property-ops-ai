// Demo data for the tenant inbox: 15 of the labelled sample emails pushed through the same pipeline the webhook
// uses (store, triage, maintenance job, automation run). With a model configured the calls go through the disk cache;
// without one the rules triage them. Each email keeps a fixed messageId, so loading twice adds nothing.
import { aiEnabled } from '../ai/llm'
import { loadSampleEmails } from './data'
import { ingestEmail } from './pipeline'

/** A mix of categories and the hard cases: urgent repairs, a duplicate report, an injection attempt, te reo, ... */
export const DEMO_EMAIL_IDS = [
  'E01', // no hot water (urgent)
  'E07', // polite email hiding a burning power point (urgent)
  'E09', // water through a ceiling light (urgent)
  'E10', // follow-up on E09: linked to the same job
  'E11', // dripping tap (routine)
  'E13', // two topics: new bank account and a repair
  'E14', // follow-up on an open job
  'E20', // angry, but not urgent
  'E23', // a tenant writing from a personal address
  'E24', // hours cut, asks for a payment arrangement
  'E31', // prompt-injection attempt
  'E34', // pet request
  'E42', // mixed English and te reo Māori
  'E46', // a neighbour's complaint (not a tenant)
  'E50', // bond refund after the tenancy ended
] as const

export interface DemoLoadResult {
  loaded: number
  alreadyLoaded: number
  method: 'rules' | 'llm+rules'
}

export async function loadDemo(userId: number): Promise<DemoLoadResult> {
  const wanted = new Set<string>(DEMO_EMAIL_IDS)
  const emails = loadSampleEmails()
    .filter((e) => wanted.has(e.id))
    .sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime())

  let loaded = 0
  let alreadyLoaded = 0
  for (const e of emails) {
    const result = await ingestEmail(userId, {
      from: e.from,
      subject: e.subject,
      text: e.text,
      messageId: `demo-${e.id}`,
      receivedAt: new Date(e.receivedAt),
    })
    if (result.duplicate) alreadyLoaded++
    else loaded++
  }
  return { loaded, alreadyLoaded, method: aiEnabled() ? 'llm+rules' : 'rules' }
}
