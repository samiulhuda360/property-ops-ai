// Renders the synthetic document set: 30 supplier invoices and 10 tenancy summaries, as PDFs in data/documents/,
// plus data/documents/truth.json with every expected field value and the problems planted on purpose.
// Every business, person and address is invented; suppliers, properties and tenancies mirror prisma/seed.ts.
//
//   npx tsx scripts/generate-documents.ts            (from server/)
//
// PW_CHROMIUM can point at another headless Chromium build.
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { formatIrdNumber, irdCheckDigitFor } from '../src/lib/ird'

const OUT_DIR = resolve(__dirname, '../../data/documents')
const CHROMIUM =
  process.env.PW_CHROMIUM ||
  'D:/Portfolio/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe'

// ---------------------------------------------------------------------------------------------------------------
// Reference data (the same values as prisma/seed.ts)

function gst(base: string): string {
  for (let n = Number(base); ; n++) {
    const check = irdCheckDigitFor(String(n))
    if (check !== null) return formatIrdNumber(`${n}${check}`)
  }
}

interface Supplier {
  name: string
  gstNumber: string
  bank: string
  address: string
  phone: string
  email: string
}

const supplier = (name: string, gstBase: string, bank: string, address: string, phone: string): Supplier => ({
  name,
  gstNumber: gst(gstBase),
  bank,
  address,
  phone,
  email: `accounts@${name.toLowerCase().replace(/[^a-z]+/g, '-')}.example.com`,
})

const S = {
  plumbing: supplier('Acme Plumbing', '10234567', '12-3140-0456781-00', '88 Industry Road, Penrose, Auckland 1061', '09 555 0140'),
  electrical: supplier('Acme Electrical', '11345678', '02-0500-0123456-001', 'Unit 4, 12 Volt Place, East Tamaki, Auckland 2013', '09 555 0151'),
  cleaning: supplier('Acme Cleaning Co', '12456789', '06-0193-0654321-00', '210 Great South Road, Greenlane, Auckland 1051', '09 555 0162'),
  gardens: supplier('Acme Gardens', '13567890', '38-9012-0345678-00', '5 Fernleaf Way, Albany, Auckland 0632', '09 555 0173'),
  locksmiths: supplier('Acme Locksmiths', '10987654', '12-3077-0789012-00', '31 Barrow Lane, Newmarket, Auckland 1023', '09 555 0184'),
  roofing: supplier('Acme Roofing', '11876543', '01-0102-0234567-00', '77 Slater Road, Mount Wellington, Auckland 1060', '09 555 0195'),
  pest: supplier('Acme Pest Control', '12765432', '03-0254-0876543-00', '19 Warren Crescent, Rosebank, Auckland 1026', '09 555 0106'),
  insurance: supplier('Acme Insurance', '13654321', '02-0100-0998877-000', 'Level 9, 120 Harbour Quay, Auckland 1010', '0800 555 017'),
  water: supplier('Acme Water', '14543210', '12-3011-0112233-00', 'PO Box 99345, Newmarket, Auckland 1149', '0800 555 028'),
}

const P = {
  MTE14: { street: '14 Kowhai Road', suburb: 'Mount Eden', postcode: '1024' },
  PON7: { street: '7 Vine Street', suburb: 'Ponsonby', postcode: '1011' },
  GLN22: { street: '22 Ash Street', suburb: 'Glen Innes', postcode: '1072' },
  HND5: { street: '5 Rimu Crescent', suburb: 'Henderson', postcode: '0612' },
  TAK9: { street: '9 Totara Avenue', suburb: 'Takapuna', postcode: '0622' },
  ONE3: { street: '3/41 Arthur Street', suburb: 'Onehunga', postcode: '1061' },
  PAP18: { street: '18 Matai Road', suburb: 'Papatoetoe', postcode: '2025' },
  NLN11: { street: '11 Kauri Lane', suburb: 'New Lynn', postcode: '0600' },
  MRB6: { street: '6 Tui Terrace', suburb: 'Mairangi Bay', postcode: '0630' },
  AVD25: { street: '25 Puriri Street', suburb: 'Avondale', postcode: '1026' },
  BLK2: { street: '2/8 Manuka Road', suburb: 'Blockhouse Bay', postcode: '0600' },
  HOW30: { street: '30 Pohutukawa Drive', suburb: 'Howick', postcode: '2014' },
} as const
type PropertyCode = keyof typeof P
const fullAddress = (code: PropertyCode) => `${P[code].street}, ${P[code].suburb}, Auckland ${P[code].postcode}`
const shortAddress = (code: PropertyCode) => `${P[code].street}, ${P[code].suburb}`

const BILL_TO = ['Property Ops Ltd', 'PO Box 5120', 'Auckland 1141']

// ---------------------------------------------------------------------------------------------------------------
// Formatting helpers

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
type DateStyle = 'slash' | 'short' | 'iso' | 'long'

function fmtDate(iso: string, style: DateStyle): string {
  const [y, m, d] = iso.split('-').map(Number)
  switch (style) {
    case 'slash':
      return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
    case 'short':
      return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`
    case 'iso':
      return iso
    case 'long':
      return `${d} ${MONTHS[m - 1]} ${y}`
  }
}

/** Cents to "1,234.56". */
const money = (cents: number) =>
  (cents / 100).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dollars = (cents: number) => `$${money(cents)}`
const cents = (amount: number) => Math.round(amount * 100)
const gstOf = (subtotalCents: number) => Math.round((subtotalCents * 3) / 20)
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ---------------------------------------------------------------------------------------------------------------
// Invoices

interface Line {
  description: string
  quantity: number
  unit: number // cents
  amount: number // cents
}

const line = (quantity: number, description: string, unitDollars: number): Line => ({
  description,
  quantity,
  unit: cents(unitDollars),
  amount: Math.round(quantity * cents(unitDollars)),
})

type InvoiceLayout = 'classic' | 'modern' | 'letter' | 'receipt' | 'utility' | 'insurance'

interface InvoiceSpec {
  file: string
  layout: InvoiceLayout
  supplier: Supplier
  /** The GST number as printed, or null when the invoice leaves it off. */
  gstShown: string | null
  number: string
  date: string
  due: string
  dateStyle: DateStyle
  /** The property address exactly as printed. */
  address: string
  property: PropertyCode | null
  jobTitle?: string
  lines: Line[]
  /** Printed amounts in cents (computed from the lines unless a problem is planted). */
  subtotal?: number
  gst?: number
  total?: number
  extra?: Record<string, string>
  banner?: string
  issues: string[]
  note?: string
}

const invoices: InvoiceSpec[] = [
  {
    file: 'invoice-01-plumbing-mte14.pdf',
    layout: 'classic',
    supplier: S.plumbing,
    gstShown: S.plumbing.gstNumber,
    number: 'AP-2291',
    date: '2026-09-09',
    due: '2026-09-23',
    dateStyle: 'slash',
    address: fullAddress('MTE14'),
    property: 'MTE14',
    jobTitle: 'Hot water cylinder element',
    lines: [
      line(1, 'Call-out and fault diagnosis', 85),
      line(1, 'Hot water cylinder element 3 kW (supply)', 165),
      line(1, 'Cylinder thermostat (supply)', 62),
      line(1.5, 'Labour, replace element and thermostat (hours)', 80),
    ],
    issues: [],
  },
  {
    file: 'invoice-02-plumbing-pon7.pdf',
    layout: 'classic',
    supplier: S.plumbing,
    gstShown: S.plumbing.gstNumber,
    number: 'AP-2296',
    date: '2026-09-08',
    due: '2026-09-22',
    dateStyle: 'short',
    address: '7 Vine St, Ponsonby',
    property: 'PON7',
    jobTitle: 'Leaking kitchen mixer',
    lines: [line(1, 'Kitchen mixer cartridge (supply)', 58), line(1.25, 'Labour, replace cartridge and re-seal (hours)', 80)],
    issues: [],
  },
  {
    file: 'invoice-03-plumbing-pon7.pdf',
    layout: 'classic',
    supplier: S.plumbing,
    gstShown: S.plumbing.gstNumber,
    number: 'AP-2296',
    date: '2026-09-08',
    due: '2026-09-22',
    dateStyle: 'short',
    address: '7 Vine St, Ponsonby',
    property: 'PON7',
    jobTitle: 'Leaking kitchen mixer',
    lines: [line(1, 'Kitchen mixer cartridge (supply)', 58), line(1.25, 'Labour, replace cartridge and re-seal (hours)', 80)],
    banner: 'COPY - PAYMENT REMINDER. This invoice is now overdue.',
    issues: ['duplicate_invoice'],
    note: 'The same invoice sent again as a reminder: same supplier, same invoice number as invoice-02.',
  },
  {
    file: 'invoice-04-plumbing-grey-lynn.pdf',
    layout: 'classic',
    supplier: S.plumbing,
    gstShown: S.plumbing.gstNumber,
    number: 'AP-2302',
    date: '2026-09-16',
    due: '2026-09-30',
    dateStyle: 'iso',
    address: '52 Kahikatea Street, Grey Lynn, Auckland 1021',
    property: null,
    jobTitle: 'Blocked drain',
    lines: [line(1, 'Blocked drain clearing, high-pressure jet', 195), line(1, 'CCTV drain inspection', 120)],
    issues: ['property_unknown'],
    note: 'The job address is not a property in the portfolio.',
  },
  {
    file: 'invoice-05-electrical-gln22.pdf',
    layout: 'modern',
    supplier: S.electrical,
    gstShown: S.electrical.gstNumber,
    number: 'E-10418',
    date: '2026-09-03',
    due: '2026-09-17',
    dateStyle: 'short',
    address: fullAddress('GLN22'),
    property: 'GLN22',
    jobTitle: 'Smoke alarms to standard',
    lines: [line(3, '10-year photoelectric smoke alarm (supply and fit)', 54), line(2, 'Labour (hours)', 72)],
    issues: [],
  },
  {
    file: 'invoice-06-electrical-one3.pdf',
    layout: 'modern',
    supplier: S.electrical,
    gstShown: S.electrical.gstNumber,
    number: 'E-10433',
    date: '2026-09-24',
    due: '2026-10-08',
    dateStyle: 'slash',
    address: 'Flat 3, 41 Arthur Street, Onehunga',
    property: 'ONE3',
    jobTitle: 'Bathroom extractor fan',
    lines: [
      line(1, 'Bathroom extractor fan 150 mm with backdraft shutter', 129),
      line(1, 'Ducting, vent cap and fittings', 38.5),
      line(1.5, 'Labour (hours)', 72),
    ],
    issues: [],
  },
  {
    file: 'invoice-07-electrical-mrb6.pdf',
    layout: 'modern',
    supplier: S.electrical,
    gstShown: S.electrical.gstNumber,
    number: 'E-10427',
    date: '2026-09-18',
    due: '2026-10-02',
    dateStyle: 'iso',
    address: fullAddress('MRB6'),
    property: 'MRB6',
    jobTitle: 'Heat pump service',
    lines: [line(1, 'Heat pump annual service, indoor and outdoor units', 160), line(1, 'Filter clean and sanitise', 36)],
    gst: 2450,
    total: 22050,
    issues: ['gst_not_3_23'],
    note: 'GST charged at 12.5% instead of 15%: $24.50 is not 3/23 of the $220.50 total.',
  },
  {
    file: 'invoice-08-cleaning-nln11.pdf',
    layout: 'letter',
    supplier: S.cleaning,
    gstShown: S.cleaning.gstNumber,
    number: 'CC-3381',
    date: '2026-09-21',
    due: '2026-10-05',
    dateStyle: 'long',
    address: shortAddress('NLN11'),
    property: 'NLN11',
    jobTitle: 'Mould treatment, bedroom 2',
    lines: [
      line(1, 'Mould treatment and anti-fungal wash, bedroom 2 ceiling and walls', 280),
      line(1, 'Stain-block and repaint affected ceiling corner', 180),
    ],
    extra: { completed: '19 September 2026' },
    issues: ['over_quote'],
    note: 'Total $529.00 is 26% above the $420 quote.',
  },
  {
    file: 'invoice-09-cleaning-how30.pdf',
    layout: 'letter',
    supplier: S.cleaning,
    gstShown: S.cleaning.gstNumber,
    number: 'CC-3364',
    date: '2026-09-05',
    due: '2026-09-19',
    dateStyle: 'long',
    address: shortAddress('HOW30'),
    property: 'HOW30',
    jobTitle: 'End of tenancy clean',
    lines: [line(1, 'End-of-tenancy clean, four-bedroom house', 320), line(1, 'Carpet steam clean, four rooms', 120)],
    subtotal: 45000,
    gst: 6750,
    total: 51750,
    extra: { completed: '4 September 2026' },
    issues: ['line_items_dont_add'],
    note: 'The two charges add up to $440.00 but the subtotal says $450.00.',
  },
  {
    file: 'invoice-10-gardens-pap18.pdf',
    layout: 'receipt',
    supplier: S.gardens,
    gstShown: S.gardens.gstNumber,
    number: 'G-5521',
    date: '2026-09-15',
    due: '2026-09-29',
    dateStyle: 'slash',
    address: '18 Matai Rd, Papatoetoe',
    property: 'PAP18',
    jobTitle: 'Lawn and hedge tidy',
    lines: [line(1, 'Lawn mow and edges', 65), line(1, 'Hedge trim, front boundary', 70), line(1, 'Green waste removal', 21)],
    issues: [],
  },
  {
    file: 'invoice-11-locksmiths-tak9.pdf',
    layout: 'receipt',
    supplier: S.locksmiths,
    gstShown: S.locksmiths.gstNumber,
    number: 'L-0877',
    date: '2026-09-11',
    due: '2026-09-25',
    dateStyle: 'iso',
    address: '9 Totara Ave, Takapuna',
    property: 'TAK9',
    jobTitle: 'Front door lock',
    lines: [line(1, 'Replace front door lock cylinder', 145), line(3, 'Re-key, cut keys', 12), line(1, 'Call-out', 75)],
    issues: [],
  },
  {
    file: 'invoice-12-roofing-hnd5.pdf',
    layout: 'letter',
    supplier: S.roofing,
    gstShown: S.roofing.gstNumber,
    number: 'R-2045',
    date: '2026-09-19',
    due: '2026-10-03',
    dateStyle: 'long',
    address: shortAddress('HND5'),
    property: 'HND5',
    jobTitle: 'Gutter clean and downpipe',
    lines: [
      line(1, 'Gutter clean, full perimeter', 340),
      line(1, 'Replace downpipe bracket and re-seal joint', 95),
      line(1, 'Edge protection hire, one day', 95),
    ],
    extra: { completed: '17 September 2026' },
    issues: ['over_quote'],
    note: 'Total $609.50 is 12.9% above the $540 quote.',
  },
  {
    file: 'invoice-13-pest-avd25.pdf',
    layout: 'classic',
    supplier: S.pest,
    gstShown: null,
    number: 'PC-7712',
    date: '2026-09-22',
    due: '2026-10-06',
    dateStyle: 'slash',
    address: fullAddress('AVD25'),
    property: 'AVD25',
    jobTitle: 'Rodent treatment',
    lines: [line(1, 'Rodent baiting programme, ceiling space (3 stations)', 165), line(1, 'Entry point proofing', 55)],
    issues: ['gst_number_missing'],
    note: 'The invoice has no GST number.',
  },
]

// Acme Water: quarterly bills (1 June to 31 August 2026, 92 days). Water usage in kL; wastewater is 80% of water.
const WATER: [PropertyCode, number, string, string, number, DateStyle][] = [
  ['MTE14', 24, 'W-883101', '2026-09-07', 401122901, 'short'],
  ['PON7', 18, 'W-883102', '2026-09-07', 401122902, 'short'],
  ['GLN22', 31, 'W-883117', '2026-09-08', 401122917, 'short'],
  ['HND5', 38, 'W-883125', '2026-09-14', 401122925, 'slash'],
  ['TAK9', 27, 'W-883131', '2026-09-08', 401122931, 'slash'],
  ['ONE3', 12, 'W-883140', '2026-09-09', 401122940, 'long'],
  ['PAP18', 33, 'W-883152', '2026-09-09', 401122952, 'long'],
  ['NLN11', 15, 'W-883160', '2026-09-10', 401122960, 'iso'],
  ['BLK2', 0, 'W-883171', '2026-09-10', 401122971, 'iso'],
]

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

WATER.forEach(([code, kl, number, date, account, dateStyle], i) => {
  const lines = [line(92, 'Water supply fixed charge, 92 days @ $0.25 per day', 0.25)]
  if (kl > 0) lines.push(line(kl, `Water usage, ${kl} kL @ $2.10 per kL`, 2.1))
  lines.push(line(92, 'Wastewater fixed charge, 92 days @ $1.10 per day', 1.1))
  const ww = Math.round(kl * 8) / 10
  if (kl > 0) lines.push(line(ww, `Wastewater usage, ${ww} kL @ $3.00 per kL`, 3))
  const spec: InvoiceSpec = {
    file: `water-${String(i + 1).padStart(2, '0')}-${code.toLowerCase()}.pdf`,
    layout: 'utility',
    supplier: S.water,
    gstShown: S.water.gstNumber,
    number,
    date,
    due: addDays(date, 20),
    dateStyle,
    address: fullAddress(code),
    property: code,
    lines,
    extra: { account: String(account).replace(/^(\d{4})(\d{4})(\d)$/, '$1-$2-$3'), usage: String(kl) },
    issues: [],
  }
  if (code === 'GLN22') {
    // Planted: the GST line is a dollar short, and the total follows it.
    const subtotal = lines.reduce((s, l) => s + l.amount, 0)
    spec.gst = gstOf(subtotal) - 100
    spec.total = subtotal + spec.gst
    spec.issues = ['gst_not_3_23']
    spec.note = 'GST printed a dollar short of 15%, so it is not 3/23 of the total.'
  }
  if (code === 'HND5') {
    spec.due = '2026-09-04'
    spec.issues = ['due_before_invoice']
    spec.note = 'Due date 04/09/2026 is before the bill date 14/09/2026.'
  }
  invoices.push(spec)
})

// Acme Insurance: landlord policy renewals for October 2026.
const INSURANCE: [PropertyCode, number, string, string, string, number, DateStyle][] = [
  ['TAK9', 1420, 'INS-77120', 'LP-204411', '2026-09-01', 780000, 'long'],
  ['MRB6', 1560, 'INS-77134', 'LP-204418', '2026-09-03', 860000, 'long'],
  ['HOW30', 1390, 'INS-77152', 'LP-204436', '2026-09-07', 820000, 'slash'],
  ['AVD25', 1180, 'INS-77167', 'LP-204451', '2026-09-10', 640000, 'slash'],
  ['PON7', 1050, 'INS-77181', 'LP-204463', '2026-09-14', 590000, 'short'],
  ['HND5', 1310, 'INS-77196', 'LP-204470', '2026-09-17', 760000, 'short'],
  ['MTE14', 1240, 'INS-77210', 'LP-204488', '2026-09-21', 720000, 'iso'],
  ['GLN22', 1120, 'INS-77225', 'LP-204492', '2026-09-24', 610000, 'iso'],
]

INSURANCE.forEach(([code, premium, number, policy, date, sumInsured, dateStyle], i) => {
  const renewal = '2026-10-01'
  const spec: InvoiceSpec = {
    file: `insurance-${String(i + 1).padStart(2, '0')}-${code.toLowerCase()}.pdf`,
    layout: 'insurance',
    supplier: S.insurance,
    gstShown: S.insurance.gstNumber,
    number,
    date,
    due: renewal,
    dateStyle,
    address: fullAddress(code),
    property: code,
    lines: [line(1, 'Landlord insurance premium', premium), line(1, 'Natural hazards levy', 300), line(1, 'Fire levy', 106)],
    extra: { policy, sumInsured: money(sumInsured * 100).replace(/\.00$/, ''), renewal, renewalEnd: '2027-10-01' },
    issues: [],
  }
  if (code === 'AVD25') {
    spec.gstShown = '136-543-211'
    spec.issues = ['gst_number_invalid']
    spec.note = 'GST number 136-543-211 fails the check digit (the insurer is registered as 136-543-210).'
  }
  invoices.push(spec)
})

// ---------------------------------------------------------------------------------------------------------------
// Invoice templates

interface Printed {
  subtotal: number
  gst: number
  total: number
}

function printed(spec: InvoiceSpec): Printed {
  const sum = spec.lines.reduce((s, l) => s + l.amount, 0)
  const subtotal = spec.subtotal ?? sum
  const gstAmount = spec.gst ?? gstOf(subtotal)
  return { subtotal, gst: gstAmount, total: spec.total ?? subtotal + gstAmount }
}

const qty = (n: number) => (Number.isInteger(n) ? String(n) : String(n))

const page = (css: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; color: #1f2937; font-size: 12px; }
  table { border-collapse: collapse; }
  ${css}
  </style></head><body>${body}</body></html>`

function classic(spec: InvoiceSpec): string {
  const p = printed(spec)
  const d = (iso: string) => fmtDate(iso, spec.dateStyle)
  return page(
    `body { font-family: Arial, Helvetica, sans-serif; padding: 40px 48px; }
    .top { display: flex; justify-content: space-between; border-bottom: 3px solid #1e3a5f; padding-bottom: 14px; }
    h1 { margin: 0; font-size: 24px; color: #1e3a5f; }
    .muted { color: #6b7280; line-height: 1.5; }
    .title { font-size: 22px; font-weight: bold; letter-spacing: 2px; color: #1e3a5f; text-align: right; }
    .meta td { padding: 2px 0 2px 16px; }
    .meta td:first-child { color: #6b7280; padding-left: 0; }
    .row { display: flex; gap: 40px; margin: 22px 0; }
    .row div { flex: 1; line-height: 1.6; }
    .lines { width: 100%; margin-top: 8px; }
    .lines th { background: #1e3a5f; color: white; text-align: left; padding: 7px 8px; }
    .lines td { padding: 7px 8px; border-bottom: 1px solid #e5e7eb; }
    .num { text-align: right; }
    .totals { margin: 14px 0 0 auto; min-width: 240px; }
    .totals td { padding: 4px 8px; }
    .totals tr:last-child td { font-weight: bold; font-size: 14px; border-top: 2px solid #1e3a5f; }
    .banner { border: 2px solid #b91c1c; color: #b91c1c; padding: 8px 12px; font-weight: bold; margin-top: 16px; }
    .foot { margin-top: 36px; border-top: 1px solid #e5e7eb; padding-top: 12px; line-height: 1.6; }`,
    `<div class="top">
      <div><h1>${esc(spec.supplier.name)}</h1>
        <div class="muted">${esc(spec.supplier.address)}<br>Phone ${spec.supplier.phone} &middot; ${spec.supplier.email}</div></div>
      <div><div class="title">TAX INVOICE</div>
        <table class="meta">
          <tr><td>Invoice #</td><td>${spec.number}</td></tr>
          <tr><td>Date</td><td>${d(spec.date)}</td></tr>
          <tr><td>Due date</td><td>${d(spec.due)}</td></tr>
          ${spec.gstShown ? `<tr><td>GST No.</td><td>${spec.gstShown}</td></tr>` : ''}
        </table></div>
    </div>
    ${spec.banner ? `<div class="banner">${esc(spec.banner)}</div>` : ''}
    <div class="row">
      <div><b>Bill to</b><br>${BILL_TO.join('<br>')}</div>
      <div><b>Job address</b><br>${esc(spec.address)}<br><b>Job</b> ${esc(spec.jobTitle ?? '')}</div>
    </div>
    <table class="lines">
      <tr><th style="width:60px">Qty</th><th>Description</th><th class="num">Unit price</th><th class="num">Amount</th></tr>
      ${spec.lines
        .map(
          (l) =>
            `<tr><td>${qty(l.quantity)}</td><td>${esc(l.description)}</td><td class="num">${money(l.unit)}</td><td class="num">${money(l.amount)}</td></tr>`,
        )
        .join('')}
    </table>
    <table class="totals">
      <tr><td>Subtotal</td><td class="num">${money(p.subtotal)}</td></tr>
      <tr><td>GST 15%</td><td class="num">${money(p.gst)}</td></tr>
      <tr><td>Total NZD</td><td class="num">${dollars(p.total)}</td></tr>
    </table>
    <div class="foot"><b>Payment</b><br>Please pay by direct credit to ${spec.supplier.bank}, using reference ${spec.number}.<br>
      Thank you for your business.</div>`,
  )
}

function modern(spec: InvoiceSpec): string {
  const p = printed(spec)
  const d = (iso: string) => fmtDate(iso, spec.dateStyle)
  return page(
    `body { font-family: 'Segoe UI', Arial, sans-serif; }
    .wrap { display: flex; min-height: 1080px; }
    .side { width: 230px; background: #0f3d3e; color: #e6f2f2; padding: 36px 24px; line-height: 1.6; }
    .side h2 { font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: #8cc7c4; margin: 22px 0 4px; }
    .brand { font-size: 20px; font-weight: 700; color: white; }
    .main { flex: 1; padding: 36px 36px; }
    .main h1 { font-size: 30px; margin: 0 0 18px; color: #0f3d3e; font-weight: 300; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 24px; margin-bottom: 24px; }
    .grid .k { font-size: 10px; text-transform: uppercase; color: #6b7280; letter-spacing: 1px; }
    .grid .v { font-size: 13px; font-weight: 600; }
    .lines { width: 100%; }
    .lines th { text-align: left; font-size: 10px; text-transform: uppercase; color: #6b7280; border-bottom: 2px solid #0f3d3e; padding: 6px 4px; }
    .lines td { padding: 8px 4px; border-bottom: 1px solid #e5e7eb; }
    .num { text-align: right; }
    .totals { margin: 16px 0 0 auto; }
    .totals td { padding: 4px 4px 4px 24px; }
    .due { background: #e6f2f2; font-weight: 700; font-size: 15px; }`,
    `<div class="wrap">
      <div class="side">
        <div class="brand">${esc(spec.supplier.name)}</div>
        <div>Registered electrical contractors</div>
        <h2>From</h2><div>${esc(spec.supplier.address)}<br>${spec.supplier.phone}<br>${spec.supplier.email}</div>
        <h2>Bill to</h2><div>${BILL_TO.join('<br>')}</div>
        <h2>Site</h2><div>${esc(spec.address)}</div>
        <h2>Payment details</h2><div>Account ${spec.supplier.bank}<br>Reference ${spec.number}</div>
      </div>
      <div class="main">
        <h1>Tax Invoice</h1>
        <div class="grid">
          <div><div class="k">Tax Invoice Number</div><div class="v">${spec.number}</div></div>
          <div><div class="k">GST registration</div><div class="v">${spec.gstShown ?? ''}</div></div>
          <div><div class="k">Issue date</div><div class="v">${d(spec.date)}</div></div>
          <div><div class="k">Payment due</div><div class="v">${d(spec.due)}</div></div>
          <div><div class="k">Job</div><div class="v">${esc(spec.jobTitle ?? '')}</div></div>
        </div>
        <table class="lines">
          <tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr>
          ${spec.lines
            .map(
              (l) =>
                `<tr><td>${esc(l.description)}</td><td class="num">${qty(l.quantity)}</td><td class="num">${money(l.unit)}</td><td class="num">${money(l.amount)}</td></tr>`,
            )
            .join('')}
        </table>
        <table class="totals">
          <tr><td>Subtotal (excl. GST)</td><td class="num">${money(p.subtotal)}</td></tr>
          <tr><td>GST</td><td class="num">${money(p.gst)}</td></tr>
          <tr class="due"><td>Amount due</td><td class="num">${dollars(p.total)}</td></tr>
        </table>
      </div>
    </div>`,
  )
}

function letter(spec: InvoiceSpec): string {
  const p = printed(spec)
  const d = (iso: string) => fmtDate(iso, spec.dateStyle)
  const signatory = spec.supplier === S.roofing ? 'Hemi Walker' : 'Mereana Smith'
  return page(
    `body { font-family: Georgia, 'Times New Roman', serif; padding: 56px 72px; font-size: 13px; line-height: 1.6; }
    .head { text-align: center; border-bottom: 1px solid #9ca3af; padding-bottom: 10px; margin-bottom: 28px; }
    .head .name { font-size: 22px; letter-spacing: 1px; }
    .head .small { font-size: 11px; color: #4b5563; }
    .re { font-weight: bold; margin: 18px 0; }
    .charges { width: 100%; margin: 10px 0 6px; }
    .charges td { padding: 3px 0; }
    .charges td:last-child { text-align: right; width: 120px; }
    .sum { margin-left: auto; width: 300px; }
    .sum td:last-child { text-align: right; }`,
    `<div class="head"><div class="name">${esc(spec.supplier.name)}</div>
      <div class="small">${esc(spec.supplier.address)} &middot; ${spec.supplier.phone} &middot; GST ${spec.gstShown ?? ''}</div></div>
    <p>${d(spec.date)}</p>
    <p>${BILL_TO.join('<br>')}</p>
    <p class="re">Re: ${esc(spec.jobTitle ?? '')} &ndash; ${esc(spec.address)}</p>
    <p>Dear Property Manager,</p>
    <p>Thank you for the work order. We completed the work at the above address on ${spec.extra?.completed ?? ''}.
      Please find our tax invoice below.</p>
    <p>Invoice number: ${spec.number}</p>
    <table class="charges">
      ${spec.lines.map((l) => `<tr><td>${esc(l.description)}</td><td>${dollars(l.amount)}</td></tr>`).join('')}
    </table>
    <table class="sum">
      <tr><td>Subtotal</td><td>${dollars(p.subtotal)}</td></tr>
      <tr><td>GST (15%)</td><td>${dollars(p.gst)}</td></tr>
      <tr><td><b>Total including GST</b></td><td><b>${dollars(p.total)}</b></td></tr>
    </table>
    <p>Please pay by ${d(spec.due)} to account ${spec.supplier.bank}, quoting the invoice number.</p>
    <p>Kind regards,</p>
    <p>${signatory}<br>Accounts, ${esc(spec.supplier.name)}</p>`,
  )
}

function receipt(spec: InvoiceSpec): string {
  const p = printed(spec)
  const d = (iso: string) => fmtDate(iso, spec.dateStyle)
  return page(
    `body { font-family: 'Courier New', Courier, monospace; font-size: 11px; padding: 14px 12px; }
    .c { text-align: center; }
    hr { border: 0; border-top: 1px dashed #374151; margin: 8px 0; }
    .r { display: flex; justify-content: space-between; gap: 8px; }
    .b { font-weight: bold; }`,
    `<div class="c b" style="font-size:14px">${esc(spec.supplier.name.toUpperCase())}</div>
    <div class="c">${esc(spec.supplier.address)}</div>
    <div class="c">Ph ${spec.supplier.phone}</div>
    ${spec.gstShown ? `<div class="c">GST No: ${spec.gstShown}</div>` : ''}
    <hr><div class="c b">TAX INVOICE</div>
    <div>Inv No. ${spec.number}</div>
    <div>Date ${d(spec.date)}</div>
    <div>Due ${d(spec.due)}</div>
    <div>Site: ${esc(spec.address)}</div>
    <div>Customer: ${BILL_TO[0]}</div>
    <hr>
    ${spec.lines
      .map((l) => `<div class="r"><span>${qty(l.quantity)} x ${esc(l.description)}</span><span>${money(l.amount)}</span></div>`)
      .join('')}
    <hr>
    <div class="r"><span>SUBTOTAL</span><span>${money(p.subtotal)}</span></div>
    <div class="r"><span>GST 15%</span><span>${money(p.gst)}</span></div>
    <div class="r b"><span>TOTAL</span><span>${money(p.total)}</span></div>
    <hr>
    <div>Bank: ${spec.supplier.bank}</div>
    <div class="c">Thank you!</div>`,
  )
}

function utility(spec: InvoiceSpec): string {
  const p = printed(spec)
  const d = (iso: string) => fmtDate(iso, spec.dateStyle)
  const usage = Number(spec.extra?.usage ?? 0)
  const prevRead = 1180 + (Number(spec.number.slice(-2)) * 7) % 300
  return page(
    `body { font-family: Verdana, Arial, sans-serif; font-size: 11px; }
    .band { background: #0369a1; color: white; padding: 18px 36px; display: flex; justify-content: space-between; align-items: center; }
    .band .n { font-size: 22px; font-weight: bold; }
    .content { padding: 22px 36px; }
    .boxes { display: flex; gap: 12px; margin-bottom: 16px; }
    .box { flex: 1; border: 1px solid #bae6fd; background: #f0f9ff; padding: 10px; }
    .box .k { color: #075985; font-size: 10px; }
    .box .v { font-size: 13px; font-weight: bold; }
    .section { margin-top: 16px; }
    .section h3 { font-size: 12px; color: #075985; border-bottom: 1px solid #bae6fd; padding-bottom: 4px; margin: 0 0 6px; }
    table.t { width: 100%; }
    table.t td { padding: 4px 2px; }
    .num { text-align: right; }
    .big { font-size: 15px; font-weight: bold; background: #e0f2fe; }`,
    `<div class="band"><div><div class="n">${esc(spec.supplier.name)}</div><div>Your water bill &middot; Tax invoice</div></div>
      <div>GST No. ${spec.gstShown ?? ''}<br>${spec.supplier.phone}</div></div>
    <div class="content">
      <div class="boxes">
        <div class="box"><div class="k">Account number</div><div class="v">${spec.extra?.account}</div></div>
        <div class="box"><div class="k">Bill number</div><div class="v">${spec.number}</div></div>
        <div class="box"><div class="k">Bill date</div><div class="v">${d(spec.date)}</div></div>
        <div class="box"><div class="k">Due date</div><div class="v">${d(spec.due)}</div></div>
      </div>
      <div>Supply address: ${esc(spec.address)}</div>
      <div>Account holder: ${BILL_TO.join(', ')}</div>
      <div>Billing period: ${d('2026-06-01')} to ${d('2026-08-31')} (92 days)</div>
      <div class="section"><h3>Meter readings</h3>
        Previous reading ${prevRead} kL on ${d('2026-05-31')}; current reading ${prevRead + usage} kL on ${d('2026-08-31')}; usage ${usage} kL.</div>
      <div class="section"><h3>Account summary</h3>
        <table class="t"><tr><td>Previous balance</td><td class="num">251.20</td></tr>
        <tr><td>Payment received ${d('2026-06-12')}, thank you</td><td class="num">-251.20</td></tr>
        <tr><td>Balance brought forward</td><td class="num">0.00</td></tr></table></div>
      <div class="section"><h3>Charges this period (excl. GST)</h3>
        <table class="t">
          ${spec.lines.map((l) => `<tr><td>${esc(l.description)}</td><td class="num">${money(l.amount)}</td></tr>`).join('')}
          <tr><td>Total charges excl. GST</td><td class="num">${money(p.subtotal)}</td></tr>
          <tr><td>GST</td><td class="num">${money(p.gst)}</td></tr>
          <tr class="big"><td>Total amount due</td><td class="num">${dollars(p.total)}</td></tr>
        </table></div>
      <div class="section"><h3>How to pay</h3>
        Internet banking to ${spec.supplier.bank}, reference ${spec.extra?.account}. Payments received after the due date may incur a late fee.</div>
    </div>`,
  )
}

function insurance(spec: InvoiceSpec): string {
  const p = printed(spec)
  const d = (iso: string) => fmtDate(iso, spec.dateStyle)
  return page(
    `body { font-family: Tahoma, Arial, sans-serif; padding: 36px 44px; font-size: 12px; }
    .logo { font-size: 24px; font-weight: bold; color: #14532d; }
    .tag { color: #4b5563; margin-bottom: 18px; }
    h1 { font-size: 17px; background: #14532d; color: white; padding: 8px 12px; margin: 0 0 14px; }
    .kv { width: 100%; margin-bottom: 14px; }
    .kv td { padding: 4px 6px; border-bottom: 1px solid #e5e7eb; }
    .kv td:first-child { width: 180px; color: #4b5563; }
    .prem { width: 60%; margin-left: auto; }
    .prem td { padding: 4px 6px; }
    .num { text-align: right; }
    .tot { font-weight: bold; font-size: 14px; border-top: 2px solid #14532d; }
    .note { margin-top: 18px; padding: 10px; background: #f0fdf4; border-left: 4px solid #14532d; line-height: 1.6; }`,
    `<div class="logo">${esc(spec.supplier.name)}</div>
    <div class="tag">${esc(spec.supplier.address)} &middot; ${spec.supplier.phone}</div>
    <h1>Landlord policy renewal notice and tax invoice</h1>
    <table class="kv">
      <tr><td>Tax invoice no.</td><td>${spec.number}</td></tr>
      <tr><td>Date of notice</td><td>${d(spec.date)}</td></tr>
      <tr><td>GST No.</td><td>${spec.gstShown ?? ''}</td></tr>
      <tr><td>Policyholder</td><td>${BILL_TO[0]}, as agent for the owner</td></tr>
      <tr><td>Policy number</td><td>${spec.extra?.policy}</td></tr>
      <tr><td>Insured property</td><td>${esc(spec.address)}</td></tr>
      <tr><td>Period of cover</td><td>${d(spec.extra!.renewal)} to ${d(spec.extra!.renewalEnd)}</td></tr>
      <tr><td>Sum insured</td><td>$${spec.extra?.sumInsured} &middot; Excess $500</td></tr>
    </table>
    <table class="prem">
      ${spec.lines.map((l) => `<tr><td>${esc(l.description)}</td><td class="num">${money(l.amount)}</td></tr>`).join('')}
      <tr><td>Total excl. GST</td><td class="num">${money(p.subtotal)}</td></tr>
      <tr><td>GST</td><td class="num">${money(p.gst)}</td></tr>
      <tr class="tot"><td>Total payable</td><td class="num">${dollars(p.total)}</td></tr>
    </table>
    <p>Payment due by: ${d(spec.due)}</p>
    <div class="note">To renew, pay by direct credit to ${spec.supplier.bank} using your policy number as the reference.
      If you do not pay by the due date your cover ends on ${d(spec.extra!.renewal)}.</div>`,
  )
}

const INVOICE_TEMPLATES: Record<InvoiceLayout, (spec: InvoiceSpec) => string> = {
  classic,
  modern,
  letter,
  receipt,
  utility,
  insurance,
}

// ---------------------------------------------------------------------------------------------------------------
// Tenancy summaries

type LeaseLayout = 'agency' | 'cards'

interface LeaseSpec {
  file: string
  layout: LeaseLayout
  property: PropertyCode
  tenants: string[]
  start: string
  end: string | null // null = periodic
  weeklyRent: number // dollars
  bond: number // dollars
  frequency: 'weekly' | 'fortnightly'
  /** How the rent is printed: per week, or per fortnight. */
  rentBasis: 'week' | 'fortnight'
  pets: boolean
  petNote: string
  maxOccupants: number
  prepared: string
  dateStyle: DateStyle
  issues: string[]
  note?: string
}

const leases: LeaseSpec[] = [
  {
    file: 'lease-01-mte14.pdf', layout: 'agency', property: 'MTE14', tenants: ['Aroha Ngata'], start: '2025-02-10', end: null,
    weeklyRent: 720, bond: 2880, frequency: 'weekly', rentBasis: 'week', pets: false, petNote: 'Not permitted', maxOccupants: 4,
    prepared: '2026-09-12', dateStyle: 'slash', issues: [],
  },
  {
    file: 'lease-02-pon7.pdf', layout: 'agency', property: 'PON7', tenants: ['Daniel Kim'], start: '2024-11-04', end: null,
    weeklyRent: 680, bond: 2600, frequency: 'weekly', rentBasis: 'week', pets: true, petNote: 'Permitted (one cat)', maxOccupants: 3,
    prepared: '2026-09-12', dateStyle: 'long', issues: ['rent_differs'],
    note: 'Rent $680 per week; the lease record says $650.',
  },
  {
    file: 'lease-03-gln22.pdf', layout: 'cards', property: 'GLN22', tenants: ['Mele Fifita'], start: '2025-06-02', end: null,
    weeklyRent: 610, bond: 2640, frequency: 'fortnightly', rentBasis: 'fortnight', pets: false, petNote: 'No', maxOccupants: 5,
    prepared: '2026-09-15', dateStyle: 'short', issues: ['bond_differs', 'bond_over_four_weeks'],
    note: 'Bond $2,640; the lease record says $2,440, and $2,640 is more than four weeks of $610 rent.',
  },
  {
    file: 'lease-04-hnd5.pdf', layout: 'cards', property: 'HND5', tenants: ['Rajesh Patel', 'Priya Patel'], start: '2023-09-18', end: null,
    weeklyRent: 680, bond: 2720, frequency: 'fortnightly', rentBasis: 'fortnight', pets: true, petNote: 'Yes, one dog', maxOccupants: 6,
    prepared: '2026-09-15', dateStyle: 'iso', issues: [],
  },
  {
    file: 'lease-05-tak9.pdf', layout: 'agency', property: 'TAK9', tenants: ['Sophie Clarke'], start: '2025-01-13', end: null,
    weeklyRent: 780, bond: 3120, frequency: 'weekly', rentBasis: 'week', pets: false, petNote: 'Not permitted', maxOccupants: 5,
    prepared: '2026-09-16', dateStyle: 'short', issues: [],
  },
  {
    file: 'lease-06-one3.pdf', layout: 'cards', property: 'ONE3', tenants: ['Tom Wright'], start: '2026-03-02', end: '2027-03-01',
    weeklyRent: 560, bond: 2240, frequency: 'weekly', rentBasis: 'week', pets: false, petNote: 'No', maxOccupants: 2,
    prepared: '2026-09-16', dateStyle: 'long', issues: [],
  },
  {
    file: 'lease-07-pap18.pdf', layout: 'agency', property: 'PAP18', tenants: ['Ana Tupou', 'Sione Tupou'], start: '2024-07-22', end: null,
    weeklyRent: 590, bond: 2360, frequency: 'weekly', rentBasis: 'week', pets: true, petNote: 'Permitted (one dog, outdoors)', maxOccupants: 6,
    prepared: '2026-09-17', dateStyle: 'iso', issues: [],
  },
  {
    file: 'lease-08-nln11.pdf', layout: 'cards', property: 'NLN11', tenants: ["Liam O'Brien"], start: '2025-10-06', end: '2026-10-05',
    weeklyRent: 540, bond: 2160, frequency: 'fortnightly', rentBasis: 'fortnight', pets: false, petNote: 'No', maxOccupants: 2,
    prepared: '2026-09-17', dateStyle: 'slash', issues: [],
  },
  {
    file: 'lease-09-mrb6.pdf', layout: 'agency', property: 'MRB6', tenants: ['Hannah Lee'], start: '2024-04-15', end: null,
    weeklyRent: 850, bond: 3400, frequency: 'fortnightly', rentBasis: 'week', pets: true, petNote: 'Permitted (two cats)', maxOccupants: 6,
    prepared: '2026-09-18', dateStyle: 'slash', issues: [],
  },
  {
    file: 'lease-10-how30.pdf', layout: 'cards', property: 'HOW30', tenants: ['Grace Chen'], start: '2023-05-01', end: '2026-08-31',
    weeklyRent: 760, bond: 3040, frequency: 'weekly', rentBasis: 'week', pets: false, petNote: 'No', maxOccupants: 6,
    prepared: '2026-09-18', dateStyle: 'short', issues: [],
  },
]

const tenantList = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0])

function agency(spec: LeaseSpec): string {
  const d = (iso: string) => fmtDate(iso, spec.dateStyle)
  const rentText =
    spec.rentBasis === 'week' ? `${dollars(spec.weeklyRent * 100)} per week` : `${dollars(spec.weeklyRent * 200)} per fortnight`
  const rows: [string, string][] = [
    ['Property', fullAddress(spec.property)],
    ['Tenant(s)', tenantList(spec.tenants)],
    ['Landlord', `c/- ${BILL_TO[0]} (agent)`],
    ['Tenancy type', spec.end ? 'Fixed term' : 'Periodic'],
    ['Start date', d(spec.start)],
    ['End date', spec.end ? d(spec.end) : 'Periodic (no end date)'],
    ['Rent', rentText],
    ['Rent paid', `${spec.frequency === 'weekly' ? 'Weekly' : 'Fortnightly'} in advance, by automatic payment`],
    ['Bond', dollars(spec.bond * 100)],
    ['Pets', spec.petNote],
    ['Maximum occupants', String(spec.maxOccupants)],
    ['Smoke alarms', 'Working alarms in each bedroom and hallway (checked at the start of the tenancy)'],
    ['Insulation statement', 'Ceiling and underfloor insulation statement attached to the agreement'],
  ]
  return page(
    `body { font-family: Arial, Helvetica, sans-serif; padding: 40px 50px; }
    .co { color: #1e40af; font-weight: bold; font-size: 15px; }
    h1 { font-size: 22px; margin: 6px 0 2px; letter-spacing: 1px; }
    .sub { color: #6b7280; margin-bottom: 18px; }
    table { width: 100%; }
    td { padding: 7px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
    td:first-child { width: 190px; font-weight: bold; color: #374151; background: #f9fafb; }
    .foot { margin-top: 24px; color: #6b7280; font-size: 10px; }`,
    `<div class="co">${BILL_TO[0]} &middot; Property management</div>
    <h1>TENANCY SUMMARY</h1>
    <div class="sub">Prepared ${d(spec.prepared)} &middot; Reference TS-${spec.property}</div>
    <table>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${esc(v)}</td></tr>`).join('')}</table>
    <div class="foot">This summary is for reference. The signed residential tenancy agreement is the binding document.</div>`,
  )
}

function cards(spec: LeaseSpec): string {
  const d = (iso: string) => fmtDate(iso, spec.dateStyle)
  const rentText =
    spec.rentBasis === 'week'
      ? `${dollars(spec.weeklyRent * 100)} per week, paid ${spec.frequency} in advance`
      : `${dollars(spec.weeklyRent * 200)} per fortnight, paid fortnightly in advance`
  const term = spec.end
    ? `Fixed term from ${d(spec.start)} to ${d(spec.end)}`
    : `Periodic tenancy, commenced ${d(spec.start)}`
  return page(
    `body { font-family: 'Trebuchet MS', Arial, sans-serif; padding: 34px 40px; background: white; }
    .head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 4px solid #b45309; padding-bottom: 8px; }
    h1 { margin: 0; font-size: 26px; color: #78350f; }
    .meta { text-align: right; color: #6b7280; }
    .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 20px; }
    .card { border: 1px solid #fcd34d; border-radius: 8px; padding: 12px 14px; background: #fffbeb; }
    .card h2 { margin: 0 0 6px; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: #b45309; }
    .card p { margin: 3px 0; line-height: 1.5; }`,
    `<div class="head"><h1>TENANCY SUMMARY</h1>
      <div class="meta">Residential tenancy &middot; key terms<br>Prepared ${d(spec.prepared)} by ${BILL_TO[0]}</div></div>
    <div class="cards">
      <div class="card"><h2>The people</h2><p>Tenants: ${esc(tenantList(spec.tenants))}</p><p>Landlord: the owner, managed by ${BILL_TO[0]}</p></div>
      <div class="card"><h2>The place</h2><p>${esc(fullAddress(spec.property))}</p><p>Furnishings: carpets, drapes, oven, dishwasher</p></div>
      <div class="card"><h2>The term</h2><p>${term}</p></div>
      <div class="card"><h2>The money</h2><p>Rent: ${rentText}</p><p>Bond: ${dollars(spec.bond * 100)}</p></div>
      <div class="card"><h2>House rules</h2><p>Pets: ${esc(spec.petNote)}</p><p>Max. occupants: ${spec.maxOccupants}</p></div>
      <div class="card"><h2>Also agreed</h2><p>Tenant pays water usage on the bill to the landlord. Lawns are the tenant's responsibility.</p></div>
    </div>`,
  )
}

const LEASE_TEMPLATES: Record<LeaseLayout, (spec: LeaseSpec) => string> = { agency, cards }

// ---------------------------------------------------------------------------------------------------------------
// Ground truth

function invoiceTruth(spec: InvoiceSpec) {
  const p = printed(spec)
  return {
    file: spec.file,
    kind: 'invoice' as const,
    layout: spec.layout,
    property: spec.property,
    fields: {
      supplierName: spec.supplier.name,
      supplierGstNumber: spec.gstShown,
      supplierBankAccount: spec.supplier.bank,
      invoiceNumber: spec.number,
      invoiceDate: spec.date,
      dueDate: spec.due,
      propertyAddress: spec.address,
      lineItems: spec.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitAmount: l.unit / 100,
        amount: l.amount / 100,
      })),
      subtotal: p.subtotal / 100,
      gst: p.gst / 100,
      total: p.total / 100,
    },
    issues: spec.issues,
    ...(spec.note ? { note: spec.note } : {}),
  }
}

function leaseTruth(spec: LeaseSpec) {
  return {
    file: spec.file,
    kind: 'lease' as const,
    layout: spec.layout,
    property: spec.property,
    fields: {
      tenantNames: spec.tenants,
      propertyAddress: fullAddress(spec.property),
      startDate: spec.start,
      endDate: spec.end ?? 'periodic',
      weeklyRent: spec.weeklyRent,
      bond: spec.bond,
      rentFrequency: spec.frequency,
      petsAllowed: spec.pets,
      maxOccupants: spec.maxOccupants,
    },
    issues: spec.issues,
    ...(spec.note ? { note: spec.note } : {}),
  }
}

// ---------------------------------------------------------------------------------------------------------------

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  for (const f of readdirSync(OUT_DIR)) if (f.endsWith('.pdf')) rmSync(join(OUT_DIR, f))

  const browser = await chromium.launch({ executablePath: CHROMIUM })
  const tab = await browser.newPage()
  const render = async (file: string, html: string, narrow: boolean) => {
    await tab.setContent(html, { waitUntil: 'load' })
    const pdf = await tab.pdf(
      narrow
        ? { width: '80mm', height: '200mm', printBackground: true, margin: { top: '4mm', bottom: '4mm' } }
        : { format: 'A4', printBackground: true },
    )
    writeFileSync(join(OUT_DIR, file), pdf)
  }

  try {
    for (const spec of invoices) await render(spec.file, INVOICE_TEMPLATES[spec.layout](spec), spec.layout === 'receipt')
    for (const spec of leases) await render(spec.file, LEASE_TEMPLATES[spec.layout](spec), false)
  } finally {
    await browser.close()
  }

  const truth = {
    description:
      'Synthetic supplier invoices and tenancy summaries for the fictional Property Ops portfolio. Field values are what ' +
      'each document prints (dates as ISO, money in dollars). "issues" lists the problems planted on purpose; ' +
      'an empty list means the document is clean.',
    documents: [...invoices.map(invoiceTruth), ...leases.map(leaseTruth)],
  }
  writeFileSync(join(OUT_DIR, 'truth.json'), JSON.stringify(truth, null, 2) + '\n')

  const sizes = readdirSync(OUT_DIR)
    .filter((f) => f.endsWith('.pdf'))
    .map((f) => statSync(join(OUT_DIR, f)).size)
  const planted = truth.documents.filter((d) => d.issues.length > 0).length
  console.log(
    `Wrote ${sizes.length} PDFs (${invoices.length} invoices, ${leases.length} tenancy summaries, ${planted} with planted problems); ` +
      `largest ${(Math.max(...sizes) / 1024).toFixed(0)} KB, total ${(sizes.reduce((a, b) => a + b, 0) / 1024).toFixed(0)} KB.`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
