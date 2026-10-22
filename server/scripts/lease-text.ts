// Prints the page text of lease PDFs, as the extractor sees it:  npx tsx scripts/lease-text.ts ../data/leases/lease-c-nz-01.pdf
import { readFileSync } from 'node:fs'
import { pdfPages } from '../src/leases/text'

async function main() {
  for (const f of process.argv.slice(2)) {
    const pages = await pdfPages(readFileSync(f))
    console.log(`===== ${f}: ${pages.length} pages`)
    for (const p of pages) console.log(`--- page ${p.num}\n${p.text}`)
  }
}
main()
