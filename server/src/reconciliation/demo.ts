// Loads the synthetic September 2026 statement (data/bank/2026-09-statement.csv) through the real import, so the
// Reconciliation page, the Excel report and the hours-returned report have data.
// - With AI off (or no key) it runs the rules only.
// - With a key it also asks the model about the lines the rules couldn't place, through the disk cache.
// Running it again is safe: lines already imported are skipped.
//
// From server/: npx tsx src/reconciliation/demo.ts [email]   (default demo@example.com)
import { DEMO_STATEMENT, readDemoStatement } from './fixture'
import { importStatement, type ImportResult } from './service'

export async function loadDemo(userId: number): Promise<ImportResult> {
  return importStatement(userId, DEMO_STATEMENT, readDemoStatement())
}

async function main() {
  const { prisma } = await import('../lib/prisma')
  const email = process.argv[2] ?? 'demo@example.com'
  try {
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) throw new Error(`No user ${email}: run the seed first (npm run db:seed).`)
    const result = await loadDemo(user.id)
    console.log(
      result.alreadyImported
        ? `Already imported: ${result.lines} lines in batch ${result.batch}.`
        : `Imported ${result.newLines} lines into batch ${result.batch}: ${result.matched} matched, ${result.exceptions} exceptions, ` +
            `${result.suggestions} model suggestions (method: ${result.method}).`,
    )
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config()
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
