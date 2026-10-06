// Rules: regular expressions and layout heuristics over the PDF text layer. No model involved.
// They read labelled values ("Invoice #", "Inv No.", "Tax Invoice Number", "Bill number"), values on the line after
// a label, letter-spaced headings ("S I T E"), item lines that wrap, and NZ date formats.
import { findMoney, normaliseCompany, parseDate, parseMoney } from './parse'
import type { DocumentKind, InvoiceFields, LeaseFields, LineItem, RentFrequency } from './types'

export interface RulesOptions {
  /** Supplier names on file; the header is matched against them before falling back to the first line. */
  knownSuppliers?: string[]
}

const squash = (s: string) => s.replace(/\s+/g, '').toLowerCase()
const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean)

// ---------------------------------------------------------------------------------------------------------------
// Kind

const LEASE_WORDS = ['tenancy summary', 'tenancy agreement', 'tenant(s)', 'tenants:', 'bond', 'periodic', 'fixed term', 'occupants', 'per week', 'per fortnight']
const INVOICE_WORDS = ['tax invoice', 'invoice', 'gst', 'subtotal', 'amount due', 'total payable', 'due date', 'bill number', 'amount due']

/** Invoice or tenancy summary, by counting the words each kind uses. */
export function detectKind(text: string): DocumentKind {
  const t = text.toLowerCase()
  const lease = LEASE_WORDS.filter((w) => t.includes(w)).length
  const invoice = INVOICE_WORDS.filter((w) => t.includes(w)).length
  return lease > invoice ? 'lease' : 'invoice'
}

// ---------------------------------------------------------------------------------------------------------------
// Labelled values

interface Found {
  value: string
  line: number
}

/**
 * Finds the first line that starts with one of the labels and returns what follows it, or the next line when the
 * label stands alone. Labels are tried in order, so put specific ones ("Insured property") before general ones.
 * `squashed` labels also match letter-spaced headings such as "S I T E".
 */
function labelled(
  all: string[],
  labels: RegExp[],
  accept: (value: string) => boolean,
  squashed: string[] = [],
): Found | null {
  for (const label of labels) {
    for (let i = 0; i < all.length; i++) {
      const m = all[i].match(label)
      if (!m) continue
      const rest = (m[1] ?? '').trim()
      if (rest && accept(rest)) return { value: rest, line: i }
      if (!rest && i + 1 < all.length && accept(all[i + 1])) return { value: all[i + 1], line: i + 1 }
    }
  }
  for (const word of squashed) {
    for (let i = 0; i + 1 < all.length; i++) {
      if (squash(all[i]) === word && accept(all[i + 1])) return { value: all[i + 1], line: i + 1 }
    }
  }
  return null
}

const label = (pattern: string) => new RegExp(`^(?:${pattern})\\s*[:#]?\\s*(.*)$`, 'i')
const hasDate = (s: string) => parseDate(s) !== null
const hasMoney = (s: string) => findMoney(s).length > 0

const STREET_TYPES =
  'road|rd|street|st|str|avenue|ave|crescent|cres|terrace|tce|drive|dr|lane|ln|place|pl|way|close|cl|court|ct|grove|gr|parade|pde|highway|hwy|quay|boulevard|square|rise|heights|esplanade|mews|row|track|walk'
const STREET_RE = new RegExp(
  `\\b\\d+[a-z]?(?:\\/\\d+[a-z]?)?,?\\s+[a-z][a-z'’-]*(?:\\s+[a-z][a-z'’-]*)*?\\s+(?:${STREET_TYPES})\\b`,
  'i',
)
const looksLikeAddress = (s: string) => STREET_RE.test(s) && !/\bpo box\b/i.test(s)

/** The address part of a line: from "Flat 3, 41 ..." or the house number to the end of the line. */
function addressFrom(value: string): string | null {
  const m = value.match(STREET_RE)
  if (!m || m.index === undefined) return null
  const before = value.slice(0, m.index)
  const unit = before.match(/(?:flat|unit|apartment|apt)\s*\d+[a-z]?,?\s*$/i)
  const start = unit ? m.index - unit[0].length : m.index
  return value.slice(start).trim().replace(/[,.]$/, '')
}

/** Adds the next line when an address wraps ("22 Ash Street, Glen Innes," / "Auckland 1072"). */
function withContinuation(all: string[], found: Found): string {
  const value = found.value.trim()
  const next = all[found.line + 1]
  if (value.endsWith(',') && next && /^[A-Za-z][A-Za-z\s]*\d{0,4}$/.test(next)) return `${value} ${next}`
  return value.replace(/,$/, '')
}

// ---------------------------------------------------------------------------------------------------------------
// Invoices

const INVOICE_NUMBER = label('(?:tax\\s+invoice|invoice|inv|bill)\\s*(?:number|no\\.?|num\\.?|#)')
const INVOICE_DATE_SPECIFIC = [
  label('invoice\\s+date'),
  label('date\\s+of\\s+(?:invoice|notice|issue)'),
  label('bill\\s+date'),
  label('issue\\s+date'),
  label('tax\\s+date'),
  label('date\\s+issued'),
]
const INVOICE_DATE_GENERIC = [label('date'), label('issued')]
const DUE_DATE = [
  label('due\\s+date'),
  label('payment\\s+due(?:\\s+by)?'),
  label('please\\s+pay\\s+by'),
  label('pay\\s+by'),
  label('due\\s+by'),
  label('due'),
]
const PROPERTY_LABELS = [
  label('job\\s+address'),
  label('site\\s+address'),
  label('supply\\s+address'),
  label('service\\s+address'),
  label('insured\\s+property'),
  label('property\\s+address'),
  label('installation\\s+address'),
  label('work\\s+address'),
  label('situation\\s+of\\s+risk'),
  label('premises'),
  label('site'),
  label('property'),
  label('location'),
]
const SUBTOTAL_RE =
  /^(?:sub-?\s?total|total\s+(?:charges\s+|premium\s+)?excl(?:\.|uding)?\s+gst|total\s+before\s+gst|net\s+(?:total|amount)|amount\s+excl(?:\.|uding)?\s+gst)\b/i
const GST_AMOUNT_RE = /^g\.?s\.?t\b\.?(?!\s*(?:no\b|number|reg|#))/i
const TOTAL_RE =
  /^(?:total(?:\s+(?:nzd|due|payable|amount\s+due|incl(?:\.|uding)?\s+gst))?|amount\s+(?:due|payable)|balance\s+due)\b/i
const GST_NUMBER_RE = /\bGST\s*(?:No\.?|Number|Reg(?:istration)?(?:\s*(?:No\.?|Number))?|#)?\s*[:.]?\s*(\d{2,3}[-\s]?\d{3}[-\s]?\d{3})(?!\d)/i
const BANK_RE = /\b(\d{2})[- ](\d{4})[- ](\d{7})[- ](\d{2,3})\b/
const ITEM_STOP_RE =
  /description|^qty\b|charges this period|premium breakdown|sum insured|excess\b|^customer\b|^bill to\b|^job\b|^site\b|^invoice (?:number|no)|^dear\b|^thank you|^re:/i

function firstToken(value: string): string | null {
  const token = value.split(/\s+/).find((t) => /\d/.test(t))
  return token ? token.replace(/[.,;:]+$/, '') : null
}

function moneyOnLine(all: string[], i: number): number | null {
  const own = findMoney(all[i])
  if (own.length) return own[own.length - 1]
  const next = all[i + 1] ? findMoney(all[i + 1]) : []
  return next.length && !/[a-z]/i.test(all[i + 1].replace(/\$|nzd/gi, '')) ? next[0] : null
}

function supplierName(all: string[], known: string[]): string | null {
  const head = all.slice(0, 8)
  for (const name of known) {
    const wanted = normaliseCompany(name)
    if (head.some((l) => normaliseCompany(l.split('·')[0]) === wanted || normaliseCompany(l).startsWith(wanted + ' '))) return name
  }
  const first = head.find((l) => /[a-z]{2}/i.test(l) && !/^(tax\s+)?invoice$|^receipt$/i.test(l))
  return first ? first.split('·')[0].trim() : null
}

const MONEY_TOKEN = /\$?\s?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}(?!\d)/g

/** One item: the last amount on the line is the line total; a quantity and unit price are read when they agree. */
function parseItem(text: string): LineItem | null {
  const matches = [...text.matchAll(MONEY_TOKEN)]
  if (!matches.length) return null
  const last = matches[matches.length - 1]
  const amount = parseMoney(last[0])
  if (amount === null) return null
  let body = text.slice(0, last.index).trim()
  let quantity: number | null = null
  let unitAmount: number | null = null

  const qtyX = body.match(/^(\d+(?:\.\d+)?)\s*x\s+(.*)$/i) // "3 x Re-key, cut keys"
  const qtyFirst = body.match(/^(\d+(?:\.\d+)?)\s+(.*?)\s+\$?(\d[\d,]*\.\d{2})$/) // "1.5 Labour 80.00"
  const qtyAfter = body.match(/^(.*?)\s+(\d+(?:\.\d+)?)\s+\$?(\d[\d,]*\.\d{2})$/) // "Labour 1.5 72.00"
  if (qtyX) {
    quantity = Number(qtyX[1])
    body = qtyX[2]
    unitAmount = Math.round((amount / quantity) * 100) / 100
  } else if (qtyFirst && Math.abs(Number(qtyFirst[1]) * parseMoney(qtyFirst[3])! - amount) < 0.01) {
    quantity = Number(qtyFirst[1])
    unitAmount = parseMoney(qtyFirst[3])
    body = qtyFirst[2]
  } else if (qtyAfter && Math.abs(Number(qtyAfter[2]) * parseMoney(qtyAfter[3])! - amount) < 0.01) {
    quantity = Number(qtyAfter[2])
    unitAmount = parseMoney(qtyAfter[3])
    body = qtyAfter[1]
  } else {
    const rate = body.match(/(\d+(?:\.\d+)?)\s*(?:kl|days?|hours?|hrs?)\s*@\s*\$?(\d+(?:\.\d+)?)/i) // "24 kL @ $2.10"
    if (rate && Math.abs(Number(rate[1]) * Number(rate[2]) - amount) < 0.01) {
      quantity = Number(rate[1])
      unitAmount = Number(rate[2])
    } else {
      quantity = 1
      unitAmount = amount
    }
  }
  const description = body.replace(/\s+/g, ' ').replace(/[,\s]+$/, '').trim()
  return description ? { description, quantity, unitAmount, amount } : null
}

/** Item lines sit between the last heading (or labelled line) and the subtotal; wrapped lines are joined. */
function lineItems(all: string[], subtotalLine: number): LineItem[] | null {
  if (subtotalLine <= 0) return null
  let start = subtotalLine
  while (start > 0) {
    const prev = all[start - 1]
    if (ITEM_STOP_RE.test(prev) || /^[A-Za-z][A-Za-z ()#.]*:\s/.test(prev) || hasDate(prev)) break
    start--
  }
  const items: LineItem[] = []
  let pending = ''
  for (let i = start; i < subtotalLine; i++) {
    pending = pending ? `${pending} ${all[i]}` : all[i]
    if (hasMoney(all[i])) {
      const item = parseItem(pending)
      if (item) items.push(item)
      pending = ''
    }
  }
  return items.length ? items : null
}

export function extractInvoiceRules(text: string, options: RulesOptions = {}): InvoiceFields {
  const all = lines(text)

  const number = labelled(all, [INVOICE_NUMBER], (v) => firstToken(v) !== null)
  const invoiceDate =
    labelled(all, INVOICE_DATE_SPECIFIC, hasDate, ['issuedate', 'invoicedate', 'billdate', 'dateofnotice']) ??
    labelled(all, INVOICE_DATE_GENERIC, (v) => /^\d|^[a-z]{3,9}\s+\d/i.test(v) && hasDate(v.slice(0, 20)))
  let invoiceIso = invoiceDate ? parseDate(invoiceDate.value) : null
  if (!invoiceIso) {
    // Letters: the first date that isn't a due, payment, period or completion date.
    const first = all.find((l) => hasDate(l) && !/due|pay|period|complet|reading|received|cover|prepared/i.test(l))
    invoiceIso = first ? parseDate(first) : null
  }

  let dueIso: string | null = null
  const due = labelled(all, DUE_DATE, hasDate, ['paymentdue', 'duedate'])
  if (due) dueIso = parseDate(due.value)
  if (!dueIso) {
    const inline = text.match(/please pay by\s+([^\n]+)/i)
    dueIso = inline ? parseDate(inline[1]) : null
  }

  let gstNumber: string | null = null
  for (let i = 0; i < all.length && !gstNumber; i++) {
    const m = all[i].match(GST_NUMBER_RE)
    if (m) gstNumber = m[1].replace(/\s/g, '-')
    else if (/^gst(registration|regno|no|number)\.?$/.test(squash(all[i])) && all[i + 1]?.match(/^\d{2,3}-\d{3}-\d{3}$/)) gstNumber = all[i + 1]
  }

  const bank = text.match(BANK_RE)

  let propertyAddress: string | null = null
  const site = labelled(all, PROPERTY_LABELS, looksLikeAddress, ['site', 'siteaddress', 'jobaddress', 'property'])
  if (site) propertyAddress = addressFrom(withContinuation(all, site)) ?? withContinuation(all, site)
  if (!propertyAddress) {
    const re = all.find((l) => /^re:/i.test(l) && looksLikeAddress(l))
    if (re) propertyAddress = addressFrom(re)
  }
  if (!propertyAddress) {
    const any = all.slice(3).find((l) => looksLikeAddress(l))
    if (any) propertyAddress = addressFrom(any)
  }

  const subtotalLine = all.findIndex((l) => SUBTOTAL_RE.test(l))
  const subtotal = subtotalLine >= 0 ? moneyOnLine(all, subtotalLine) : null
  const from = Math.max(0, subtotalLine)
  const gstLine = all.findIndex((l, i) => i >= from && GST_AMOUNT_RE.test(l) && hasMoney(l))
  const gst = gstLine >= 0 ? moneyOnLine(all, gstLine) : null
  const totalLine = all.findIndex((l, i) => i >= from && i !== subtotalLine && TOTAL_RE.test(l) && !SUBTOTAL_RE.test(l))
  const total = totalLine >= 0 ? moneyOnLine(all, totalLine) : null

  return {
    supplierName: supplierName(all, options.knownSuppliers ?? []),
    supplierGstNumber: gstNumber,
    supplierBankAccount: bank ? `${bank[1]}-${bank[2]}-${bank[3]}-${bank[4]}` : null,
    invoiceNumber: number ? firstToken(number.value) : null,
    invoiceDate: invoiceIso,
    dueDate: dueIso,
    propertyAddress,
    lineItems: lineItems(all, subtotalLine),
    subtotal,
    gst,
    total,
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Tenancy summaries

const TENANT_LABELS = [label('tenant\\(s\\)'), label('tenants'), label('names?\\s+of\\s+tenants?'), label('tenant\\s+names?'), label('tenant:')]
const LEASE_PROPERTY_LABELS = [
  label('property\\s+address'),
  label('address\\s+of\\s+(?:the\\s+)?premises'),
  label('premises'),
  label('rental\\s+property'),
  label('property'),
  label('address'),
]

function splitNames(value: string): string[] {
  return value
    .split(/\s*(?:,|&|\band\b)\s*/i)
    .map((n) => n.trim())
    .filter((n) => /^[A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+)+$/.test(n))
}

const perWeek = (amount: number, basis: string): number => {
  const b = basis.toLowerCase()
  if (b.startsWith('fortnight')) return Math.round((amount / 2) * 100) / 100
  if (b.includes('month')) return Math.round(((amount * 12) / 52) * 100) / 100
  return amount
}

export function extractLeaseRules(text: string): LeaseFields {
  const all = lines(text)

  const tenants = labelled(all, TENANT_LABELS, (v) => splitNames(v).length > 0)
  const place = labelled(all, LEASE_PROPERTY_LABELS, looksLikeAddress, ['theplace', 'property', 'premises'])
  const propertyAddress = place ? addressFrom(withContinuation(all, place)) ?? place.value : null

  const fixed = text.match(/fixed\s+term\s+(?:from\s+)?([^\n]+?)\s+(?:to|until)\s+([^\n]+)/i)
  const start =
    labelled(all, [label('start\\s+date'), label('commencement\\s+date'), label('tenancy\\s+start(?:s|\\s+date)?')], hasDate)?.value ??
    text.match(/commenc(?:ed|ing|es)\s+(?:on\s+)?([^\n]+)/i)?.[1] ??
    fixed?.[1] ??
    null

  let endDate: string | null = null
  const end = labelled(all, [label('end\\s+date'), label('expiry\\s+date'), label('tenancy\\s+ends?')], (v) => v.length > 0)
  if (end && /periodic/i.test(end.value)) endDate = 'periodic'
  else if (end && hasDate(end.value)) endDate = parseDate(end.value)
  else if (fixed && hasDate(fixed[2])) endDate = parseDate(fixed[2])
  else if (/\bperiodic\b/i.test(text)) endDate = 'periodic'

  let weeklyRent: number | null = null
  let basis: string | null = null
  for (const l of all) {
    const m = l.match(/^rent\b(?!\s+paid)[^$\d]*\$?\s*([\d,]+(?:\.\d{2})?)\s*(?:per|a|\/|each)\s*(week|wk|fortnight|calendar\s+month|month)/i)
    if (m) {
      basis = m[2]
      weeklyRent = perWeek(parseMoney(m[1])!, basis)
      break
    }
  }

  const bondLine = all.find((l) => /^bond\b/i.test(l) && /\d/.test(l))
  const bond = bondLine ? parseMoney(bondLine.replace(/^bond[^$\d]*/i, '')) : null

  const paid = text.match(/(?:rent\s+paid|paid)\s*:?\s*(weekly|fortnightly|monthly)/i)
  let rentFrequency: RentFrequency | null = paid ? (paid[1].toLowerCase() as RentFrequency) : null
  if (!rentFrequency && basis) rentFrequency = basis.startsWith('fortnight') ? 'fortnightly' : basis.includes('month') ? 'monthly' : 'weekly'

  const pets = labelled(all, [label('pets(?:\\s+allowed)?')], (v) => v.length > 0)
  let petsAllowed: boolean | null = null
  if (pets && /^(yes|permitted|allowed|ok)\b/i.test(pets.value)) petsAllowed = true
  else if (pets && /^(no|not|none)\b/i.test(pets.value)) petsAllowed = false

  const occupants = text.match(/max(?:imum|\.)?\s*(?:number\s+of\s+)?occupants\s*:?\s*(\d+)/i)

  return {
    tenantNames: tenants ? splitNames(tenants.value) : null,
    propertyAddress,
    startDate: start ? parseDate(start) : null,
    endDate,
    weeklyRent,
    bond,
    rentFrequency,
    petsAllowed,
    maxOccupants: occupants ? Number(occupants[1]) : null,
  }
}

