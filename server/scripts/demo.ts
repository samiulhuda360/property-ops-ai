// Loads the demo month through every automation, using the real pipelines.
//   npm run demo -w server                       rules only (no API key needed)
//   AI_API_KEY=... npm run demo -w server        with the model (responses are cached on disk)
// Safe to run again: each loader replaces or skips what it loaded before.
import 'dotenv/config'
import { setCallLogger } from '../src/ai/llm'
import { prisma } from '../src/lib/prisma'
import { loadDemo as loadDocuments } from '../src/documents/demo'
import { loadDemo as loadInbox } from '../src/inbox/demo'
import { loadDemo as loadReconciliation } from '../src/reconciliation/demo'
import { loadDemo as loadLeases } from '../src/leases/demo'
import { loadDemo as loadRisk } from '../src/risk/demo'
import { loadDemo as loadMaintenance } from '../src/maintenance/demo'
import { actorFor } from '../src/lib/actor'

// Log model calls exactly as the server does, so the usage panel includes the demo load.
setCallLogger((record) => prisma.aiCall.create({ data: record }).then(() => undefined))

// Acme (demo@example.com) gets every automation; Kestrel gets the ones its data covers: arrears risk and triage.
const COMPANIES = [
  { email: 'demo@example.com', inbox: true, documents: true, reconciliation: true, leases: true },
  { email: 'claire@kestrel.example.com', inbox: false, documents: false, reconciliation: false, leases: false },
]

async function main() {
  const only = process.argv[2]
  for (const c of COMPANIES.filter((c) => !only || c.email === only)) {
    const user = await prisma.user.findUnique({ where: { email: c.email } })
    if (!user) throw new Error(`No user ${c.email}. Run npm run db:setup first.`)
    const actor = actorFor(user)
    console.log(`\n== ${c.email} ==`)
    if (c.inbox) {
      console.log('Tenant inbox: 15 emails through the webhook pipeline...')
      console.log(JSON.stringify(await loadInbox(actor)))
    }
    if (c.documents) {
      console.log('Documents: 12 invoices and 3 tenancy summaries...')
      console.log(JSON.stringify(await loadDocuments(actor)))
    }
    if (c.reconciliation) {
      console.log('Reconciliation: the September 2026 bank statement...')
      console.log(JSON.stringify(await loadReconciliation(actor)))
    }
    if (c.leases) {
      console.log('Leases: the issued-invoice ledger and 24 sample leases through the abstraction pipeline...')
      console.log(JSON.stringify(await loadLeases(actor)))
    }
    console.log('Arrears risk: the tenancy roster, 24 months of rent history, scored with the exported model...')
    console.log(JSON.stringify(await loadRisk(actor)))
    console.log('Maintenance: the labelled tenant requests through the triage pipeline...')
    console.log(JSON.stringify(await loadMaintenance(actor)))
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
