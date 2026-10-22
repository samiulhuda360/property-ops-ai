// The rules route: labelled schedule rows ("Commencement Date 25 March 2026") and clause sentences, read with regular
// expressions that know the country's date order, currency and vocabulary (outgoings / service charge / CAM, bond /
// deposit, rent review / escalation, make good / reinstatement / restoration). Every value carries the page and the
// line or sentence it was read from.
import { locateQuote, sentenceAround } from './text'
import {
  COUNTRY_CURRENCY,
  PERIODS_PER_YEAR,
  TERM_FIELDS,
  type Country,
  type Currency,
  type LeaseTerms,
  type LeaseType,
  type PageText,
  type RentFrequency,
  type TermField,
} from './types'

export interface RuleHit {
  value: unknown
  page: number | null
  quote: string | null
}

export type RuleHits = Record<TermField, RuleHit>

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null
}

// ---------------------------------------------------------------------------------------------------------------
// Country, type, dates and money

export function detectCountry(text: string): Country {
  const t = text.toLowerCase()
  const score: Record<Country, number> = { NZ: 0, AU: 0, UK: 0, US: 0 }
  const add = (c: Country, patterns: RegExp[], weight = 1) => {
    for (const p of patterns) if (p.test(t)) score[c] += weight
  }
  add('NZ', [/new zealand/, /\bnzd\b/, /tenancy services/, /auckland|hamilton|wellington|christchurch/, /residential tenancies act 1986/], 2)
  add('AU', [/australia/, /\baud\b/, /\bpty ltd\b/, /\b(nsw|vic|qld|wa|sa)\b \d{4}/, /lessor/], 2)
  add('UK', [/england and wales/, /\bgbp\b/, /£/, /pounds sterling/, /assured shorthold/, /housing act 1988/], 2)
  add('US', [/united states/, /\busd\b/, /\bllc\b|\binc\.|\bpllc\b/, /state of (georgia|texas|colorado|new york|oregon|illinois|california)/, /\b[a-z]{2} \d{5}\b/], 2)
  return (Object.entries(score).sort((a, b) => b[1] - a[1])[0][0] as Country) ?? 'NZ'
}

export function detectLeaseType(text: string): LeaseType {
  return /tenancy agreement|residential lease|assured shorthold|private residence|residential dwelling/i.test(text) ? 'residential' : 'commercial'
}

/** Parses one date written in words or figures. Figures are day-first except in the United States. */
export function parseLeaseDate(raw: string, country: Country): string | null {
  const s = raw.trim().replace(/(\d)(st|nd|rd|th)\b/gi, '$1').replace(/,/g, '')
  let m = s.match(/^(\d{1,2}) ([A-Za-z]+) (\d{4})$/)
  if (m) {
    const month = MONTHS.indexOf(m[2].toLowerCase()) + 1
    return month ? iso(Number(m[3]), month, Number(m[1])) : null
  }
  m = s.match(/^([A-Za-z]+) (\d{1,2}) (\d{4})$/)
  if (m) {
    const month = MONTHS.indexOf(m[1].toLowerCase()) + 1
    return month ? iso(Number(m[3]), month, Number(m[2])) : null
  }
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    return country === 'US' ? iso(Number(m[3]), a, b) : iso(Number(m[3]), b, a)
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]))
  return null
}

const DATE_RE = /\b(?:\d{1,2}(?:st|nd|rd|th)? [A-Z][a-z]+,? \d{4}|[A-Z][a-z]+ \d{1,2},? \d{4}|\d{1,2}[/.-]\d{1,2}[/.-]\d{4}|\d{4}-\d{2}-\d{2})\b/g

/** Every date written in a piece of text, in order, as ISO. */
export function datesIn(text: string, country: Country): string[] {
  return [...text.matchAll(DATE_RE)].map((m) => parseLeaseDate(m[0], country)).filter((d): d is string => d !== null)
}

const MONEY_RE = /(?:NZ\$|A\$|US\$|£|\$)\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/
export function moneyIn(text: string): number | null {
  const m = text.match(MONEY_RE)
  return m ? Number(m[1].replace(/,/g, '')) : null
}

const FREQ: [RegExp, RentFrequency][] = [
  [/\bper week\b|\bweekly\b/i, 'weekly'],
  [/\bper fortnight\b|\bfortnightly\b/i, 'fortnightly'],
  [/\bper (?:calendar )?month\b|\bmonthly\b|\bpcm\b/i, 'monthly'],
  [/\bper quarter\b|\bquarterly\b/i, 'quarterly'],
  [/\bper (?:annum|year)\b|\bannually\b|\byearly\b/i, 'annual'],
]
const frequencyIn = (text: string, skipAnnual = false): RentFrequency | null => {
  for (const [re, f] of FREQ) {
    if (skipAnnual && f === 'annual') continue
    if (re.test(text)) return f
  }
  return null
}

// ---------------------------------------------------------------------------------------------------------------
// Schedule rows

const LABELS = [
  'Lease Reference', 'Reference', 'Landlord', 'Lessor / Agent', 'Lessor', 'Tenant(s)', 'Tenant', 'Lessee', 'Co-signer (Guarantor)', 'Guarantor',
  'Address of the premises', 'Premises', 'Commencement Date', 'Start date', 'Type of tenancy', 'Term', 'Expiry Date', 'End date',
  'Annual Rent', 'Base Rent', 'Rent Review Dates', 'Rent Escalation Dates', 'Rent', 'Outgoings', 'Service Charge', 'CAM Charges',
  'Security Deposit', 'Rent Deposit', 'Bond', 'Deposit', 'Permitted Use', 'Use', 'Renewal',
]
// Longest label first, so "Rent" does not swallow "Rent Deposit".
const LABEL_RE = new RegExp(`^(${[...LABELS].sort((a, b) => b.length - a.length).map((l) => l.replace(/[()/]/g, (c) => `\\${c}`)).join('|')}) (.+)$`)
const HEADING_RE = /^(?:[A-Z][A-Z &/]{3,}|\d+\. [A-Z].*)$/

export interface Row {
  label: string
  value: string
  page: number
  quote: string
}

/** Reads "Label value" rows from the schedule table, joining the wrapped lines that follow a row. */
export function scheduleRows(pages: PageText[]): Row[] {
  const rows: Row[] = []
  let current: Row | null = null
  for (const page of pages) {
    for (const line of page.text.split('\n')) {
      const m = line.match(LABEL_RE)
      if (m) {
        current = { label: m[1], value: m[2].trim(), page: page.num, quote: line }
        rows.push(current)
      } else if (current && !HEADING_RE.test(line) && line.length < 80 && !/[.:]$/.test(current.value) && rows.length < 40) {
        current.value += ` ${line.trim()}`
        current.quote += ` ${line.trim()}`
      } else {
        current = null
      }
      if (HEADING_RE.test(line) && /PROVISIONS|TERMS|LEASE TERMS/.test(line)) return rows
    }
  }
  return rows
}

const row = (rows: Row[], ...labels: string[]) => rows.find((r) => labels.includes(r.label)) ?? null

// ---------------------------------------------------------------------------------------------------------------

export function extractLeaseRules(pages: PageText[]): { country: Country; leaseType: LeaseType; hits: RuleHits } {
  // flat has the line breaks replaced by spaces, one for one, so an index into it is an index into text.
  const text = pages.map((p) => p.text).join('\n')
  const flat = text.replace(/\n/g, ' ')
  const country = detectCountry(text)
  const leaseType = detectLeaseType(text)
  const rows = scheduleRows(pages)

  const hits = {} as RuleHits
  for (const f of TERM_FIELDS) hits[f] = { value: null, page: null, quote: null }
  const fromRow = (field: TermField, r: Row | null, value: unknown) => {
    if (r && value !== null && value !== undefined && value !== '') hits[field] = { value, page: r.page, quote: r.quote }
  }
  const fromMatch = (field: TermField, m: RegExpMatchArray | null, value: unknown) => {
    if (!m || value === null || value === undefined || value === '') return
    const quote = sentenceAround(text, m.index ?? 0, m[0].length)
    const where = locateQuote(pages, quote)
    hits[field] = { value, page: where?.page ?? null, quote }
  }

  // Parties, premises, reference
  const refRow = row(rows, 'Lease Reference', 'Reference')
  fromRow('leaseRef', refRow, refRow?.value.match(/[A-Z]{2,}-[A-Z0-9-]+/)?.[0] ?? null)
  if (!hits.leaseRef.value) fromMatch('leaseRef', flat.match(/(?:Lease|Deed|Agreement) reference ([A-Z]{2,}-[A-Z0-9-]+)/), flat.match(/(?:Lease|Deed|Agreement) reference ([A-Z]{2,}-[A-Z0-9-]+)/)?.[1] ?? null)
  const landlordRow = row(rows, 'Landlord', 'Lessor', 'Lessor / Agent')
  fromRow('landlord', landlordRow, landlordRow?.value ?? null)
  const tenantRow = row(rows, 'Tenant', 'Lessee', 'Tenant(s)')
  fromRow('tenant', tenantRow, tenantRow?.value ?? null)
  const guarantorRow = row(rows, 'Guarantor', 'Co-signer (Guarantor)')
  fromRow('guarantor', guarantorRow, guarantorRow?.value ?? null)
  const premisesRow = row(rows, 'Premises', 'Address of the premises')
  fromRow('premises', premisesRow, premisesRow?.value ?? null)

  // Dates and term
  const startRow = row(rows, 'Commencement Date', 'Start date')
  fromRow('commencementDate', startRow, startRow ? (datesIn(startRow.value, country)[0] ?? null) : null)
  const endRow = row(rows, 'Expiry Date', 'End date')
  fromRow('expiryDate', endRow, endRow ? (datesIn(endRow.value, country)[0] ?? null) : null)
  const termRow = row(rows, 'Term', 'Type of tenancy')
  if (termRow) {
    const years = termRow.value.match(/(\d+)\s*years?/i)
    const months = termRow.value.match(/(\d+)\s*months?/i)
    fromRow('termMonths', termRow, years ? Number(years[1]) * 12 : months ? Number(months[1]) : null)
  }

  // Rent
  const rentRow = row(rows, 'Annual Rent', 'Base Rent', 'Rent')
  if (rentRow) {
    const v = rentRow.value
    const annualFirst = v.match(/^(?:NZ\$|A\$|US\$|£|\$)\s?[\d,]+(?:\.\d{2})? per annum/)
    const instalment = v.match(/instalments? of (?:NZ\$|A\$|US\$|£|\$)\s?([\d,]+(?:\.\d{2})?)/i)
    if (annualFirst && instalment) {
      const annual = moneyIn(v)
      const per = Number(instalment[1].replace(/,/g, ''))
      const freq = frequencyIn(v.slice(annualFirst[0].length), true)
      fromRow('annualRent', rentRow, annual)
      fromRow('rentAmount', rentRow, per)
      fromRow('rentFrequency', rentRow, freq)
    } else {
      const per = moneyIn(v)
      const freq = frequencyIn(v)
      fromRow('rentAmount', rentRow, per)
      fromRow('rentFrequency', rentRow, freq)
      if (per !== null && freq) fromRow('annualRent', rentRow, Math.round(per * PERIODS_PER_YEAR[freq] * 100) / 100)
    }
  }
  const currencyWord = flat.match(/\b(NZD|AUD|GBP|USD)\b/)
  const currency: Currency = currencyWord ? (currencyWord[1] as Currency) : COUNTRY_CURRENCY[country]
  if (currencyWord) fromMatch('currency', currencyWord, currency)
  else hits.currency = { value: currency, page: null, quote: null }

  // Rent review
  const reviewRow = row(rows, 'Rent Review Dates', 'Rent Escalation Dates')
  if (reviewRow) {
    const v = reviewRow.value
    if (/^none/i.test(v)) {
      fromRow('reviewMechanism', reviewRow, 'none')
    } else {
      const mech = /\(cpi/i.test(v) ? 'cpi' : /\(fixed/i.test(v) ? 'fixed' : /\(market/i.test(v) ? 'market' : null
      fromRow('reviewMechanism', reviewRow, mech)
      fromRow('reviewDates', reviewRow, datesIn(v, country))
      const pct = v.match(/(\d+(?:\.\d+)?)%/)
      if (pct) fromRow('reviewPercent', reviewRow, Number(pct[1]))
    }
  } else {
    const inc = flat.match(/On ((?:[^.]*?\d{4})) the rent increases by (\d+(?:\.\d+)?)%/i)
    if (inc) {
      fromMatch('reviewMechanism', inc, 'fixed')
      fromMatch('reviewPercent', inc, Number(inc[2]))
      fromMatch('reviewDates', inc, datesIn(inc[1], country))
    } else {
      const none = flat.match(/rent will not be increased during the fixed term|no rent review during the term/i)
      if (none) fromMatch('reviewMechanism', none, 'none')
    }
  }

  // Outgoings
  const outRow = row(rows, 'Outgoings', 'Service Charge', 'CAM Charges')
  if (outRow) {
    const v = outRow.value
    const basis = /included/i.test(v) ? 'landlord_pays' : /proportion|pro rata|share/i.test(v) ? 'proportion' : /paid in full|all/i.test(v) ? 'tenant_pays' : null
    fromRow('outgoingsBasis', outRow, basis)
    if (basis !== 'landlord_pays') fromRow('outgoingsAnnual', outRow, moneyIn(v))
  } else {
    const landlordPays = flat.match(/The landlord pays the council rates/i)
    if (landlordPays) fromMatch('outgoingsBasis', landlordPays, 'landlord_pays')
  }

  // Bond / deposit
  const bondRow = row(rows, 'Bond', 'Security Deposit', 'Rent Deposit', 'Deposit')
  if (bondRow) fromRow('bondAmount', bondRow, /^none/i.test(bondRow.value) ? null : moneyIn(bondRow.value))
  if (hits.bondAmount.value === null && bondRow && /^none/i.test(bondRow.value)) hits.bondAmount = { value: null, page: bondRow.page, quote: bondRow.quote }

  // Break clause
  const brk = flat.match(/may (?:terminate|end) this (?:lease|agreement) on or after ([^.]*?\d{4}) by giving the other party not less than (one month|\d+ months?|\d+ days)' written notice/i)
  if (brk) {
    const n = brk[2].toLowerCase()
    const months = n === 'one month' ? 1 : n.endsWith('days') ? Math.round(parseInt(n, 10) / 30) : parseInt(n, 10)
    fromMatch('breakNoticeMonths', brk, months)
    fromMatch('breakDate', brk, datesIn(brk[1], country)[0] ?? null)
  }

  // Renewal
  const renewalRow = row(rows, 'Renewal')
  if (renewalRow) {
    const v = renewalRow.value
    if (/no right/i.test(v)) fromRow('renewalTerms', renewalRow, 0)
    else {
      const m = v.match(/(\d+) further terms? of (\d+) (years?|months?)/i)
      if (m) {
        fromRow('renewalTerms', renewalRow, Number(m[1]))
        fromRow('renewalTermMonths', renewalRow, m[3].startsWith('year') ? Number(m[2]) * 12 : Number(m[2]))
      }
    }
  } else if (leaseType === 'residential') {
    hits.renewalTerms = { value: 0, page: null, quote: null }
  }

  // Use
  const useRow = row(rows, 'Permitted Use', 'Use')
  fromRow('permittedUse', useRow, useRow?.value ?? null)

  // Make good, insurance
  const mgTenant = flat.match(/shall at its own cost remove its fit-out[^.]*\./i)
  const mgFair = flat.match(/fair wear and tear excepted/i)
  if (mgTenant) fromMatch('makeGood', mgTenant, 'tenant_cost')
  else if (mgFair) fromMatch('makeGood', mgFair, 'fair_wear')
  const insTenant = flat.match(/The (?:Tenant|Lessee) shall insure the Premises/i)
  const insBoth = flat.match(/The (?:Landlord|Lessor) shall insure the building[^.]*\. The (?:Tenant|Lessee) shall insure its contents and fit-out/i)
  const insLandlord = flat.match(/The (?:landlord|lessor) shall insure the building/i)
  if (insTenant) fromMatch('insurance', insTenant, 'tenant')
  else if (insBoth) fromMatch('insurance', insBoth, 'both')
  else if (insLandlord) fromMatch('insurance', insLandlord, 'landlord')

  return { country, leaseType, hits }
}

/** Just the values, as LeaseTerms. */
export function rulesTerms(hits: RuleHits): LeaseTerms {
  const out = {} as Record<TermField, unknown>
  for (const f of TERM_FIELDS) out[f] = hits[f].value ?? null
  return out as unknown as LeaseTerms
}
