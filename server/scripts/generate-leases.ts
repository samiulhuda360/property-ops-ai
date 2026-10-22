// Renders the synthetic lease set: 24 leases (12 commercial, 12 residential; New Zealand, Australia, the United Kingdom
// and the United States) as PDFs in data/leases/, with data/leases/truth.json (every key term, the risk clauses planted,
// the charge schedule for the first twelve months) and data/leases/invoices.csv (the billing system's issued invoices
// for the same leases, with eight planted mismatches). Every party, address and company is invented.
//
//   npx tsx scripts/generate-leases.ts        (from server/)
//
// PW_CHROMIUM can point at another headless Chromium build.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { addDays, addMonths, scheduleCharges } from '../src/leases/charges'
import { PERIODS_PER_YEAR, type Charge, type Country, type Currency, type LeaseTerms, type LeaseType } from '../src/leases/types'

const OUT_DIR = resolve(__dirname, '../../data/leases')
const CHROMIUM =
  process.env.PW_CHROMIUM ||
  'D:/Portfolio/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe'

type DateStyle = 'long' | 'slash' | 'ordinal' | 'us-long' | 'us-slash'

interface Spec {
  file: string
  ref: string
  country: Country
  leaseType: LeaseType
  layout: string
  dateStyle: DateStyle
  terms: LeaseTerms
  /** Risk codes the playbook should raise on this lease. */
  risks: string[]
  /** Validation issue codes planted on purpose. */
  issues: string[]
  /** Clause wording switches. */
  flags: Partial<Record<'ratchet' | 'capped' | 'personalGuarantee' | 'landlordBreak' | 'relocation', boolean>>
  note?: string
  /** Held-out leases are written in narrative wording the rules were not written for, and go to data/leases/heldout/. */
  heldout?: boolean
}

// ---------------------------------------------------------------------------------------------------------------
// Dates and money

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const ordinal = (d: number) => `${d}${d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th'}`

function fmtDate(iso: string, style: DateStyle): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dd = String(d).padStart(2, '0')
  const mm = String(m).padStart(2, '0')
  switch (style) {
    case 'long':
      return `${d} ${MONTHS[m - 1]} ${y}`
    case 'ordinal':
      return `${ordinal(d)} ${MONTHS[m - 1]} ${y}`
    case 'slash':
      return `${dd}/${mm}/${y}`
    case 'us-long':
      return `${MONTHS[m - 1]} ${d}, ${y}`
    case 'us-slash':
      return `${mm}/${dd}/${y}`
  }
}

const SYMBOL: Record<Currency, string> = { NZD: '$', AUD: '$', GBP: '£', USD: '$' }
const money = (n: number, c: Currency) =>
  `${SYMBOL[c]}${n.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const expiry = (commencement: string, months: number) => addDays(addMonths(commencement, months), -1)
const anniversaries = (commencement: string, months: number, everyMonths: number) => {
  const out: string[] = []
  for (let m = everyMonths; m < months; m += everyMonths) out.push(addMonths(commencement, m))
  return out
}

interface TermInput extends Omit<LeaseTerms, 'expiryDate' | 'annualRent' | 'reviewDates' | 'currency'> {
  reviewEvery?: number
  reviewDates?: string[] | null
  annualRent?: number | null
}

const CURRENCY: Record<Country, Currency> = { NZ: 'NZD', AU: 'AUD', UK: 'GBP', US: 'USD' }

function terms(country: Country, t: TermInput): LeaseTerms {
  const { reviewEvery, ...rest } = t
  const commencement = t.commencementDate!
  const months = t.termMonths!
  const reviewDates =
    t.reviewDates !== undefined
      ? t.reviewDates
      : t.reviewMechanism && t.reviewMechanism !== 'none'
        ? anniversaries(commencement, months, reviewEvery ?? 12)
        : null
  return {
    ...rest,
    currency: CURRENCY[country],
    expiryDate: expiry(commencement, months),
    annualRent: t.annualRent ?? Math.round(t.rentAmount! * PERIODS_PER_YEAR[t.rentFrequency!] * 100) / 100,
    reviewDates,
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The 24 leases

const S: Spec[] = [
  // Commercial, New Zealand -------------------------------------------------------------------------------------
  {
    file: 'lease-c-nz-01.pdf', ref: 'ACM-NZ-C-01', country: 'NZ', leaseType: 'commercial', layout: 'nz-deed', dateStyle: 'long',
    terms: terms('NZ', {
      landlord: 'Acme Property Group Limited', tenant: 'Harbourline Coffee Limited', guarantor: 'James Harper',
      premises: 'Ground Floor, 118 Quay Street, Auckland 1010', commencementDate: '2026-04-01', termMonths: 60,
      rentAmount: 7000, rentFrequency: 'monthly', reviewMechanism: 'fixed', reviewPercent: 3, outgoingsBasis: 'proportion',
      outgoingsAnnual: 14200, bondAmount: 21000, breakNoticeMonths: null, breakDate: null, renewalTerms: 1, renewalTermMonths: 60,
      permittedUse: 'Cafe and takeaway food', makeGood: 'tenant_cost', insurance: 'landlord', leaseRef: 'ACM-NZ-C-01',
    }),
    risks: ['personal_guarantee', 'make_good_tenant_cost', 'uncapped_outgoings'], issues: [], flags: { personalGuarantee: true },
  },
  {
    file: 'lease-c-nz-02.pdf', ref: 'ACM-NZ-C-02', country: 'NZ', leaseType: 'commercial', layout: 'nz-deed', dateStyle: 'slash',
    terms: terms('NZ', {
      landlord: 'Acme Commercial Holdings Limited', tenant: 'Northgate Physio Limited', guarantor: null,
      premises: 'Suite 4, Level 2, 27 Anzac Avenue, Hamilton 3204', commencementDate: '2025-11-01', termMonths: 36,
      rentAmount: 4550, rentFrequency: 'monthly', reviewMechanism: 'market', reviewPercent: null, reviewDates: ['2027-11-01'],
      outgoingsBasis: 'tenant_pays', outgoingsAnnual: 9800, bondAmount: 13650, breakNoticeMonths: 6, breakDate: '2027-05-01',
      renewalTerms: 0, renewalTermMonths: null, permittedUse: 'Physiotherapy clinic', makeGood: 'fair_wear', insurance: 'tenant', leaseRef: 'ACM-NZ-C-02',
    }),
    risks: ['ratchet_review'], issues: [], flags: { ratchet: true, capped: true },
  },
  {
    file: 'lease-c-nz-03.pdf', ref: 'ACM-NZ-C-03', country: 'NZ', leaseType: 'commercial', layout: 'nz-deed', dateStyle: 'long',
    terms: terms('NZ', {
      landlord: 'Acme Industrial Estates Limited', tenant: 'Southern Freight Solutions Limited', guarantor: 'Southern Freight Holdings Limited',
      premises: 'Warehouse 3, 55 Hobsonville Road, Auckland 0618', commencementDate: '2026-07-01', termMonths: 72,
      rentAmount: 16000, rentFrequency: 'monthly', reviewMechanism: 'cpi', reviewPercent: null, outgoingsBasis: 'proportion',
      outgoingsAnnual: 31500, bondAmount: 48000, breakNoticeMonths: 9, breakDate: '2028-07-01', renewalTerms: 2, renewalTermMonths: 36,
      permittedUse: 'Warehousing and distribution', makeGood: 'tenant_cost', insurance: 'landlord', leaseRef: 'ACM-NZ-C-03',
    }),
    risks: ['uncapped_outgoings', 'make_good_tenant_cost', 'landlord_break'], issues: [], flags: { landlordBreak: true },
  },
  // Commercial, Australia ---------------------------------------------------------------------------------------
  {
    file: 'lease-c-au-01.pdf', ref: 'ACM-AU-C-01', country: 'AU', leaseType: 'commercial', layout: 'au-retail', dateStyle: 'long',
    terms: terms('AU', {
      landlord: 'Acme Retail Property Pty Ltd', tenant: 'Bella Rosa Gelato Pty Ltd', guarantor: 'Claire Moretti',
      premises: 'Shop 12, Riverside Plaza, 200 George Street, Parramatta NSW 2150', commencementDate: '2026-02-01', termMonths: 60,
      rentAmount: 8000, rentFrequency: 'monthly', reviewMechanism: 'fixed', reviewPercent: 4, outgoingsBasis: 'proportion',
      outgoingsAnnual: 18400, bondAmount: 24000, breakNoticeMonths: null, breakDate: null, renewalTerms: 1, renewalTermMonths: 60,
      permittedUse: 'Retail sale of gelato and desserts', makeGood: 'tenant_cost', insurance: 'both', leaseRef: 'ACM-AU-C-01',
    }),
    risks: ['personal_guarantee', 'fixed_review_high', 'uncapped_outgoings', 'make_good_tenant_cost'], issues: [], flags: { personalGuarantee: true },
  },
  {
    file: 'lease-c-au-02.pdf', ref: 'ACM-AU-C-02', country: 'AU', leaseType: 'commercial', layout: 'au-retail', dateStyle: 'slash',
    terms: terms('AU', {
      landlord: 'Acme Office Trust', tenant: 'Brightwater Consulting Pty Ltd', guarantor: null,
      premises: 'Level 5, 310 Collins Street, Melbourne VIC 3000', commencementDate: '2025-09-15', termMonths: 36,
      rentAmount: 11000, rentFrequency: 'monthly', reviewMechanism: 'cpi', reviewPercent: null, outgoingsBasis: 'landlord_pays',
      outgoingsAnnual: null, bondAmount: 33000, breakNoticeMonths: 3, breakDate: '2026-09-15', renewalTerms: 0, renewalTermMonths: null,
      permittedUse: 'Commercial offices', makeGood: 'fair_wear', insurance: 'landlord', leaseRef: 'ACM-AU-C-02',
    }),
    risks: [], issues: [], flags: {},
  },
  {
    file: 'lease-c-au-03.pdf', ref: 'ACM-AU-C-03', country: 'AU', leaseType: 'commercial', layout: 'au-retail', dateStyle: 'long',
    terms: terms('AU', {
      landlord: 'Acme Industrial Pty Ltd', tenant: 'Coastal Marine Supplies Pty Ltd', guarantor: 'Tom Bradley',
      premises: 'Unit 7, 44 Enterprise Drive, Brisbane QLD 4008', commencementDate: '2026-05-01', termMonths: 24,
      rentAmount: 5000, rentFrequency: 'monthly', reviewMechanism: 'fixed', reviewPercent: 3.5, outgoingsBasis: 'tenant_pays',
      outgoingsAnnual: 7200, bondAmount: 15000, breakNoticeMonths: 1, breakDate: '2027-05-01', renewalTerms: 0, renewalTermMonths: null,
      permittedUse: 'Warehouse and trade sales of marine supplies', makeGood: 'tenant_cost', insurance: 'tenant', leaseRef: 'ACM-AU-C-03',
    }),
    risks: ['personal_guarantee', 'short_break_notice', 'no_renewal_short_term', 'make_good_tenant_cost', 'relocation_clause'],
    issues: [], flags: { personalGuarantee: true, capped: true, relocation: true },
  },
  // Commercial, United Kingdom ----------------------------------------------------------------------------------
  {
    file: 'lease-c-uk-01.pdf', ref: 'ACM-UK-C-01', country: 'UK', leaseType: 'commercial', layout: 'uk-lease', dateStyle: 'long',
    terms: terms('UK', {
      landlord: 'Acme Estates Limited', tenant: 'Thornbury Books Limited', guarantor: 'Emma Thornbury',
      premises: 'Ground Floor, 14 Market Street, Bristol BS1 4AB', commencementDate: '2026-03-25', termMonths: 120,
      rentAmount: 10500, rentFrequency: 'quarterly', reviewMechanism: 'market', reviewPercent: null, reviewDates: ['2031-03-25'],
      outgoingsBasis: 'proportion', outgoingsAnnual: 6800, bondAmount: 10500, breakNoticeMonths: 6, breakDate: '2031-03-25',
      renewalTerms: 0, renewalTermMonths: null, permittedUse: 'Retail sale of books and stationery', makeGood: 'tenant_cost', insurance: 'landlord', leaseRef: 'ACM-UK-C-01',
    }),
    risks: ['personal_guarantee', 'ratchet_review', 'uncapped_outgoings', 'make_good_tenant_cost'], issues: [], flags: { personalGuarantee: true, ratchet: true },
  },
  {
    file: 'lease-c-uk-02.pdf', ref: 'ACM-UK-C-02', country: 'UK', leaseType: 'commercial', layout: 'uk-lease', dateStyle: 'slash',
    terms: terms('UK', {
      landlord: 'Acme Workspace Limited', tenant: 'Greenfield Digital Limited', guarantor: null,
      premises: 'Suite 3B, Second Floor, Albion House, 60 Deansgate, Manchester M3 2EN', commencementDate: '2025-10-01', termMonths: 36,
      rentAmount: 2400, rentFrequency: 'monthly', reviewMechanism: 'none', reviewPercent: null, outgoingsBasis: 'landlord_pays',
      outgoingsAnnual: null, bondAmount: 4800, breakNoticeMonths: 2, breakDate: '2026-10-01', renewalTerms: 1, renewalTermMonths: 12,
      permittedUse: 'Offices', makeGood: 'fair_wear', insurance: 'landlord', leaseRef: 'ACM-UK-C-02',
    }),
    risks: ['short_break_notice', 'landlord_break'], issues: [], flags: { landlordBreak: true },
  },
  {
    file: 'lease-c-uk-03.pdf', ref: 'ACM-UK-C-03', country: 'UK', leaseType: 'commercial', layout: 'uk-lease', dateStyle: 'ordinal',
    terms: terms('UK', {
      landlord: 'Acme Industrial Holdings Limited', tenant: 'Pennine Fabrication Limited', guarantor: 'Pennine Group Holdings Limited',
      premises: 'Unit 9, Oakwood Industrial Estate, Leeds LS12 6BT', commencementDate: '2026-06-24', termMonths: 180,
      rentAmount: 23750, rentFrequency: 'quarterly', reviewMechanism: 'cpi', reviewPercent: null, reviewEvery: 60,
      outgoingsBasis: 'proportion', outgoingsAnnual: 12400, bondAmount: null, breakNoticeMonths: null, breakDate: null,
      renewalTerms: 0, renewalTermMonths: null, permittedUse: 'Light industrial use and storage', makeGood: 'tenant_cost', insurance: 'landlord', leaseRef: 'ACM-UK-C-03',
    }),
    risks: ['make_good_tenant_cost'], issues: [], flags: { capped: true },
  },
  // Commercial, United States -----------------------------------------------------------------------------------
  {
    file: 'lease-c-us-01.pdf', ref: 'ACM-US-C-01', country: 'US', leaseType: 'commercial', layout: 'us-lease', dateStyle: 'us-long',
    terms: terms('US', {
      landlord: 'Acme Realty Partners LLC', tenant: 'Blue Ridge Dental PLLC', guarantor: 'Sarah Mitchell',
      premises: 'Suite 210, 4500 Peachtree Road NE, Atlanta, GA 30326', commencementDate: '2026-01-01', termMonths: 84,
      rentAmount: 5250, rentFrequency: 'monthly', reviewMechanism: 'fixed', reviewPercent: 3, outgoingsBasis: 'proportion',
      outgoingsAnnual: 15600, bondAmount: 10500, breakNoticeMonths: null, breakDate: null, renewalTerms: 1, renewalTermMonths: 60,
      permittedUse: 'Dental office', makeGood: 'tenant_cost', insurance: 'both', leaseRef: 'ACM-US-C-01',
    }),
    risks: ['personal_guarantee', 'uncapped_outgoings', 'make_good_tenant_cost'], issues: [], flags: { personalGuarantee: true },
  },
  {
    file: 'lease-c-us-02.pdf', ref: 'ACM-US-C-02', country: 'US', leaseType: 'commercial', layout: 'us-lease', dateStyle: 'us-slash',
    terms: terms('US', {
      landlord: 'Acme Commerce Center LLC', tenant: 'Lakeside Fitness Inc.', guarantor: null,
      premises: 'Unit C, 880 Industrial Parkway, Austin, TX 78745', commencementDate: '2025-08-15', termMonths: 36,
      rentAmount: 9800, rentFrequency: 'monthly', reviewMechanism: 'cpi', reviewPercent: null, outgoingsBasis: 'tenant_pays',
      outgoingsAnnual: 22800, bondAmount: 19600, breakNoticeMonths: 3, breakDate: '2027-02-15', renewalTerms: 0, renewalTermMonths: null,
      permittedUse: 'Fitness studio', makeGood: 'fair_wear', insurance: 'tenant', leaseRef: 'ACM-US-C-02',
    }),
    risks: ['relocation_clause'], issues: [], flags: { capped: true, relocation: true },
  },
  {
    file: 'lease-c-us-03.pdf', ref: 'ACM-US-C-03', country: 'US', leaseType: 'commercial', layout: 'us-lease', dateStyle: 'us-long',
    terms: terms('US', {
      landlord: 'Acme Properties Inc.', tenant: 'Maple & Oak Bakery LLC', guarantor: 'Daniel Reyes',
      premises: '1200 Main Street, Suite 100, Denver, CO 80202', commencementDate: '2026-09-01', termMonths: 24,
      rentAmount: 4200, rentFrequency: 'monthly', reviewMechanism: 'fixed', reviewPercent: 5, outgoingsBasis: 'proportion',
      outgoingsAnnual: 9900, bondAmount: 8400, breakNoticeMonths: 2, breakDate: '2027-09-01', renewalTerms: 0, renewalTermMonths: null,
      permittedUse: 'Bakery and cafe', makeGood: 'tenant_cost', insurance: 'both', leaseRef: 'ACM-US-C-03',
    }),
    risks: ['personal_guarantee', 'fixed_review_high', 'uncapped_outgoings', 'landlord_break', 'short_break_notice', 'no_renewal_short_term', 'make_good_tenant_cost'],
    issues: [], flags: { personalGuarantee: true, landlordBreak: true },
  },
  // Residential, New Zealand ------------------------------------------------------------------------------------
  {
    file: 'lease-r-nz-01.pdf', ref: 'ACM-NZ-R-01', country: 'NZ', leaseType: 'residential', layout: 'nz-tenancy', dateStyle: 'long',
    terms: terms('NZ', {
      landlord: 'Acme Property Management Limited', tenant: 'Emma Walsh', guarantor: null,
      premises: '42 Seaview Road, Devonport, Auckland 0624', commencementDate: '2026-03-02', termMonths: 12,
      rentAmount: 720, rentFrequency: 'weekly', reviewMechanism: 'none', reviewPercent: null, outgoingsBasis: 'landlord_pays',
      outgoingsAnnual: null, bondAmount: 2880, breakNoticeMonths: null, breakDate: null, renewalTerms: 0, renewalTermMonths: null,
      permittedUse: 'Residential dwelling', makeGood: 'fair_wear', insurance: 'landlord', leaseRef: 'ACM-NZ-R-01',
    }),
    risks: [], issues: [], flags: {},
  },
  {
    file: 'lease-r-nz-02.pdf', ref: 'ACM-NZ-R-02', country: 'NZ', leaseType: 'residential', layout: 'nz-tenancy', dateStyle: 'slash',
    terms: terms('NZ', {
      landlord: 'Acme Property Management Limited', tenant: 'Oliver Bennett and Sophie Bennett', guarantor: null,
      premises: '7/15 Victoria Avenue, Remuera, Auckland 1050', commencementDate: '2025-12-15', termMonths: 24,
      rentAmount: 1300, rentFrequency: 'fortnightly', reviewMechanism: 'none', reviewPercent: null, outgoingsBasis: 'landlord_pays',
      outgoingsAnnual: null, bondAmount: 2600, breakNoticeMonths: null, breakDate: null, renewalTerms: 0, renewalTermMonths: null,
      permittedUse: 'Residential dwelling', makeGood: 'fair_wear', insurance: 'landlord', leaseRef: 'ACM-NZ-R-02',
    }),
    risks: [], issues: [], flags: {},
  },
  {
    file: 'lease-r-nz-03.pdf', ref: 'ACM-NZ-R-03', country: 'NZ', leaseType: 'residential', layout: 'nz-tenancy', dateStyle: 'long',
    terms: terms('NZ', {
      landlord: 'Acme Residential Limited', tenant: 'Lucy Chapman', guarantor: 'Mark Chapman',
      premises: '18 Orchard Lane, Te Atatu Peninsula, Auckland 0610', commencementDate: '2026-06-01', termMonths: 6,
      rentAmount: 640, rentFrequency: 'weekly', reviewMechanism: 'none', reviewPercent: null, outgoingsBasis: 'landlord_pays',
      outgoingsAnnual: null, bondAmount: 3840, breakNoticeMonths: null, breakDate: null, renewalTerms: 0, renewalTermMonths: null,
      permittedUse: 'Residential dwelling', makeGood: 'fair_wear', insurance: 'landlord', leaseRef: 'ACM-NZ-R-03',
    }),
    risks: ['personal_guarantee'], issues: ['bond_over_limit'], flags: { personalGuarantee: true }, note: 'bond is six weeks of rent; the New Zealand limit is four',
  },
  // Residential, Australia --------------------------------------------------------------------------------------
  {
    file: 'lease-r-au-01.pdf', ref: 'ACM-AU-R-01', country: 'AU', leaseType: 'residential', layout: 'au-tenancy', dateStyle: 'slash',
    terms: terms('AU', {
      landlord: 'Acme Realty Pty Ltd', tenant: 'Jack Donovan', guarantor: null,
      premises: '3/22 Bondi Road, Bondi NSW 2026', commencementDate: '2026-02-14', termMonths: 12,
      rentAmount: 850, rentFrequency: 'weekly', reviewMechanism: 'none', reviewPercent: null, outgoingsBasis: 'landlord_pays',
      outgoingsAnnual: null, bondAmount: 3400, breakNoticeMonths: null, breakDate: null, renewalTerms: 0, renewalTermMonths: null,
      permittedUse: 'Residential dwelling', makeGood: 'fair_wear', insurance: 'landlord', leaseRef: 'ACM-AU-R-01',
    }),
    risks: [], issues: [], flags: {},
  },
  {
    file: 'lease-r-au-02.pdf', ref: 'ACM-AU-R-02', country: 'AU', leaseType: 'residential', layout: 'au-tenancy', dateStyle: 'long',
    terms: terms('AU', {
      landlord: 'Acme Property Services Pty Ltd', tenant: 'Chloe Patterson and Ryan Patterson', guarantor: null,
      premises: '15 Jacaranda Crescent, Carindale QLD 4152', commencementDate: '2025-10-20', termMonths: 6,
      rentAmount: 1240, rentFrequency: 'fortnightly', reviewMechanism: 'none', reviewPercent: null, outgoingsBasis: 'landlord_pays',
      outgoingsAnnual: null, bondAmount: 2480, breakNoticeMonths: null, breakDate: null, renewalTerms: 0, renewalTermMonths: null,
      permittedUse: 'Residential dwelling', makeGood: 'fair_wear', insurance: 'landlord', leaseRef: 'ACM-AU-R-02',
    }),
    risks: [], issues: [], flags: {},
  },
  {
    file: 'lease-r-au-03.pdf', ref: 'ACM-AU-R-03', country: 'AU', leaseType: 'residential', layout: 'au-tenancy', dateStyle: 'long',
    terms: terms('AU', {
      landlord: 'Acme Homes Pty Ltd', tenant: 'Isabella Grant', guarantor: null,
      premises: 'Unit 9, 77 Chapel Street, St Kilda VIC 3182', commencementDate: '2026-05-04', termMonths: 12,
      rentAmount: 2600, rentFrequency: 'monthly', reviewMechanism: 'none', reviewPercent: null, outgoingsBasis: 'landlord_pays',
      outgoingsAnnual: null, bondAmount: 2600, breakNoticeMonths: null, breakDate: null, renewalTerms: 0, renewalTermMonths: null,
      permittedUse: 'Residential dwelling', makeGood: 'fair_wear', insurance: 'landlord', leaseRef: 'ACM-AU-R-03',
    }),
    risks: [], issues: [], flags: {},
  },
  // Residential, United Kingdom ---------------------------------------------------------------------------------
  {
    file: 'lease-r-uk-01.pdf', ref: 'ACM-UK-R-01', country: 'UK', leaseType: 'residential', layout: 'uk-ast', dateStyle: 'ordinal',
    terms: terms('UK', {
      landlord: 'Acme Residential Investments Limited', tenant: 'Harry Collins', guarantor: 'Margaret Collins',
      premises: 'Flat 2, 31 Clifton Road, Bristol BS8 1AQ', commencementDate: '2026-01-12', termMonths: 12,
      rentAmount: 1250, rentFrequency: 'monthly', reviewMechanism: 'none', reviewPercent: null, outgoingsBasis: 'landlord_pays',
      outgoingsAnnual: null, bondAmount: 1442.31, breakNoticeMonths: null, breakDate: null, renewalTerms: 0, renewalTermMonths: null,
      permittedUse: 'Private residence', makeGood: 'fair_wear', insurance: 'landlord', leaseRef: 'ACM-UK-R-01',
    }),
    risks: ['personal_guarantee'], issues: [], flags: { personalGuarantee: true },
  },
  {
    file: 'lease-r-uk-02.pdf', ref: 'ACM-UK-R-02', country: 'UK', leaseType: 'residential', layout: 'uk-ast', dateStyle: 'slash',
    terms: terms('UK', {
      landlord: 'Acme Residential Investments Limited', tenant: 'Amelia Shaw and George Shaw', guarantor: null,
      premises: '8 Wellington Terrace, Leeds LS6 2PR', commencementDate: '2025-09-01', termMonths: 6,
      rentAmount: 995, rentFrequency: 'monthly', reviewMechanism: 'none', reviewPercent: null, outgoingsBasis: 'landlord_pays',
      outgoingsAnnual: null, bondAmount: 1148.08, breakNoticeMonths: 2, breakDate: '2026-01-01', renewalTerms: 0, renewalTermMonths: null,
      permittedUse: 'Private residence', makeGood: 'fair_wear', insurance: 'landlord', leaseRef: 'ACM-UK-R-02',
    }),
    risks: ['short_break_notice', 'landlord_break'], issues: [], flags: { landlordBreak: true },
  },
  {
    file: 'lease-r-uk-03.pdf', ref: 'ACM-UK-R-03', country: 'UK', leaseType: 'residential', layout: 'uk-ast', dateStyle: 'long',
    terms: terms('UK', {
      landlord: 'Acme Homes (North) Limited', tenant: 'Charlotte Reid', guarantor: null,
      premises: 'Flat 5, Riverside Court, 20 Quayside, Newcastle upon Tyne NE1 3DX', commencementDate: '2026-07-06', termMonths: 24,
      rentAmount: 1400, rentFrequency: 'monthly', reviewMechanism: 'fixed', reviewPercent: 3, outgoingsBasis: 'landlord_pays',
      outgoingsAnnual: null, bondAmount: 1615.38, breakNoticeMonths: null, breakDate: null, renewalTerms: 0, renewalTermMonths: null,
      permittedUse: 'Private residence', makeGood: 'fair_wear', insurance: 'landlord', leaseRef: 'ACM-UK-R-03',
    }),
    risks: [], issues: [], flags: {},
  },
  // Residential, United States ----------------------------------------------------------------------------------
  {
    file: 'lease-r-us-01.pdf', ref: 'ACM-US-R-01', country: 'US', leaseType: 'residential', layout: 'us-residential', dateStyle: 'us-long',
    terms: terms('US', {
      landlord: 'Acme Residential LLC', tenant: 'Michael Turner', guarantor: 'Patricia Turner',
      premises: 'Apt 4B, 215 West 88th Street, New York, NY 10024', commencementDate: '2026-02-01', termMonths: 12,
      rentAmount: 3450, rentFrequency: 'monthly', reviewMechanism: 'none', reviewPercent: null, outgoingsBasis: 'landlord_pays',
      outgoingsAnnual: null, bondAmount: 3450, breakNoticeMonths: null, breakDate: null, renewalTerms: 0, renewalTermMonths: null,
      permittedUse: 'Private residence', makeGood: 'fair_wear', insurance: 'landlord', leaseRef: 'ACM-US-R-01',
    }),
    risks: ['personal_guarantee'], issues: [], flags: { personalGuarantee: true },
  },
  {
    file: 'lease-r-us-02.pdf', ref: 'ACM-US-R-02', country: 'US', leaseType: 'residential', layout: 'us-residential', dateStyle: 'us-slash',
    terms: terms('US', {
      landlord: 'Acme Property Management Inc.', tenant: 'Jessica Alvarez and Brian Alvarez', guarantor: null,
      premises: '1738 Maple Drive, Portland, OR 97214', commencementDate: '2025-11-15', termMonths: 12,
      rentAmount: 2150, rentFrequency: 'monthly', reviewMechanism: 'none', reviewPercent: null, outgoingsBasis: 'landlord_pays',
      outgoingsAnnual: null, bondAmount: 2150, breakNoticeMonths: 2, breakDate: '2026-05-15', renewalTerms: 0, renewalTermMonths: null,
      permittedUse: 'Private residence', makeGood: 'fair_wear', insurance: 'landlord', leaseRef: 'ACM-US-R-02',
    }),
    risks: ['short_break_notice'], issues: [], flags: {},
  },
  {
    file: 'lease-r-us-03.pdf', ref: 'ACM-US-R-03', country: 'US', leaseType: 'residential', layout: 'us-residential', dateStyle: 'us-long',
    terms: terms('US', {
      landlord: 'Acme Apartments LLC', tenant: 'Hannah Foster', guarantor: null,
      premises: 'Unit 12, 960 Lakeshore Boulevard, Chicago, IL 60611', commencementDate: '2026-08-01', termMonths: 24,
      rentAmount: 1975, rentFrequency: 'monthly', reviewMechanism: 'fixed', reviewPercent: 3, outgoingsBasis: 'landlord_pays',
      outgoingsAnnual: null, bondAmount: 3950, breakNoticeMonths: null, breakDate: null, renewalTerms: 0, renewalTermMonths: null,
      permittedUse: 'Private residence', makeGood: 'fair_wear', insurance: 'landlord', leaseRef: 'ACM-US-R-03',
    }),
    risks: [], issues: ['bond_over_limit'], flags: {}, note: 'security deposit is two months of rent, above the eight-week check',
  },
]


// ---------------------------------------------------------------------------------------------------------------
// Held-out leases: narrative wording, no schedule table, numbers in words. Made after the rules were fixed and never
// used to change them.

const H: Spec[] = [
  {
    file: 'lease-h-nz-01.pdf', ref: 'ACM-NZ-H-01', country: 'NZ', leaseType: 'commercial', layout: 'narrative', dateStyle: 'ordinal', heldout: true,
    terms: terms('NZ', {
      landlord: 'Acme Waterfront Holdings Limited', tenant: 'Kauri Street Dental Limited', guarantor: 'Oliver Finch',
      premises: 'Level 1, 9 Kauri Street, Wellington 6011', commencementDate: '2026-05-01', termMonths: 48,
      rentAmount: 6250, rentFrequency: 'monthly', reviewMechanism: 'fixed', reviewPercent: 2.5, outgoingsBasis: 'proportion',
      outgoingsAnnual: 11400, bondAmount: 18750, breakNoticeMonths: null, breakDate: null, renewalTerms: 1, renewalTermMonths: 48,
      permittedUse: 'Dental surgery', makeGood: 'tenant_cost', insurance: 'landlord', leaseRef: 'ACM-NZ-H-01',
    }),
    risks: ['personal_guarantee', 'uncapped_outgoings', 'make_good_tenant_cost'], issues: [], flags: { personalGuarantee: true },
  },
  {
    file: 'lease-h-nz-02.pdf', ref: 'ACM-NZ-H-02', country: 'NZ', leaseType: 'residential', layout: 'narrative', dateStyle: 'long', heldout: true,
    terms: terms('NZ', {
      landlord: 'Acme Rentals Limited', tenant: 'Grace Holloway', guarantor: null,
      premises: '12 Pohutukawa Avenue, Mount Maunganui 3116', commencementDate: '2026-02-09', termMonths: 12,
      rentAmount: 690, rentFrequency: 'weekly', reviewMechanism: 'none', reviewPercent: null, outgoingsBasis: 'landlord_pays',
      outgoingsAnnual: null, bondAmount: 2760, breakNoticeMonths: null, breakDate: null, renewalTerms: 0, renewalTermMonths: null,
      permittedUse: 'Private residence', makeGood: 'fair_wear', insurance: 'landlord', leaseRef: 'ACM-NZ-H-02',
    }),
    risks: [], issues: [], flags: {},
  },
  {
    file: 'lease-h-au-01.pdf', ref: 'ACM-AU-H-01', country: 'AU', leaseType: 'commercial', layout: 'narrative', dateStyle: 'slash', heldout: true,
    terms: terms('AU', {
      landlord: 'Acme Harbour Estates Pty Ltd', tenant: 'Redgum Architects Pty Ltd', guarantor: null,
      premises: 'Suite 8, 150 Clarence Street, Sydney NSW 2000', commencementDate: '2025-12-01', termMonths: 60,
      rentAmount: 9500, rentFrequency: 'monthly', reviewMechanism: 'cpi', reviewPercent: null, outgoingsBasis: 'tenant_pays',
      outgoingsAnnual: 16200, bondAmount: 28500, breakNoticeMonths: 6, breakDate: '2028-12-01', renewalTerms: 0, renewalTermMonths: null,
      permittedUse: 'Architectural practice offices', makeGood: 'fair_wear', insurance: 'both', leaseRef: 'ACM-AU-H-01',
    }),
    risks: ['uncapped_outgoings'], issues: [], flags: {},
  },
  {
    file: 'lease-h-au-02.pdf', ref: 'ACM-AU-H-02', country: 'AU', leaseType: 'residential', layout: 'narrative', dateStyle: 'long', heldout: true,
    terms: terms('AU', {
      landlord: 'Acme Coastal Property Pty Ltd', tenant: 'Ethan Marsh and Lily Marsh', guarantor: null,
      premises: '4/61 Esplanade, Glenelg SA 5045', commencementDate: '2026-03-16', termMonths: 12,
      rentAmount: 1180, rentFrequency: 'fortnightly', reviewMechanism: 'none', reviewPercent: null, outgoingsBasis: 'landlord_pays',
      outgoingsAnnual: null, bondAmount: 2360, breakNoticeMonths: null, breakDate: null, renewalTerms: 0, renewalTermMonths: null,
      permittedUse: 'Private residence', makeGood: 'fair_wear', insurance: 'landlord', leaseRef: 'ACM-AU-H-02',
    }),
    risks: [], issues: [], flags: {},
  },
  {
    file: 'lease-h-uk-01.pdf', ref: 'ACM-UK-H-01', country: 'UK', leaseType: 'commercial', layout: 'narrative', dateStyle: 'ordinal', heldout: true,
    terms: terms('UK', {
      landlord: 'Acme City Estates Limited', tenant: 'Rowan & Bright Opticians Limited', guarantor: 'Fiona Rowan',
      premises: '22 High Street, Oxford OX1 4AH', commencementDate: '2026-09-29', termMonths: 120,
      rentAmount: 9000, rentFrequency: 'quarterly', reviewMechanism: 'market', reviewPercent: null, reviewDates: ['2031-09-29'],
      outgoingsBasis: 'proportion', outgoingsAnnual: 5200, bondAmount: 9000, breakNoticeMonths: 6, breakDate: '2031-09-29',
      renewalTerms: 0, renewalTermMonths: null, permittedUse: 'Opticians and retail sale of eyewear', makeGood: 'tenant_cost', insurance: 'landlord', leaseRef: 'ACM-UK-H-01',
    }),
    risks: ['personal_guarantee', 'ratchet_review', 'uncapped_outgoings', 'make_good_tenant_cost'], issues: [], flags: { personalGuarantee: true, ratchet: true },
  },
  {
    file: 'lease-h-uk-02.pdf', ref: 'ACM-UK-H-02', country: 'UK', leaseType: 'residential', layout: 'narrative', dateStyle: 'slash', heldout: true,
    terms: terms('UK', {
      landlord: 'Acme Lettings (South) Limited', tenant: 'Daniel Pearce', guarantor: null,
      premises: 'Flat 7, 3 Marine Parade, Brighton BN2 1TL', commencementDate: '2026-04-06', termMonths: 12,
      rentAmount: 1350, rentFrequency: 'monthly', reviewMechanism: 'none', reviewPercent: null, outgoingsBasis: 'landlord_pays',
      outgoingsAnnual: null, bondAmount: 1557.69, breakNoticeMonths: 2, breakDate: '2026-10-06', renewalTerms: 0, renewalTermMonths: null,
      permittedUse: 'Private residence', makeGood: 'fair_wear', insurance: 'landlord', leaseRef: 'ACM-UK-H-02',
    }),
    risks: ['short_break_notice'], issues: [], flags: {},
  },
  {
    file: 'lease-h-us-01.pdf', ref: 'ACM-US-H-01', country: 'US', leaseType: 'commercial', layout: 'narrative', dateStyle: 'us-long', heldout: true,
    terms: terms('US', {
      landlord: 'Acme Plaza Owners LLC', tenant: 'Harbor Light Yoga LLC', guarantor: 'Rachel Nguyen',
      premises: 'Suite 5, 2200 Ocean Avenue, San Francisco, CA 94127', commencementDate: '2026-06-01', termMonths: 60,
      rentAmount: 6800, rentFrequency: 'monthly', reviewMechanism: 'fixed', reviewPercent: 3, outgoingsBasis: 'proportion',
      outgoingsAnnual: 12000, bondAmount: 13600, breakNoticeMonths: null, breakDate: null, renewalTerms: 1, renewalTermMonths: 60,
      permittedUse: 'Yoga and wellness studio', makeGood: 'tenant_cost', insurance: 'both', leaseRef: 'ACM-US-H-01',
    }),
    risks: ['personal_guarantee', 'uncapped_outgoings', 'make_good_tenant_cost'], issues: [], flags: { personalGuarantee: true },
  },
  {
    file: 'lease-h-us-02.pdf', ref: 'ACM-US-H-02', country: 'US', leaseType: 'residential', layout: 'narrative', dateStyle: 'us-slash', heldout: true,
    terms: terms('US', {
      landlord: 'Acme Urban Living LLC', tenant: 'Samantha Brooks', guarantor: null,
      premises: 'Apt 12C, 480 Congress Street, Boston, MA 02210', commencementDate: '2026-09-01', termMonths: 12,
      rentAmount: 2900, rentFrequency: 'monthly', reviewMechanism: 'none', reviewPercent: null, outgoingsBasis: 'landlord_pays',
      outgoingsAnnual: null, bondAmount: 2900, breakNoticeMonths: null, breakDate: null, renewalTerms: 0, renewalTermMonths: null,
      permittedUse: 'Private residence', makeGood: 'fair_wear', insurance: 'landlord', leaseRef: 'ACM-US-H-02',
    }),
    risks: [], issues: [], flags: {},
  },
]

const SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
function words(n: number): string {
  if (n < 20) return SMALL[n]
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? '-' + SMALL[n % 10] : ''}`
  if (n < 1000) return `${SMALL[Math.floor(n / 100)]} hundred${n % 100 ? ' and ' + words(n % 100) : ''}`
  return `${words(Math.floor(n / 1000))} thousand${n % 1000 ? (n % 1000 < 100 ? ' and ' : ' ') + words(n % 1000) : ''}`
}
const CURRENCY_WORD: Record<Currency, string> = { NZD: 'New Zealand dollars', AUD: 'Australian dollars', GBP: 'pounds', USD: 'dollars' }
function moneyWords(n: number, c: Currency): string {
  const whole = Math.floor(n)
  const cents = Math.round((n - whole) * 100)
  const w = `${words(whole)} ${CURRENCY_WORD[c]}${cents ? ` and ${words(cents)} ${c === 'GBP' ? 'pence' : 'cents'}` : ''}`
  return `${w} (${money(n, c)})`
}

function narrative(s: Spec): string {
  const t = s.terms
  const w = WORDS[s.country]
  const d = (iso: string) => fmtDate(iso, s.dateStyle)
  const m = (n: number) => money(n, t.currency!)
  const mw = (n: number) => moneyWords(n, t.currency!)
  const res = s.leaseType === 'residential'
  const L = res ? 'Landlord' : w.landlord
  const T = res ? 'Tenant' : w.tenant
  const years = t.termMonths! % 12 === 0 ? `${words(t.termMonths! / 12)} (${t.termMonths! / 12}) year${t.termMonths! === 12 ? '' : 's'}` : `${words(t.termMonths!)} (${t.termMonths}) months`
  const opex: Record<Country, string> = { NZ: 'Operating Expenses', AU: 'Outgoings', UK: 'Service Charge', US: 'Operating Expenses and Common Area Maintenance costs' }
  const dep: Record<Country, string> = { NZ: 'bond', AU: 'security deposit', UK: 'deposit', US: 'security deposit' }
  const paras: string[] = []
  paras.push(`THIS ${res ? 'TENANCY AGREEMENT' : 'LEASE'} (reference ${s.ref}) is made on ${d(t.commencementDate!)} BETWEEN ${t.landlord} (the "${L}") AND ${t.tenant} (the "${T}")${t.guarantor ? ` AND ${t.guarantor} (the "Guarantor")` : ''}.`)
  paras.push(`1. PREMISES. The ${L} lets to the ${T} the premises known as ${t.premises} (the "Premises")${res ? ', together with the fixtures and chattels listed in the inventory' : ', together with the right to use the common areas of the building'}.`)
  paras.push(`2. TERM. The ${T} shall hold the Premises for a term of ${years} commencing on ${d(t.commencementDate!)} and ending on ${d(t.expiryDate!)} (the "Term").`)
  const rentWords = `${mw(t.rentAmount!)} per ${t.rentFrequency === 'monthly' ? 'calendar month' : FREQ_WORD[t.rentFrequency!]}`
  paras.push(`3. RENT. The ${T} shall pay to the ${L} rent of ${rentWords}, in advance, the first payment to be made on ${d(t.commencementDate!)} and subsequent payments ${FREQ_ADV[t.rentFrequency!]} thereafter${res ? '' : `, exclusive of ${s.country === 'US' ? 'taxes' : s.country === 'UK' ? 'VAT' : 'GST'}`}. All sums are expressed in ${CURRENCY_WORD[t.currency!]}.`)
  if (t.reviewMechanism === 'fixed') paras.push(`4. ${res ? 'RENT INCREASE' : 'RENT ADJUSTMENT'}. On ${res ? 'the first anniversary of the commencement of the Term' : 'each anniversary of the commencement of the Term'} the rent shall increase by ${words(Math.floor(t.reviewPercent!))}${t.reviewPercent! % 1 ? ' and a half' : ''} per cent (${t.reviewPercent}%) of the rent then payable.${s.flags.ratchet ? ' In no event shall the rent be reduced.' : ''}`)
  else if (t.reviewMechanism === 'cpi') paras.push(`4. RENT ADJUSTMENT. On each anniversary of the commencement of the Term the rent shall be varied in line with the change in the Consumer Price Index published for the preceding twelve months.`)
  else if (t.reviewMechanism === 'market') paras.push(`4. RENT REVIEW. On ${t.reviewDates!.map(d).join(' and ')} the rent shall be reviewed to open market rental value as agreed between the parties or, in default of agreement, as determined by an independent surveyor.${s.flags.ratchet ? ' The reviewed rent shall not be less than the rent payable before the review.' : ''}`)
  else paras.push(`4. RENT INCREASE. The rent is fixed for the whole of the Term and will not be increased.`)
  if (t.outgoingsBasis === 'landlord_pays') paras.push(`5. OUTGOINGS. ${res ? `The ${L} is responsible for the rates, taxes and insurance of the building; the ${T} pays for the utilities consumed at the Premises.` : `The rent is a gross rent: the ${L} bears the ${opex[s.country].toLowerCase()} of the building.`}`)
  else paras.push(`5. ${opex[s.country].toUpperCase()}. In addition to rent the ${T} shall pay ${t.outgoingsBasis === 'proportion' ? `its proportionate share of` : 'the whole of'} the ${opex[s.country]} of the building, estimated at ${mw(t.outgoingsAnnual!)} for the first year of the Term and payable in twelve equal monthly instalments, subject to adjustment when the actual ${opex[s.country].toLowerCase()} are known.${s.flags.capped ? ' The amount payable in any year shall not exceed the amount payable in the previous year by more than four per cent.' : ''}`)
  if (t.bondAmount) paras.push(`6. ${dep[s.country].toUpperCase()}. On or before the commencement of the Term the ${T} shall deposit with the ${L} the sum of ${mw(t.bondAmount)} as ${dep[s.country]}, to be held against any default by the ${T} and refunded without interest at the end of the Term.`)
  else paras.push(`6. ${dep[s.country].toUpperCase()}. No ${dep[s.country]} is required under this lease.`)
  paras.push(`7. USE. The Premises shall be used ${res ? 'as a private residence' : `only for the purpose of ${t.permittedUse!.toLowerCase()}`} and for no other purpose.`)
  if (!res) paras.push(`8. RENEWAL. ${t.renewalTerms ? `Provided the ${T} has observed its obligations, the ${T} may by notice given between six and twelve months before the end of the Term require the ${L} to grant ${t.renewalTerms === 1 ? 'a further lease' : `up to ${words(t.renewalTerms)} further leases`} of ${words(t.renewalTermMonths! / 12)} years each on the same terms.` : `There is no option to renew; any further lease is at the discretion of the ${L}.`}`)
  if (t.breakNoticeMonths) {
    const party = s.flags.landlordBreak ? `The ${L}` : `The ${T}`
    paras.push(`${res ? 8 : 9}. EARLY TERMINATION. ${party} may bring the Term to an end at any time after ${d(t.breakDate!)} by serving on the other party written notice of at least ${words(t.breakNoticeMonths)} month${t.breakNoticeMonths > 1 ? 's' : ''}.`)
  } else paras.push(`${res ? 8 : 9}. EARLY TERMINATION. Neither party may bring the Term to an end early except for a breach of this ${res ? 'agreement' : 'lease'}.`)
  if (s.flags.relocation) paras.push(`${res ? 9 : 10}. RELOCATION. The ${L} may relocate the ${T} to comparable premises in the building on three months' notice.`)
  paras.push(`${res ? 9 : 11}. YIELDING UP. ${t.makeGood === 'tenant_cost' ? `On the expiry of the Term the ${T} shall remove all of its fit-out and alterations and restore the Premises to their original condition at the ${T}'s sole expense, and shall indemnify the ${L} for the cost of any restoration the ${T} fails to complete.` : `On the expiry of the Term the ${T} shall deliver up the Premises in a clean condition, allowing for reasonable wear and tear.`}`)
  paras.push(`${res ? 10 : 12}. INSURANCE. ${t.insurance === 'tenant' ? `The ${T} shall keep the Premises insured against fire and the usual risks and maintain liability cover of not less than ${m(10000000)}.` : t.insurance === 'both' ? `The ${L} shall keep the building insured; the ${T} shall insure its fit-out and contents and carry liability cover of not less than ${m(20000000)}.` : `The ${L} shall keep the building insured against fire and the usual risks. The ${T} is responsible for insuring the ${T}'s own belongings.`}`)
  if (t.guarantor) paras.push(`${res ? 11 : 13}. GUARANTEE. In consideration of the ${L} entering into this ${res ? 'agreement' : 'lease'} the Guarantor personally guarantees the punctual payment of the rent and all other sums and the performance of every obligation of the ${T}, and agrees to be bound jointly and severally with the ${T}.`)
  const law: Record<Country, string> = { NZ: 'New Zealand', AU: 'the State of New South Wales, Australia', UK: 'England and Wales', US: `the State of ${t.premises!.includes(', CA') ? 'California' : 'Massachusetts'}, United States of America` }
  paras.push(`${t.guarantor ? (res ? 12 : 14) : res ? 11 : 13}. LAW. This ${res ? 'agreement' : 'lease'} is governed by the law of ${law[s.country]}.`)
  let k = 0
  const body = paras.map((p) => `<p>${esc(p.replace(/^\d+\. /, () => `${++k}. `))}</p>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS} p { margin: 0 0 9pt; text-align: justify; } .ttl { text-align: center; font-size: 15pt; letter-spacing: .08em; margin: 0 0 16pt; }</style></head><body class="${s.country === 'US' ? 'sans' : ''}">
    <p class="ttl"><b>${res ? 'TENANCY AGREEMENT' : s.country === 'US' ? 'LEASE AGREEMENT' : 'LEASE'}</b></p>
    ${body}
    <table class="sig"><tr><td>${L}<br>${esc(t.landlord!)}</td><td>${T}<br>${esc(t.tenant!)}</td>${t.guarantor ? `<td>Guarantor<br>${esc(t.guarantor)}</td>` : '<td></td>'}</tr></table>
  </body></html>`
}

// ---------------------------------------------------------------------------------------------------------------
// Wording per country

const WORDS: Record<Country, { outgoings: string; bond: string; review: string; makeGood: string; landlord: string; tenant: string; paper: 'A4' | 'Letter' }> = {
  NZ: { outgoings: 'Outgoings', bond: 'Bond', review: 'Rent Review', makeGood: 'Make Good', landlord: 'Landlord', tenant: 'Tenant', paper: 'A4' },
  AU: { outgoings: 'Outgoings', bond: 'Security Deposit', review: 'Rent Review', makeGood: 'Make Good', landlord: 'Lessor', tenant: 'Lessee', paper: 'A4' },
  UK: { outgoings: 'Service Charge', bond: 'Rent Deposit', review: 'Rent Review', makeGood: 'Reinstatement', landlord: 'Landlord', tenant: 'Tenant', paper: 'A4' },
  US: { outgoings: 'CAM Charges', bond: 'Security Deposit', review: 'Rent Escalation', makeGood: 'Restoration', landlord: 'Landlord', tenant: 'Tenant', paper: 'Letter' },
}
const FREQ_WORD: Record<string, string> = { weekly: 'week', fortnightly: 'fortnight', monthly: 'month', quarterly: 'quarter', annual: 'year' }
const FREQ_ADV: Record<string, string> = { weekly: 'weekly', fortnightly: 'fortnightly', monthly: 'monthly', quarterly: 'quarterly', annual: 'annually' }
const MECH: Record<string, string> = { cpi: 'CPI', fixed: 'fixed percentage', market: 'market', none: 'none' }
const USE_WORD: Record<string, string> = { tenant: 'the tenant', landlord: 'the landlord', both: 'the landlord (building) and the tenant (contents and public liability)' }

const CSS = `
  body { font-family: Georgia, 'Times New Roman', serif; font-size: 11pt; color: #1a1a1a; margin: 0; padding: 0; line-height: 1.45; }
  .sans { font-family: Arial, Helvetica, sans-serif; }
  h1 { font-size: 18pt; margin: 0 0 4pt; letter-spacing: .02em; }
  h2 { font-size: 12.5pt; margin: 16pt 0 6pt; text-transform: uppercase; letter-spacing: .04em; }
  .sub { color: #555; font-size: 10pt; margin-bottom: 14pt; }
  table.sched { border-collapse: collapse; width: 100%; margin: 8pt 0 12pt; }
  table.sched td { border: 1px solid #999; padding: 5pt 7pt; vertical-align: top; }
  table.sched td:first-child { width: 36%; font-weight: bold; background: #f1f1f1; }
  table.plain td { padding: 3pt 8pt 3pt 0; vertical-align: top; }
  table.plain td:first-child { width: 34%; font-weight: bold; }
  ol.cl { padding-left: 0; list-style: none; }
  ol.cl > li { margin: 0 0 7pt; padding-left: 28pt; position: relative; }
  ol.cl > li > b { display: block; margin-bottom: 2pt; margin-left: -28pt; }
  table.sig { margin-top: 26pt; width: 100%; border-collapse: separate; border-spacing: 30pt 0; page-break-inside: avoid; }
  table.sig td { border-top: 1px solid #333; padding-top: 4pt; font-size: 10pt; width: 33%; vertical-align: top; }
  .box { border: 1px solid #333; padding: 8pt 10pt; margin: 10pt 0; }
  .ref { float: right; font-size: 9.5pt; color: #444; }
  .teal { color: #1f5f5b; }
  .rule { border-top: 2px solid #1f5f5b; margin: 6pt 0 10pt; }
  .pb { page-break-before: always; }
`

function reviewClause(s: Spec, d: (iso: string) => string): string {
  const t = s.terms
  const w = WORDS[s.country]
  if (t.reviewMechanism === 'none' || !t.reviewMechanism) return `There is no ${w.review.toLowerCase()} during the Term.`
  const dates = (t.reviewDates ?? []).map(d).join(', ')
  let body = ''
  if (t.reviewMechanism === 'fixed') {
    body = `On each ${w.review} Date (${dates}) the ${s.country === 'US' ? 'Base Rent' : 'Rent'} shall increase by ${t.reviewPercent}% of the ${s.country === 'US' ? 'Base Rent' : 'Rent'} payable immediately before that date.`
  } else if (t.reviewMechanism === 'cpi') {
    const index = s.country === 'UK' ? 'the Retail Prices Index' : s.country === 'US' ? 'the Consumer Price Index for All Urban Consumers (CPI-U)' : 'the Consumers Price Index (All Groups)'
    body = `On each ${w.review} Date (${dates}) the Rent shall be adjusted in proportion to the movement in ${index} over the period since the later of the Commencement Date and the previous ${w.review} Date.`
  } else {
    body = `On each ${w.review} Date (${dates}) the Rent shall be reviewed to the current market rent of the Premises, determined by agreement or, failing agreement within two months, by a registered valuer acting as an expert.`
  }
  if (s.flags.ratchet) {
    body += ` The Rent payable from a ${w.review} Date shall in no case be less than the Rent payable immediately before that date.`
  }
  return body
}

function outgoingsClause(s: Spec, m: (n: number) => string): string {
  const t = s.terms
  const w = WORDS[s.country]
  const name = w.outgoings
  if (t.outgoingsBasis === 'landlord_pays') {
    return `The Rent is inclusive of ${name.toLowerCase()}. The ${w.landlord} is responsible for rates, building insurance and the ${name.toLowerCase()} of the building.`
  }
  const share = t.outgoingsBasis === 'proportion' ? `the ${w.tenant}'s proportion of` : 'all'
  let body = `The ${w.tenant} shall pay ${share} the ${name.toLowerCase()} of the building, including rates, building insurance premiums, cleaning and maintenance of common areas, and management fees. The ${name} estimate for the first year of the Term is ${m(t.outgoingsAnnual!)} per annum, payable monthly in advance by equal instalments, with an annual reconciliation against actual ${name.toLowerCase()}.`
  if (s.flags.capped) {
    body += ` The ${w.tenant}'s liability for ${name.toLowerCase()} in any year is capped at the previous year's ${name.toLowerCase()} increased by 4%.`
  }
  return body
}

function breakClause(s: Spec, d: (iso: string) => string): string {
  const t = s.terms
  const w = WORDS[s.country]
  if (!t.breakNoticeMonths) return `Neither party may terminate this ${s.leaseType === 'residential' ? 'agreement' : 'lease'} before the Expiry Date other than for breach.`
  const party = s.flags.landlordBreak ? (s.country === 'UK' && s.leaseType === 'commercial' ? 'Either party' : `The ${w.landlord}`) : `The ${w.tenant}`
  const notice = t.breakNoticeMonths === 1 ? 'one month' : t.breakNoticeMonths === 2 && s.country === 'US' ? '60 days' : t.breakNoticeMonths === 3 && s.country === 'US' ? '90 days' : `${t.breakNoticeMonths} months`
  let body = `${party} may terminate this ${s.leaseType === 'residential' ? 'agreement' : 'lease'} on or after ${d(t.breakDate!)} by giving the other party not less than ${notice}' written notice`
  if (s.flags.landlordBreak && s.leaseType === 'commercial' && s.country !== 'UK') body += ' if it intends to redevelop or refurbish the building'
  body += '.'
  if (s.leaseType === 'residential' && s.country === 'US') body += ' A tenant exercising this option shall pay an early termination fee equal to one month of Rent.'
  return body
}

function guaranteeClause(s: Spec): string {
  const t = s.terms
  const w = WORDS[s.country]
  if (!t.guarantor) return ''
  if (s.flags.personalGuarantee) {
    return `${t.guarantor} (the Guarantor) personally guarantees to the ${w.landlord} the payment of the Rent and all other money payable by the ${w.tenant} and the performance of the ${w.tenant}'s obligations, and shall be liable jointly and severally with the ${w.tenant}.`
  }
  return `${t.guarantor} (the Guarantor) guarantees to the ${w.landlord} the payment of the Rent and the performance of the ${w.tenant}'s obligations under this lease.`
}

function makeGoodClause(s: Spec): string {
  const t = s.terms
  const w = WORDS[s.country]
  if (t.makeGood === 'tenant_cost') {
    return `At the end of the Term the ${w.tenant} shall at its own cost remove its fit-out, alterations and signage and reinstate the Premises to the condition recorded in the Premises Condition Report, repairing all damage, and shall pay the ${w.landlord}'s costs of any ${w.makeGood.toLowerCase()} work the ${w.tenant} fails to carry out.`
  }
  return `At the end of the Term the ${w.tenant} shall return the Premises clean and tidy and in the condition recorded at the start of the Term, fair wear and tear excepted.`
}

function insuranceClause(s: Spec): string {
  const t = s.terms
  const w = WORDS[s.country]
  switch (t.insurance) {
    case 'tenant':
      return `The ${w.tenant} shall insure the Premises and the ${w.tenant}'s property for full replacement value and hold public liability insurance of not less than ${SYMBOL[t.currency!]}10,000,000, and shall produce certificates of currency on request.`
    case 'both':
      return `The ${w.landlord} shall insure the building for full replacement value. The ${w.tenant} shall insure its contents and fit-out and hold public liability insurance of not less than ${SYMBOL[t.currency!]}20,000,000, naming the ${w.landlord} as an interested party.`
    default:
      return `The ${w.landlord} shall insure the building for full replacement value${s.leaseType === 'commercial' ? ` and the ${w.tenant} shall reimburse the premium as part of the ${w.outgoings.toLowerCase()}` : ''}. The ${w.tenant} is responsible for insuring its own contents.`
  }
}

function renewalClause(s: Spec): string {
  const t = s.terms
  const w = WORDS[s.country]
  if (!t.renewalTerms) return `The ${w.tenant} has no right of renewal. Any new lease at the end of the Term is at the ${w.landlord}'s discretion.`
  const each = t.renewalTermMonths! % 12 === 0 ? `${t.renewalTermMonths! / 12} years` : `${t.renewalTermMonths} months`
  return `The ${w.tenant} has ${t.renewalTerms === 1 ? 'one right of renewal' : `${t.renewalTerms} rights of renewal`} of ${each} each, exercisable by written notice given not less than six months and not more than twelve months before the Expiry Date, provided the ${w.tenant} is not in breach.`
}

const relocationClause = (s: Spec) =>
  s.flags.relocation
    ? `The ${WORDS[s.country].landlord} may, on not less than three months' written notice, relocate the ${WORDS[s.country].tenant} to alternative premises in the building of comparable size, and the ${WORDS[s.country].tenant} shall vacate the Premises on the date stated in the notice.`
    : ''

// ---------------------------------------------------------------------------------------------------------------
// Layouts

function termLine(s: Spec, d: (iso: string) => string): string {
  const t = s.terms
  const years = t.termMonths! % 12 === 0 ? `${t.termMonths! / 12} year${t.termMonths! === 12 ? '' : 's'}` : `${t.termMonths} months`
  return `${years} from the Commencement Date, ending on ${d(t.expiryDate!)}`
}

function rentLine(s: Spec, m: (n: number) => string): string {
  const t = s.terms
  if (s.leaseType === 'residential') return `${m(t.rentAmount!)} per ${FREQ_WORD[t.rentFrequency!]}, payable ${FREQ_ADV[t.rentFrequency!]} in advance`
  return `${m(t.annualRent!)} per annum plus ${s.country === 'US' ? 'applicable taxes' : s.country === 'UK' ? 'VAT' : 'GST'}, payable by ${FREQ_ADV[t.rentFrequency!]} instalments of ${m(t.rentAmount!)} in advance`
}

function commercial(s: Spec): string {
  const t = s.terms
  const w = WORDS[s.country]
  const d = (iso: string) => fmtDate(iso, s.dateStyle)
  const m = (n: number) => money(n, t.currency!)
  const currencyNote: Record<Country, string> = {
    NZ: 'All amounts are in New Zealand dollars (NZD).',
    AU: 'All amounts are in Australian dollars (AUD).',
    UK: 'All amounts are in pounds sterling (GBP).',
    US: 'All amounts are in United States dollars (USD).',
  }
  const title: Record<Country, string> = { NZ: 'Deed of Lease', AU: 'Lease of Commercial Premises', UK: 'Lease of Business Premises', US: 'Commercial Lease Agreement' }
  const schedTitle: Record<Country, string> = { NZ: 'First Schedule', AU: 'Reference Schedule', UK: 'Particulars', US: 'Basic Lease Information' }
  const law: Record<Country, string> = {
    NZ: 'This Deed is governed by the laws of New Zealand and the Property Law Act 2007.',
    AU: `This Lease is governed by the laws of the State of ${t.premises!.match(/\b(NSW|VIC|QLD)\b/)?.[1] === 'VIC' ? 'Victoria' : t.premises!.includes('QLD') ? 'Queensland' : 'New South Wales'}, Australia.`,
    UK: 'This Lease is governed by the law of England and Wales. Sections 24 to 28 of the Landlord and Tenant Act 1954 are excluded.',
    US: `This Lease is governed by the laws of the State of ${t.premises!.includes(', GA') ? 'Georgia' : t.premises!.includes(', TX') ? 'Texas' : 'Colorado'}, United States of America.`,
  }
  const rows: [string, string][] = [
    [w.landlord, t.landlord!],
    [w.tenant, t.tenant!],
    ...(t.guarantor ? [['Guarantor', t.guarantor] as [string, string]] : []),
    ['Premises', t.premises!],
    ['Commencement Date', d(t.commencementDate!)],
    ['Term', termLine(s, d)],
    ['Expiry Date', d(t.expiryDate!)],
    [s.country === 'US' ? 'Base Rent' : 'Annual Rent', rentLine(s, m)],
    [`${w.review} Dates`, t.reviewDates?.length ? `${t.reviewDates.map(d).join(', ')} (${MECH[t.reviewMechanism!]}${t.reviewMechanism === 'fixed' ? `, ${t.reviewPercent}%` : ''})` : 'None'],
    [w.outgoings, t.outgoingsBasis === 'landlord_pays' ? `Included in the Rent (gross lease)` : `${t.outgoingsBasis === 'proportion' ? `${w.tenant}'s proportion` : `Paid in full by the ${w.tenant}`}; estimate ${m(t.outgoingsAnnual!)} per annum`],
    [w.bond, t.bondAmount ? `${m(t.bondAmount)}${s.country === 'AU' ? ' (bank guarantee)' : ''}` : 'None'],
    ['Permitted Use', t.permittedUse!],
    ['Renewal', t.renewalTerms ? `${t.renewalTerms} further term${t.renewalTerms > 1 ? 's' : ''} of ${t.renewalTermMonths! / 12} years` : 'No right of renewal'],
    ['Lease Reference', s.ref],
  ]
  const clauses: [string, string][] = [
    ['Grant and Term', `The ${w.landlord} leases the Premises to the ${w.tenant} for the Term, commencing on the Commencement Date and expiring on the Expiry Date, on the terms of this ${s.country === 'NZ' ? 'Deed' : 'Lease'}.`],
    ['Rent', `The ${w.tenant} shall pay the ${s.country === 'US' ? 'Base Rent' : 'Rent'} ${FREQ_ADV[t.rentFrequency!]} in advance on the ${s.country === 'UK' && t.rentFrequency === 'quarterly' ? 'usual quarter days' : 'first day of each period'}, without deduction or set-off. ${currencyNote[s.country]}`],
    [w.review, reviewClause(s, d)],
    [w.outgoings, outgoingsClause(s, m)],
    [w.bond, t.bondAmount ? `On signing, the ${w.tenant} shall provide ${s.country === 'AU' ? 'an unconditional bank guarantee' : `a ${w.bond.toLowerCase()}`} of ${m(t.bondAmount)}, to be held as security for the ${w.tenant}'s obligations and returned within 30 days after the end of the Term less any sums properly deducted.` : `No ${w.bond.toLowerCase()} is payable under this lease.`],
    ['Permitted Use', `The ${w.tenant} shall use the Premises only for the Permitted Use: ${t.permittedUse!.toLowerCase()}. Any change of use requires the ${w.landlord}'s prior written consent.`],
    ['Renewal', renewalClause(s)],
    ['Early Termination', breakClause(s, d)],
    ...(s.flags.relocation ? [['Relocation', relocationClause(s)] as [string, string]] : []),
    [w.makeGood, makeGoodClause(s)],
    ['Insurance', insuranceClause(s)],
    ...(t.guarantor ? [['Guarantee', guaranteeClause(s)] as [string, string]] : []),
    ['Governing Law', law[s.country]],
  ]
  const sched = rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')
  const body = clauses.map(([h, c], i) => `<li><b>${i + 1}. ${esc(h)}</b>${esc(c)}</li>`).join('')
  const sans = s.country === 'US' || s.country === 'AU' ? 'sans' : ''
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body class="${sans}">
    <span class="ref">${s.country === 'NZ' ? 'Deed' : 'Lease'} reference ${esc(s.ref)}</span>
    <h1>${title[s.country]}</h1>
    <div class="sub">${esc(t.landlord!)} to ${esc(t.tenant!)} &middot; ${esc(t.premises!)}</div>
    <div class="rule"></div>
    <h2>${schedTitle[s.country]}</h2>
    <table class="sched">${sched}</table>
    <h2 class="${s.country === 'UK' ? 'pb' : ''}">${s.country === 'US' ? 'Lease Terms' : 'Operative Provisions'}</h2>
    <ol class="cl">${body}</ol>
    <table class="sig"><tr><td>Signed for the ${w.landlord}<br>${esc(t.landlord!)}</td><td>Signed for the ${w.tenant}<br>${esc(t.tenant!)}</td>${t.guarantor ? `<td>Signed by the Guarantor<br>${esc(t.guarantor)}</td>` : '<td></td>'}</tr></table>
  </body></html>`
}

function residential(s: Spec): string {
  const t = s.terms
  const w = WORDS[s.country]
  const d = (iso: string) => fmtDate(iso, s.dateStyle)
  const m = (n: number) => money(n, t.currency!)
  const title: Record<Country, string> = {
    NZ: 'Residential Tenancy Agreement',
    AU: 'Residential Tenancy Agreement',
    UK: 'Assured Shorthold Tenancy Agreement',
    US: 'Residential Lease Agreement',
  }
  const intro: Record<Country, string> = {
    NZ: 'This agreement is made under the Residential Tenancies Act 1986 (New Zealand).',
    AU: `This agreement is made under the residential tenancies legislation of ${t.premises!.includes('QLD') ? 'Queensland' : t.premises!.includes('VIC') ? 'Victoria' : 'New South Wales'}, Australia.`,
    UK: 'This is an assured shorthold tenancy under the Housing Act 1988, governed by the law of England and Wales.',
    US: `This lease is governed by the laws of the State of ${t.premises!.includes(', NY') ? 'New York' : t.premises!.includes(', OR') ? 'Oregon' : 'Illinois'}.`,
  }
  const bondWord = s.country === 'NZ' || s.country === 'AU' ? 'Bond' : s.country === 'UK' ? 'Deposit' : 'Security Deposit'
  const rentWord = s.country === 'UK' && t.rentFrequency === 'monthly' ? `${m(t.rentAmount!)} per calendar month` : `${m(t.rentAmount!)} per ${FREQ_WORD[t.rentFrequency!]}`
  const rows: [string, string][] = [
    [s.country === 'AU' ? 'Lessor / Agent' : 'Landlord', t.landlord!],
    [s.country === 'AU' ? 'Tenant(s)' : 'Tenant', t.tenant!],
    ...(t.guarantor ? [[s.country === 'US' ? 'Co-signer (Guarantor)' : 'Guarantor', t.guarantor] as [string, string]] : []),
    ['Address of the premises', t.premises!],
    ['Start date', d(t.commencementDate!)],
    ['Type of tenancy', `Fixed term of ${t.termMonths} months`],
    ['End date', d(t.expiryDate!)],
    ['Rent', `${rentWord}, payable ${FREQ_ADV[t.rentFrequency!]} in advance`],
    [bondWord, `${m(t.bondAmount!)}${s.country === 'NZ' ? ' (to be lodged with Tenancy Services)' : s.country === 'UK' ? ' (protected in a government-approved scheme)' : ''}`],
    ['Use', t.permittedUse!],
    ['Reference', s.ref],
  ]
  const clauses: [string, string][] = [
    ['Term', `The landlord lets the premises to the tenant for a fixed term starting on ${d(t.commencementDate!)} and ending on ${d(t.expiryDate!)}.`],
    ['Rent', `The tenant shall pay rent of ${rentWord} in advance, by bank transfer to the account notified by the landlord. ${t.reviewMechanism === 'fixed' ? `On ${t.reviewDates!.map(d).join(' and ')} the rent increases by ${t.reviewPercent}%.` : 'The rent will not be increased during the fixed term.'}`],
    [bondWord, `The tenant shall pay a ${bondWord.toLowerCase()} of ${m(t.bondAmount!)} before moving in. It will be refunded at the end of the tenancy less any amounts lawfully deducted for unpaid rent or damage beyond fair wear and tear.`],
    ['Outgoings', `The landlord pays the council rates, building insurance and any body corporate levies. The tenant pays for electricity, gas, internet and any metered water charges.`],
    ['Ending the tenancy early', breakClause(s, d)],
    ['Use of the premises', `The premises are to be used as a ${t.permittedUse!.toLowerCase()} only, by the tenant and the occupants listed in this agreement.`],
    ['Condition at the end', makeGoodClause(s)],
    ['Insurance', insuranceClause(s)],
    ...(t.guarantor ? [['Guarantee', guaranteeClause(s)] as [string, string]] : []),
    ['Law', intro[s.country]],
  ]
  const sched = rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')
  const body = clauses.map(([h, c], i) => `<li><b>${i + 1}. ${esc(h)}</b>${esc(c)}</li>`).join('')
  const sans = s.country === 'NZ' || s.country === 'US' ? 'sans' : ''
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body class="${sans}">
    <span class="ref">Agreement ${esc(s.ref)}</span>
    <h1>${title[s.country]}</h1>
    <div class="sub">${esc(intro[s.country])}</div>
    <div class="rule"></div>
    <h2>Details of the tenancy</h2>
    <table class="sched">${sched}</table>
    <h2>Terms</h2>
    <ol class="cl">${body}</ol>
    <table class="sig"><tr><td>Landlord / agent<br>${esc(t.landlord!)}</td><td>Tenant<br>${esc(t.tenant!)}</td>${t.guarantor ? `<td>Guarantor<br>${esc(t.guarantor)}</td>` : '<td></td>'}</tr></table>
  </body></html>`
}

// ---------------------------------------------------------------------------------------------------------------
// The billing system's invoices, with planted mismatches

interface InvoiceRow {
  row: number
  invoiceNumber: string
  leaseRef: string
  description: string
  kind: string
  amount: number
  currency: string
  dueDate: string
  period: string
}

interface PlantedMismatch {
  leaseRef: string
  status: 'amount_differs' | 'missing' | 'unexpected'
  kind: string
  dueDate: string
  note: string
}

function invoices(specs: Spec[], charges: Map<string, Charge[]>): { rows: InvoiceRow[]; planted: PlantedMismatch[] } {
  const rows: InvoiceRow[] = []
  const planted: PlantedMismatch[] = []
  let n = 1000
  const push = (ref: string, c: Charge, amount = c.amount, description = c.description) => {
    rows.push({ row: rows.length + 2, invoiceNumber: `INV-${++n}`, leaseRef: ref, description, kind: c.kind, amount, currency: c.currency, dueDate: c.dueDate, period: c.period })
  }
  for (const s of specs) {
    const list = charges.get(s.ref)!
    const rent = list.filter((c) => c.kind === 'rent')
    const outgoings = list.filter((c) => c.kind === 'outgoings')
    for (const c of list) {
      if (s.ref === 'ACM-NZ-C-01' && c === rent[3]) {
        push(s.ref, c, 6700)
        planted.push({ leaseRef: s.ref, status: 'amount_differs', kind: c.kind, dueDate: c.dueDate, note: 'month 4 rent invoiced at the old rate' })
        continue
      }
      if (s.ref === 'ACM-AU-C-01' && c === outgoings[1]) {
        planted.push({ leaseRef: s.ref, status: 'missing', kind: c.kind, dueDate: c.dueDate, note: 'month 2 outgoings never invoiced' })
        continue
      }
      if (s.ref === 'ACM-US-C-01' && c.kind === 'bond') {
        planted.push({ leaseRef: s.ref, status: 'missing', kind: c.kind, dueDate: c.dueDate, note: 'security deposit never invoiced' })
        continue
      }
      if (s.ref === 'ACM-US-C-03' && c === rent[2]) {
        planted.push({ leaseRef: s.ref, status: 'missing', kind: c.kind, dueDate: c.dueDate, note: 'month 3 rent never invoiced' })
        continue
      }
      if (s.ref === 'ACM-NZ-R-02' && c === rent[5]) {
        push(s.ref, c, 1250)
        planted.push({ leaseRef: s.ref, status: 'amount_differs', kind: c.kind, dueDate: c.dueDate, note: 'one fortnight invoiced at 1,250' })
        continue
      }
      if (s.ref === 'ACM-AU-R-01' && c.kind === 'bond') {
        push(s.ref, c, 3000)
        planted.push({ leaseRef: s.ref, status: 'amount_differs', kind: c.kind, dueDate: c.dueDate, note: 'bond invoiced at 3,000 instead of 3,400' })
        continue
      }
      push(s.ref, c)
      if (s.ref === 'ACM-UK-C-01' && c === rent[1]) {
        push(s.ref, c)
        planted.push({ leaseRef: s.ref, status: 'unexpected', kind: c.kind, dueDate: c.dueDate, note: 'quarter 2 rent invoiced twice' })
      }
    }
    if (s.ref === 'ACM-UK-R-01') {
      const c: Charge = { kind: 'rent', description: 'End of tenancy cleaning fee', amount: 180, currency: 'GBP', dueDate: '2026-04-12', period: 'one-off' }
      rows.push({ row: rows.length + 2, invoiceNumber: `INV-${++n}`, leaseRef: s.ref, description: c.description, kind: 'other', amount: c.amount, currency: c.currency, dueDate: c.dueDate, period: c.period })
      planted.push({ leaseRef: s.ref, status: 'unexpected', kind: 'other', dueDate: c.dueDate, note: 'a cleaning fee the agreement does not provide for' })
    }
  }
  return { rows, planted }
}

const csvCell = (v: unknown) => {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// ---------------------------------------------------------------------------------------------------------------

async function renderSet(specs: Spec[], dir: string) {
  mkdirSync(dir, { recursive: true })
  const browser = await chromium.launch({ executablePath: CHROMIUM })
  const page = await browser.newPage()
  const charges = new Map<string, Charge[]>()
  const truth = []
  for (const s of specs) {
    const html = s.heldout ? narrative(s) : s.leaseType === 'commercial' ? commercial(s) : residential(s)
    await page.setContent(html, { waitUntil: 'load' })
    await page.pdf({
      path: join(dir, s.file),
      format: WORDS[s.country].paper,
      printBackground: true,
      margin: { top: '22mm', bottom: '22mm', left: '20mm', right: '20mm' },
    })
    const schedule = scheduleCharges(s.terms)
    charges.set(s.ref, schedule)
    truth.push({ file: s.file, ref: s.ref, country: s.country, leaseType: s.leaseType, layout: s.layout, dateStyle: s.dateStyle, fields: s.terms, risks: s.risks, issues: s.issues, charges: schedule, note: s.note })
    process.stdout.write('.')
  }
  await browser.close()
  const { rows, planted } = invoices(specs, charges)
  const header = ['row', 'invoice_number', 'lease_ref', 'description', 'kind', 'amount', 'currency', 'due_date', 'period']
  const csv = [header.join(','), ...rows.map((r) => [r.row, r.invoiceNumber, r.leaseRef, r.description, r.kind, r.amount.toFixed(2), r.currency, r.dueDate, r.period].map(csvCell).join(','))].join('\n')
  writeFileSync(join(dir, 'invoices.csv'), csv + '\n')
  writeFileSync(join(dir, 'truth.json'), JSON.stringify({ leases: truth, reconciliation: planted }, null, 2) + '\n')
  console.log(`\nWrote ${specs.length} leases, ${rows.length} invoices and ${planted.length} planted mismatches to ${dir}`)
}

async function main() {
  await renderSet(S, OUT_DIR)
  await renderSet(H, join(OUT_DIR, 'heldout'))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
