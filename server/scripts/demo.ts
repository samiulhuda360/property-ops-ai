// Loads the demo month through every automation, using the real pipelines.
//   npm run demo -w server                       rules only (no API key needed)
//   AI_API_KEY=... npm run demo -w server        with the model (responses are cached on disk)
// Safe to run again: each loader replaces or skips what it loaded before.
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import { loadDemo as loadDocuments } from '../src/documents/demo'
import { loadDemo as loadInbox } from '../src/inbox/demo'
import { loadDemo as loadReconciliation } from '../src/reconciliation/demo'

async function main() {
  const email = process.argv[2] ?? 'demo@example.com'
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) throw new Error(`No user ${email}. Run npm run db:setup first.`)

  console.log('Tenant inbox: 15 emails through the webhook pipeline...')
  console.log(JSON.stringify(await loadInbox(user.id)))
  console.log('Documents: 12 invoices and 3 tenancy summaries...')
  console.log(JSON.stringify(await loadDocuments(user.id)))
  console.log('Reconciliation: the September 2026 bank statement...')
  console.log(JSON.stringify(await loadReconciliation(user.id)))
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
