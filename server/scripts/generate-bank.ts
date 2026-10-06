// Generates the synthetic September 2026 bank statement for the demo portfolio, with its ground truth.
//
//   data/bank/2026-09-statement.csv  an NZ bank export format: Date, Amount, Payee, Particulars, Code, Reference,
//                                    Transaction Type (dates dd/mm/yyyy, money in positive, money out negative)
//   data/bank/truth.json             for every line: what it is, the tenancy and rent weeks or the job it belongs to,
//                                    the exception a person should see; plus the expected arrears and credits
//
// Run in server/: npx tsx scripts/generate-bank.ts
//
// The portfolio below mirrors prisma/seed.ts (a database test checks that the two agree). Every person, address and
// business is invented.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const OUT_DIR = resolve(__dirname, '..', '..', 'data', 'bank')

const LEASES = [
  { code: 'MTE14', address: '14 Kowhai Road', suburb: 'Mount Eden', firstName: 'Aroha', lastName: 'Ngata', rent: 720, start: '2025-02-10', end: null },
  { code: 'PON7', address: '7 Vine Street', suburb: 'Ponsonby', firstName: 'Daniel', lastName: 'Kim', rent: 650, start: '2024-11-04', end: null },
  { code: 'GLN22', address: '22 Ash Street', suburb: 'Glen Innes', firstName: 'Mele', lastName: 'Fifita', rent: 610, start: '2025-06-02', end: null },
  { code: 'HND5', address: '5 Rimu Crescent', suburb: 'Henderson', firstName: 'Rajesh', lastName: 'Patel', rent: 680, start: '2023-09-18', end: null },
  { code: 'TAK9', address: '9 Totara Avenue', suburb: 'Takapuna', firstName: 'Sophie', lastName: 'Clarke', rent: 780, start: '2025-01-13', end: null },
  { code: 'ONE3', address: '3/41 Arthur Street', suburb: 'Onehunga', firstName: 'Tom', lastName: 'Wright', rent: 560, start: '2026-03-02', end: null },
  { code: 'PAP18', address: '18 Matai Road', suburb: 'Papatoetoe', firstName: 'Ana', lastName: 'Tupou', rent: 590, start: '2024-07-22', end: null },
  { code: 'NLN11', address: '11 Kauri Lane', suburb: 'New Lynn', firstName: 'Liam', lastName: "O'Brien", rent: 540, start: '2025-10-06', end: null },
  { code: 'MRB6', address: '6 Tui Terrace', suburb: 'Mairangi Bay', firstName: 'Hannah', lastName: 'Lee', rent: 850, start: '2024-04-15', end: null },
  { code: 'AVD25', address: '25 Puriri Street', suburb: 'Avondale', firstName: 'Wiremu', lastName: 'Parata', rent: 600, start: '2025-08-25', end: null },
  { code: 'HOW30', address: '30 Pohutukawa Drive', suburb: 'Howick', firstName: 'Grace', lastName: 'Chen', rent: 760, start: '2023-05-01', end: '2026-08-31' },
] as const

// Properties without a tenancy in the demo data (one is used by the bond receipt).
const VACANT = [{ code: 'BLK2', address: '2/8 Manuka Road', suburb: 'Blockhouse Bay' }]

const CONTRACTORS = [
  { name: 'Acme Plumbing', trade: 'plumbing' },
  { name: 'Acme Electrical', trade: 'electrical' },
  { name: 'Acme Cleaning Co', trade: 'cleaning' },
  { name: 'Acme Gardens', trade: 'gardening' },
  { name: 'Acme Locksmiths', trade: 'locksmith' },
  { name: 'Acme Roofing', trade: 'roofing' },
  { name: 'Acme Pest Control', trade: 'pest_control' },
  { name: 'Acme Insurance', trade: 'insurance' },
  { name: 'Acme Water', trade: 'utilities' },
]

// [property code, contractor, title, status, quote]
const JOBS: [string, string, string, string, number][] = [
  ['MTE14', 'Acme Plumbing', 'Hot water cylinder element', 'in_progress', 480],
  ['PON7', 'Acme Plumbing', 'Leaking kitchen mixer', 'completed', 220],
  ['GLN22', 'Acme Electrical', 'Smoke alarms to standard', 'completed', 360],
  ['HND5', 'Acme Roofing', 'Gutter clean and downpipe', 'in_progress', 540],
  ['TAK9', 'Acme Locksmiths', 'Front door lock', 'completed', 295],
  ['ONE3', 'Acme Electrical', 'Bathroom extractor fan', 'open', 310],
  ['PAP18', 'Acme Gardens', 'Lawn and hedge tidy', 'completed', 180],
  ['NLN11', 'Acme Cleaning Co', 'Mould treatment, bedroom 2', 'open', 420],
  ['MRB6', 'Acme Electrical', 'Heat pump service', 'completed', 240],
  ['AVD25', 'Acme Pest Control', 'Rodent treatment', 'in_progress', 260],
  ['HOW30', 'Acme Cleaning Co', 'End of tenancy clean', 'completed', 520],
]

const MONDAYS_AUGUST = ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31']
const MONDAYS_SEPTEMBER = ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']
export const PERIOD = { start: '2026-09-01', end: '2026-09-30' }

const rentReference = (l: (typeof LEASES)[number]) => `${l.lastName.toUpperCase().replace(/'/g, '')} ${l.code}`
const jobKey = (code: string, title: string) => `${code}: ${title}`

type Kind = 'rent' | 'contractor' | 'bond' | 'refund' | 'fee' | 'transfer' | 'unknown'
type Exception =
  | 'underpaid'
  | 'overpaid'
  | 'duplicate'
  | 'unknown_payer'
  | 'ambiguous'
  | 'payment_to_ended_lease'
  | 'no_matching_job'
  | 'amount_differs_from_quote'

interface Spec {
  date: string
  amount: number
  payee: string
  particulars?: string
  code?: string
  reference?: string
  type: string
  kind: Kind
  /** The tenancy (property code) the engine should identify for a rent or refund line. */
  lease?: string
  /** The rent is held for a person instead of being allocated (duplicate, ended tenancy, unknown, ambiguous). */
  hold?: boolean
  contractor?: string
  /** The job (property code of the contractor's job) a contractor payment belongs to. */
  job?: string
  property?: string
  exception?: Exception
  /** For lines a person must decide: the real answer, which a model suggestion is scored against. */
  answer?: { lease: string | null; category: string }
  case?: string
  noise?: string[]
  note: string
}

// One row per bank line, in date order. Cases are the planted situations; noise is ordinary variation.
const SPECS: Spec[] = [
  { date: '2026-09-01', amount: 1800, payee: 'K HAWKINS', particulars: 'BOND', code: 'BLK2', reference: '2/8 MANUKA RD', type: 'Direct Credit', kind: 'bond', property: 'BLK2', case: 'bond_receipt', note: 'Bond for a new tenancy at 2/8 Manuka Road (4 weeks at $450). It must be lodged, not counted as rent.' },

  { date: '2026-09-07', amount: 720, payee: 'A NGATA', particulars: 'RENT', reference: 'NGATA MTE14', type: 'Automatic Payment', kind: 'rent', lease: 'MTE14', note: 'Regular rent.' },
  { date: '2026-09-07', amount: 650, payee: 'D KIM', reference: 'KIM PON7', type: 'Automatic Payment', kind: 'rent', lease: 'PON7', note: 'Regular rent.' },
  { date: '2026-09-07', amount: 1220, payee: 'M FIFITA', particulars: 'FORTNIGHT', reference: 'FIFITA GLN22', type: 'Automatic Payment', kind: 'rent', lease: 'GLN22', case: 'fortnightly_payment', note: 'Pays fortnightly: two weeks of rent (7 and 14 September).' },
  { date: '2026-09-07', amount: 680, payee: 'R PATEL', particulars: 'RENT', reference: 'PATEL HND5', type: 'Automatic Payment', kind: 'rent', lease: 'HND5', note: 'Regular rent.' },
  { date: '2026-09-07', amount: 780, payee: 'J LEE', particulars: 'RENT', reference: 'CLARKE TAK9', type: 'Automatic Payment', kind: 'rent', lease: 'TAK9', noise: ['partner_pays'], note: "Sophie Clarke's partner pays from their own account, with the right reference." },
  { date: '2026-09-07', amount: 560, payee: 'T WRIGHT', reference: 'WRIGHT ONE3', type: 'Automatic Payment', kind: 'rent', lease: 'ONE3', note: 'Regular rent.' },
  { date: '2026-09-07', amount: 590, payee: 'A TUPOU', particulars: 'RENT', reference: 'TUPOU PAP18', type: 'Automatic Payment', kind: 'rent', lease: 'PAP18', note: 'Regular rent.' },
  { date: '2026-09-07', amount: 850, payee: 'H LEE', particulars: 'RENT', reference: 'LEE MRB6', type: 'Automatic Payment', kind: 'rent', lease: 'MRB6', note: 'Regular rent.' },
  { date: '2026-09-07', amount: 760, payee: 'G CHEN', particulars: 'RENT', reference: 'CHEN HOW30', type: 'Automatic Payment', kind: 'rent', lease: 'HOW30', hold: true, exception: 'payment_to_ended_lease', case: 'payment_after_lease_end', note: "Grace Chen's tenancy ended on 31 August; her automatic payment ran once more. It is owed back to her." },
  { date: '2026-09-08', amount: 540, payee: 'L OBRIEN', reference: 'OBRIEN NLN11', type: 'Direct Credit', kind: 'rent', lease: 'NLN11', note: 'Regular rent, paid a day late.' },
  { date: '2026-09-08', amount: 600, payee: 'W PARATA', reference: 'parata avd25', type: 'Direct Credit', kind: 'rent', lease: 'AVD25', noise: ['lower_case_reference'], note: 'Regular rent, lower-case reference.' },
  { date: '2026-09-09', amount: -520, payee: 'ACME CLEANING CO', particulars: 'INV 7781', code: 'HOW30', reference: 'END OF TENANCY', type: 'Bill Payment', kind: 'contractor', contractor: 'Acme Cleaning Co', job: 'HOW30', case: 'contractor_at_quote', note: 'End of tenancy clean, paid at the quoted amount.' },
  { date: '2026-09-10', amount: -760, payee: 'G CHEN', particulars: 'REFUND', code: 'HOW30', reference: 'RENT 07 SEP', type: 'Bill Payment', kind: 'refund', lease: 'HOW30', case: 'refund_to_ex_tenant', note: 'Refund of the automatic payment that arrived after the tenancy ended.' },
  { date: '2026-09-11', amount: 495, payee: 'B HARRIS', particulars: 'RENT', reference: '12 FERN ST', type: 'Direct Credit', kind: 'unknown', hold: true, exception: 'unknown_payer', answer: { lease: null, category: 'unidentified' }, case: 'unknown_payer', note: 'Not a tenant and not one of our properties: most likely paid to the wrong property manager.' },

  { date: '2026-09-14', amount: 720, payee: 'AROHA NGATA', reference: 'ngata mte14', type: 'Direct Credit', kind: 'rent', lease: 'MTE14', noise: ['lower_case_reference', 'full_name_payee'], note: 'Regular rent.' },
  { date: '2026-09-14', amount: 650, payee: 'D KIM', reference: 'KIM PON7', type: 'Automatic Payment', kind: 'rent', lease: 'PON7', note: 'Regular rent.' },
  { date: '2026-09-14', amount: 650, payee: 'D KIM', reference: 'KIM PON7', type: 'Automatic Payment', kind: 'rent', lease: 'PON7', hold: true, exception: 'duplicate', case: 'duplicate', note: 'The same payment listed twice in the export.' },
  { date: '2026-09-14', amount: 680, payee: 'R PATEL', particulars: 'RENT', reference: 'PATEL HND5', type: 'Automatic Payment', kind: 'rent', lease: 'HND5', note: 'Regular rent.' },
  { date: '2026-09-14', amount: 780, payee: 'J LEE', reference: 'clarke tak9 rent', type: 'Automatic Payment', kind: 'rent', lease: 'TAK9', noise: ['partner_pays', 'lower_case_reference', 'extra_words'], note: "Sophie Clarke's partner again, with the reference in lower case." },
  { date: '2026-09-14', amount: 510, payee: 'T WRIGHT', reference: 'WRIGHT ONE3', type: 'Automatic Payment', kind: 'rent', lease: 'ONE3', exception: 'underpaid', case: 'underpaid', note: '$50 short of the $560 weekly rent. The shortfall carries forward to the following weeks.' },
  { date: '2026-09-14', amount: 540, payee: "LIAM O'BRIEN", reference: "O'Brien NLN11", type: 'Direct Credit', kind: 'rent', lease: 'NLN11', noise: ['apostrophe', 'mixed_case_reference'], note: "Regular rent; the last payment Liam O'Brien makes this month." },
  { date: '2026-09-14', amount: 850, payee: 'H LEE', particulars: 'RENT', reference: 'LEE MRB6', type: 'Automatic Payment', kind: 'rent', lease: 'MRB6', note: 'Regular rent.' },
  { date: '2026-09-15', amount: 590, payee: 'TUPOU, A', particulars: 'RENT', reference: 'tupou pap18', type: 'Direct Credit', kind: 'rent', lease: 'PAP18', noise: ['comma_in_payee', 'lower_case_reference'], note: 'Regular rent, a day late.' },
  { date: '2026-09-15', amount: 600, payee: 'W PARATA', reference: 'PARATA AVD25', type: 'Direct Credit', kind: 'rent', lease: 'AVD25', note: 'Regular rent, a day late.' },
  { date: '2026-09-15', amount: -220, payee: 'ACME PLUMBING LTD', particulars: 'INV 1042', code: 'PON7', reference: 'KITCHEN MIXER', type: 'Bill Payment', kind: 'contractor', contractor: 'Acme Plumbing', job: 'PON7', case: 'contractor_at_quote', note: 'Leaking kitchen mixer, paid at the quoted amount.' },
  { date: '2026-09-18', amount: -395, payee: 'ACME ELECTRICAL', particulars: 'INV 2210', code: 'GLN22', reference: 'SMOKE ALARMS', type: 'Bill Payment', kind: 'contractor', contractor: 'Acme Electrical', job: 'GLN22', exception: 'amount_differs_from_quote', case: 'amount_differs_from_quote', note: 'Smoke alarms job quoted at $360; paid $395.' },

  { date: '2026-09-21', amount: 720, payee: 'A NGATA', particulars: 'RENT', code: 'WK3', reference: 'RENT NGATA MTE14', type: 'Automatic Payment', kind: 'rent', lease: 'MTE14', noise: ['extra_words'], note: 'Regular rent, extra words around the reference.' },
  { date: '2026-09-21', amount: 650, payee: 'KIM, D', reference: 'Kim Pon7', type: 'Automatic Payment', kind: 'rent', lease: 'PON7', noise: ['comma_in_payee', 'mixed_case_reference'], note: 'Regular rent.' },
  { date: '2026-09-21', amount: 1220, payee: 'MELE FIFITA', particulars: 'FORTNIGHT', reference: 'fifita gln22', type: 'Automatic Payment', kind: 'rent', lease: 'GLN22', case: 'fortnightly_payment', noise: ['lower_case_reference', 'full_name_payee'], note: 'Fortnightly payment: 21 and 28 September.' },
  { date: '2026-09-21', amount: 680, payee: 'RAJESH PATEL', reference: 'SEPT RENT', type: 'Direct Credit', kind: 'rent', lease: 'HND5', case: 'wrong_reference_known_payer', note: 'Wrong reference, but the payer is the tenant and the amount is exactly the rent.' },
  { date: '2026-09-21', amount: 780, payee: 'J LEE', type: 'Direct Credit', kind: 'rent', hold: true, exception: 'ambiguous', answer: { lease: 'TAK9', category: 'rent' }, case: 'ambiguous', note: "Sophie Clarke's partner paid with no reference. The surname matches Hannah Lee, but the amount is Sophie Clarke's rent, and the same payer used the TAK9 reference earlier in the month." },
  { date: '2026-09-21', amount: 560, payee: 'T WRIGHT', reference: 'WRIGHT ONE3', type: 'Automatic Payment', kind: 'rent', lease: 'ONE3', note: 'Full rent; $50 goes to the previous week first.' },
  { date: '2026-09-21', amount: 900, payee: 'H LEE', particulars: 'RENT', reference: 'LEE MRB6', type: 'Direct Credit', kind: 'rent', lease: 'MRB6', exception: 'overpaid', case: 'overpaid', note: '$50 more than the $850 rent: held as credit.' },
  { date: '2026-09-21', amount: 600, payee: 'WIREMU PARATA', particulars: 'RENT', reference: 'PARATA AVD25', type: 'Direct Credit', kind: 'rent', lease: 'AVD25', noise: ['full_name_payee'], note: 'Regular rent.' },
  { date: '2026-09-22', amount: 590, payee: 'A TUPOU', particulars: 'RENT', reference: 'TUPOU PAP18', type: 'Automatic Payment', kind: 'rent', lease: 'PAP18', note: 'Regular rent, a day late.' },
  { date: '2026-09-22', amount: -95, payee: 'ACME GARDENS', particulars: 'INV 0311', code: 'HOW30', reference: 'LAWNS', type: 'Bill Payment', kind: 'contractor', contractor: 'Acme Gardens', exception: 'no_matching_job', case: 'no_matching_job', note: 'Lawns at 30 Pohutukawa Drive: Acme Gardens has no job there and no job at this amount.' },
  { date: '2026-09-24', amount: 610, payee: 'SIONE M', particulars: 'MELE RENT', type: 'Direct Credit', kind: 'unknown', hold: true, exception: 'unknown_payer', answer: { lease: 'GLN22', category: 'rent' }, case: 'unknown_payer', note: "A relative paid a week of Mele Fifita's rent (her first name, her exact rent) although her fortnightly payments already cover the month." },
  { date: '2026-09-25', amount: 35, payee: 'ACME ELECTRICAL', particulars: 'CREDIT NOTE', code: 'GLN22', reference: 'CN 2210', type: 'Direct Credit', kind: 'contractor', contractor: 'Acme Electrical', job: 'GLN22', case: 'contractor_credit_note', note: 'Credit note for the smoke alarms invoice. The GLN22 code must not be read as rent from Mele Fifita.' },

  { date: '2026-09-28', amount: 720, payee: 'TE AWA M', reference: '14 KOWHAI RD', type: 'Direct Credit', kind: 'rent', lease: 'MTE14', case: 'amount_and_date_match', note: "Aroha Ngata's mother paid this week. No reference or name match; $720 is only Aroha Ngata's rent, and her week is due." },
  { date: '2026-09-28', amount: 650, payee: 'D KIM', reference: 'KIM PON7', type: 'Automatic Payment', kind: 'rent', lease: 'PON7', note: 'Regular rent.' },
  { date: '2026-09-28', amount: 680, payee: 'R PATEL', particulars: 'RENT', reference: 'PATEL HND5', type: 'Automatic Payment', kind: 'rent', lease: 'HND5', note: 'Regular rent.' },
  { date: '2026-09-28', amount: 780, payee: 'S CLARKE', particulars: 'RENT', reference: 'CLARKE TAK9', type: 'Direct Credit', kind: 'rent', lease: 'TAK9', note: 'Sophie Clarke pays this week herself.' },
  { date: '2026-09-28', amount: 560, payee: 'T WRIGHT', reference: 'WRIGHT ONE3', type: 'Automatic Payment', kind: 'rent', lease: 'ONE3', note: 'Full rent; the $50 shortfall is still carried.' },
  { date: '2026-09-28', amount: 850, payee: 'H LEE', particulars: 'RENT', reference: 'LEE MRB6', type: 'Automatic Payment', kind: 'rent', lease: 'MRB6', note: 'Regular rent.' },
  { date: '2026-09-29', amount: 590, payee: 'A TUPOU', particulars: 'RENT', reference: 'TUPOU PAP18', type: 'Automatic Payment', kind: 'rent', lease: 'PAP18', note: 'Regular rent, a day late.' },
  { date: '2026-09-29', amount: 600, payee: 'W PARATA', reference: 'PARATA AVD25', type: 'Direct Credit', kind: 'rent', lease: 'AVD25', note: 'Regular rent, a day late.' },
  { date: '2026-09-30', amount: -5, payee: '', particulars: 'MONTHLY A/C FEE', type: 'Bank Fee', kind: 'fee', case: 'bank_fee', note: 'Monthly account fee.' },
  { date: '2026-09-30', amount: -2.4, payee: '', particulars: 'TRANSACTION FEES', type: 'Bank Fee', kind: 'fee', case: 'bank_fee', note: 'Transaction fees for the month.' },
  { date: '2026-09-30', amount: -9000, payee: 'OWNER DISBURSEMENTS', particulars: 'SEP 2026', reference: 'TRUST TFR', type: 'Transfer', kind: 'transfer', case: 'transfer', note: "Monthly transfer of the owners' rent to the disbursements account." },
]

// Missing payments are planted by their absence: Liam O'Brien (NLN11) pays nothing for 21 and 28 September.
const MISSING = { case: 'missing_payments', lease: 'NLN11', weeks: ['2026-09-21', '2026-09-28'] }

// ---- The allocation policy the engine must follow, simulated independently to produce the expected ledger ----
//   1. Money for a tenancy pays its unpaid rent oldest first, for weeks due up to 6 days after the payment date.
//   2. Whatever is left, if it is a whole number of weeks' rent, pays the following weeks in advance.
//   3. Anything else is held as credit on the tenancy.

const round2 = (n: number) => Math.round(n * 100) / 100
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

interface Week {
  dueDate: string
  amount: number
  paid: number
}

function schedule(code: string): Week[] {
  const lease = LEASES.find((l) => l.code === code)!
  const weeks = lease.end ? MONDAYS_AUGUST.filter((d) => d <= lease.end!) : [...MONDAYS_AUGUST, ...MONDAYS_SEPTEMBER]
  return weeks.map((d) => ({ dueDate: d, amount: lease.rent, paid: d < PERIOD.start ? lease.rent : 0 }))
}

function simulate(lines: { row: number; date: string; amount: number; lease: string }[]) {
  const ledger = new Map(LEASES.map((l) => [l.code as string, schedule(l.code)]))
  const perLine = new Map<number, { allocations: { week: string; amount: number }[]; credit: number }>()
  const credits = new Map<string, number>()
  for (const line of [...lines].sort((a, b) => a.date.localeCompare(b.date) || a.row - b.row)) {
    const weeks = ledger.get(line.lease)!
    const rent = LEASES.find((l) => l.code === line.lease)!.rent
    const horizon = addDays(line.date, 6)
    let remaining = line.amount
    const allocations: { week: string; amount: number }[] = []
    const take = (w: Week) => {
      const amount = round2(Math.min(remaining, w.amount - w.paid))
      if (amount <= 0) return
      w.paid = round2(w.paid + amount)
      remaining = round2(remaining - amount)
      allocations.push({ week: w.dueDate, amount })
    }
    for (const w of weeks) if (remaining > 0 && w.dueDate <= horizon) take(w)
    if (remaining > 0 && Number.isInteger(round2(remaining / rent))) {
      for (const w of weeks) if (remaining > 0 && w.dueDate > horizon) take(w)
    }
    perLine.set(line.row, { allocations, credit: remaining })
    if (remaining > 0) credits.set(line.lease, round2((credits.get(line.lease) ?? 0) + remaining))
  }
  const arrears = [...ledger.entries()]
    .map(([code, weeks]) => {
      const owing = weeks.filter((w) => w.dueDate <= PERIOD.end && w.paid < w.amount)
      const lease = LEASES.find((l) => l.code === code)!
      return {
        lease: code,
        tenant: `${lease.firstName} ${lease.lastName}`,
        amount: round2(owing.reduce((s, w) => s + w.amount - w.paid, 0)),
        weeks: owing.map((w) => ({ week: w.dueDate, outstanding: round2(w.amount - w.paid) })),
      }
    })
    .filter((a) => a.amount > 0)
  const weekStatus: Record<string, Record<string, number>> = {}
  for (const [code, weeks] of ledger) {
    weekStatus[code] = Object.fromEntries(weeks.filter((w) => w.dueDate >= PERIOD.start).map((w) => [w.dueDate, round2(w.paid)]))
  }
  return {
    perLine,
    arrears,
    credits: [...credits.entries()].map(([lease, amount]) => {
      const l = LEASES.find((x) => x.code === lease)!
      return { lease, tenant: `${l.firstName} ${l.lastName}`, amount }
    }),
    paidByWeek: weekStatus,
  }
}

// ---- CSV ----

const nzDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const csvField = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)
export const CSV_HEADER = ['Date', 'Amount', 'Payee', 'Particulars', 'Code', 'Reference', 'Transaction Type']

function toCsv(specs: Spec[]): string {
  const rows = specs.map((s) =>
    [nzDate(s.date), s.amount.toFixed(2), s.payee, s.particulars ?? '', s.code ?? '', s.reference ?? '', s.type].map(csvField).join(','),
  )
  return [CSV_HEADER.join(','), ...rows].join('\n') + '\n'
}

// ---- Truth ----

function buildTruth(specs: Spec[]) {
  const rows = specs.map((s, i) => ({ ...s, row: i + 1 }))
  const auto = rows.filter((s) => s.kind === 'rent' && s.lease && !s.hold).map((s) => ({ row: s.row, date: s.date, amount: s.amount, lease: s.lease! }))
  const afterAutomatic = simulate(auto)
  // After review: a person assigns each held line to its real tenancy (when it has one) and the ledger is replayed.
  const resolved = rows
    .filter((s) => s.answer?.lease && s.answer.category === 'rent')
    .map((s) => ({ row: s.row, date: s.date, amount: s.amount, lease: s.answer!.lease! }))
  const afterReview = simulate([...auto, ...resolved])

  // Self-checks: the planted exceptions behave as described.
  const check = (ok: boolean, message: string) => {
    if (!ok) throw new Error(`truth check failed: ${message}`)
  }
  const underpaid = rows.find((s) => s.exception === 'underpaid')!
  check(afterAutomatic.perLine.get(underpaid.row)!.allocations[0].amount === 510, 'underpaid line part-pays one week')
  const overpaid = rows.find((s) => s.exception === 'overpaid')!
  check(afterAutomatic.perLine.get(overpaid.row)!.credit === 50, 'overpaid line leaves $50 credit')
  for (const s of rows.filter((x) => x.case === 'fortnightly_payment')) {
    check(afterAutomatic.perLine.get(s.row)!.allocations.length === 2, 'fortnightly payment covers two weeks')
  }
  check(afterAutomatic.arrears.some((a) => a.lease === MISSING.lease && a.amount === 1080), 'missing weeks show as arrears')

  const lines = rows.map((s) => {
    const sim = afterAutomatic.perLine.get(s.row)
    return {
      row: s.row,
      date: s.date,
      amount: s.amount,
      payee: s.payee,
      particulars: s.particulars ?? '',
      code: s.code ?? '',
      reference: s.reference ?? '',
      transactionType: s.type,
      expected: {
        type: s.kind,
        lease: s.kind === 'rent' || s.kind === 'refund' ? (s.lease ?? null) : null,
        contractor: s.contractor ?? null,
        job: s.job ? jobKey(s.job, JOBS.find(([code, c]) => code === s.job && c === s.contractor)![2]) : null,
        property: s.property ?? null,
        exception: s.exception ?? null,
        autoAllocate: Boolean(sim),
        allocations: sim?.allocations ?? [],
        credit: sim?.credit ?? 0,
      },
      answer: s.answer ?? null,
      case: s.case ?? null,
      noise: s.noise ?? [],
      note: s.note,
    }
  })

  const caseRows = new Map<string, number[]>()
  for (const l of lines) if (l.case) caseRows.set(l.case, [...(caseRows.get(l.case) ?? []), l.row])

  return {
    statement: 'data/bank/2026-09-statement.csv',
    description:
      'Synthetic September 2026 trust account statement for the demo portfolio. Every person, address and business is invented.',
    period: PERIOD,
    format: { columns: CSV_HEADER, dates: 'dd/mm/yyyy', amounts: 'money in positive, money out negative' },
    policy: [
      'Rent is matched by reference, then payer name, then a unique amount with rent due in the date window.',
      'Money for a tenancy pays its unpaid rent oldest first, for weeks due up to 6 days after the payment date.',
      "What is left, if it is a whole number of weeks' rent, pays the following weeks in advance; anything else is credit.",
      'Duplicates, payments to an ended tenancy, unknown payers and ambiguous lines are held for a person, not allocated.',
      'A weekly payment is paid only when fully covered; arrears are rent due on or before the statement end and not covered.',
    ],
    portfolio: {
      openingBalance: 'August 2026 rent paid; September 2026 rent pending (as seeded)',
      leases: LEASES.map((l) => ({
        code: l.code,
        address: l.address,
        suburb: l.suburb,
        tenant: { firstName: l.firstName, lastName: l.lastName },
        weeklyRent: l.rent,
        bondAmount: l.rent * 4,
        rentReference: rentReference(l),
        status: l.end ? 'ended' : 'active',
        startDate: l.start,
        endDate: l.end,
        payments: schedule(l.code).map((w) => ({ dueDate: w.dueDate, amount: w.amount, status: w.paid > 0 ? 'paid' : 'pending' })),
      })),
      vacantProperties: VACANT,
      contractors: CONTRACTORS,
      jobs: JOBS.map(([code, contractor, title, status, quote]) => ({ key: jobKey(code, title), property: code, contractor, title, status, quoteAmount: quote })),
    },
    lines,
    cases: [
      ...[...caseRows.entries()].map(([name, caseLines]) => ({ case: name, rows: caseLines })),
      { case: MISSING.case, rows: [], lease: MISSING.lease, weeks: MISSING.weeks },
    ],
    totals: {
      lines: lines.length,
      moneyIn: round2(lines.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0)),
      moneyOut: round2(lines.filter((l) => l.amount < 0).reduce((s, l) => s + l.amount, 0)),
      exceptions: lines.filter((l) => l.expected.exception).length,
    },
    arrears: { afterAutomatic: afterAutomatic.arrears, afterReview: afterReview.arrears },
    credits: { afterAutomatic: afterAutomatic.credits, afterReview: afterReview.credits },
    rentPaidByWeek: { afterAutomatic: afterAutomatic.paidByWeek, afterReview: afterReview.paidByWeek },
  }
}

export function generate() {
  return { csv: toCsv(SPECS), truth: buildTruth(SPECS) }
}

if (require.main === module) {
  const { csv, truth } = generate()
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(join(OUT_DIR, '2026-09-statement.csv'), csv)
  writeFileSync(join(OUT_DIR, 'truth.json'), JSON.stringify(truth, null, 2) + '\n')
  console.log(
    `Wrote ${truth.totals.lines} lines (${truth.totals.exceptions} planted exceptions) to data/bank/2026-09-statement.csv ` +
      `and the ground truth to data/bank/truth.json`,
  )
}
