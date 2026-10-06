// Where the inbox feature's knowledge and sample data live: data/ at the repository root.
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Category, Urgency } from './types'

function dataRoot(): string {
  if (process.env.INBOX_DATA_DIR) return resolve(process.env.INBOX_DATA_DIR)
  // server/src/inbox (tsx, tests) and server/dist/inbox (built) both sit three levels below the repository root.
  const fromHere = resolve(__dirname, '..', '..', '..', 'data')
  if (existsSync(fromHere)) return fromHere
  return resolve(process.cwd(), '..', 'data')
}

export const termsPath = () => join(dataRoot(), 'knowledge', 'tenancy-terms.md')
export const sampleEmailsPath = (file = 'emails.json') => join(dataRoot(), 'inbox', file)

export interface SampleLabels {
  category: Category
  urgency: Urgency
  tenant_email: string | null
  property_code: string | null
  needs_person: boolean
  expected_clause: number | null
  should_create_ticket: boolean
}

export interface SampleEmail {
  id: string
  from: string
  receivedAt: string
  subject: string
  text: string
  labels: SampleLabels
  notes?: string
}

/** Labelled synthetic emails: the 60 in data/inbox/emails.json, or the 30 held out in emails-holdout.json. */
export function loadSampleEmails(file = 'emails.json'): SampleEmail[] {
  const doc = JSON.parse(readFileSync(sampleEmailsPath(file), 'utf8')) as { emails: SampleEmail[] }
  return doc.emails
}
