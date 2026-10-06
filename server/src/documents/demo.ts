// Demo data for the Documents queue: 15 of the synthetic PDFs (September supplier invoices and three tenancy
// summaries, five of them with planted problems) pushed through the real pipeline, as if received in September 2026.
// With a model configured it uses llm+validation (through the disk cache); without one, the rules.
//
//   npx tsx src/documents/demo.ts [email]      (from server/; defaults to demo@example.com)
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { prisma } from '../lib/prisma'
import { defaultMethod, itemRef, processDocument, removeStoredFile } from './service'

export const DEMO_DATA_DIR = resolve(__dirname, '../../../data/documents')

/** [file, received]: in the order they arrived. */
export const DEMO_DOCUMENTS: [string, string][] = [
  ['insurance-01-tak9.pdf', '2026-09-02'],
  ['invoice-05-electrical-gln22.pdf', '2026-09-04'],
  ['water-01-mte14.pdf', '2026-09-08'],
  ['invoice-02-plumbing-pon7.pdf', '2026-09-09'],
  ['invoice-01-plumbing-mte14.pdf', '2026-09-10'],
  ['invoice-11-locksmiths-tak9.pdf', '2026-09-12'],
  ['lease-01-mte14.pdf', '2026-09-12'],
  ['lease-02-pon7.pdf', '2026-09-12'], // rent differs from the lease record
  ['invoice-10-gardens-pap18.pdf', '2026-09-16'],
  ['lease-06-one3.pdf', '2026-09-16'],
  ['invoice-07-electrical-mrb6.pdf', '2026-09-19'], // GST at the old 12.5% rate
  ['invoice-08-cleaning-nln11.pdf', '2026-09-22'], // 26% over the quote
  ['invoice-13-pest-avd25.pdf', '2026-09-23'], // no GST number
  ['invoice-03-plumbing-pon7.pdf', '2026-09-25'], // the same invoice again, as a reminder
  ['invoice-06-electrical-one3.pdf', '2026-09-25'],
]

export interface DemoResult {
  loaded: number
  method: string
  needsAttention: number
}

/** Loads the sample for one manager, replacing an earlier demo load (its documents and automation runs). */
export async function loadDemo(userId: number): Promise<DemoResult> {
  const files = DEMO_DOCUMENTS.map(([file]) => file)
  const earlier = await prisma.document.findMany({
    where: { userId, fileName: { in: files } },
    select: { id: true, storagePath: true },
  })
  if (earlier.length) {
    await prisma.automationRun.deleteMany({ where: { userId, itemRef: { in: earlier.map((d) => itemRef(d.id)) } } })
    await prisma.document.deleteMany({ where: { id: { in: earlier.map((d) => d.id) } } })
    for (const d of earlier) removeStoredFile(d.storagePath)
  }

  let needsAttention = 0
  for (const [file, received] of DEMO_DOCUMENTS) {
    const doc = await processDocument({
      userId,
      fileName: file,
      data: readFileSync(join(DEMO_DATA_DIR, file)),
      receivedAt: new Date(`${received}T09:00:00+12:00`), // 9 am in Auckland
    })
    const issues = doc.issues as { severity?: string }[]
    if (issues.some((i) => i.severity !== 'info')) needsAttention++
  }
  return { loaded: DEMO_DOCUMENTS.length, method: defaultMethod(), needsAttention }
}

if (require.main === module) {
  require('dotenv/config')
  const email = process.argv[2] || 'demo@example.com'
  prisma.user
    .findUnique({ where: { email } })
    .then(async (user) => {
      if (!user) throw new Error(`No user with email ${email}. Run the seed first.`)
      const result = await loadDemo(user.id)
      console.log(
        `Loaded ${result.loaded} documents for ${email} with ${result.method}; ${result.needsAttention} have issues to review.`,
      )
    })
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e)
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
