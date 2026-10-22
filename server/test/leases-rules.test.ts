import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sameTermValue } from '../src/leases/compare'
import { datesIn, detectCountry, detectLeaseType, extractLeaseRules, moneyIn, parseLeaseDate, rulesTerms, scheduleRows } from '../src/leases/rules'
import { locateQuote, pdfPages, sentenceAround } from '../src/leases/text'
import { TERM_FIELDS } from '../src/leases/types'

const DATA = resolve(__dirname, '../../data/leases')
const truth = JSON.parse(readFileSync(join(DATA, 'truth.json'), 'utf8')) as { leases: { file: string; country: string; leaseType: string; fields: Record<string, unknown> }[] }

describe('dates by country', () => {
  it('reads words, ordinals and day-first figures outside the US', () => {
    expect(parseLeaseDate('25 March 2026', 'NZ')).toBe('2026-03-25')
    expect(parseLeaseDate('24th June 2026', 'UK')).toBe('2026-06-24')
    expect(parseLeaseDate('01/11/2025', 'NZ')).toBe('2025-11-01')
    expect(parseLeaseDate('15/09/2025', 'AU')).toBe('2025-09-15')
  })
  it('reads month-first figures and "January 1, 2026" in the US', () => {
    expect(parseLeaseDate('11/15/2025', 'US')).toBe('2025-11-15')
    expect(parseLeaseDate('January 1, 2026', 'US')).toBe('2026-01-01')
    expect(parseLeaseDate('13/01/2026', 'US')).toBeNull()
  })
  it('rejects impossible dates', () => {
    expect(parseLeaseDate('31 February 2026', 'NZ')).toBeNull()
    expect(parseLeaseDate('some day', 'NZ')).toBeNull()
  })
  it('lists every date in a line', () => {
    expect(datesIn('01/11/2027, 01/11/2028 (fixed percentage, 3%)', 'NZ')).toEqual(['2027-11-01', '2028-11-01'])
  })
})

describe('money and detection', () => {
  it('reads pounds, dollars and prefixed currencies', () => {
    expect(moneyIn('£10,500.00 per annum')).toBe(10500)
    expect(moneyIn('NZ$ 7,000 a month')).toBe(7000)
    expect(moneyIn('no amount')).toBeNull()
  })
  it('detects the country and the lease type from the wording', () => {
    expect(detectCountry('This Lease is governed by the law of England and Wales. £1,000')).toBe('UK')
    expect(detectCountry('Acme Pty Ltd, Parramatta NSW 2150, Australia')).toBe('AU')
    expect(detectCountry('Acme Realty LLC, Atlanta, GA 30326, United States of America')).toBe('US')
    expect(detectCountry('Residential Tenancies Act 1986, Auckland, New Zealand')).toBe('NZ')
    expect(detectLeaseType('Residential Tenancy Agreement')).toBe('residential')
    expect(detectLeaseType('Deed of Lease')).toBe('commercial')
  })
})

describe('schedule rows', () => {
  it('joins wrapped lines and keeps the longest label', () => {
    const rows = scheduleRows([{ num: 1, text: 'PARTICULARS\nRent Deposit £10,500.00\nTerm 10 years from the Commencement Date, ending on 24\nMarch 2036\nOPERATIVE PROVISIONS\nRent something else' }])
    expect(rows.map((r) => r.label)).toEqual(['Rent Deposit', 'Term'])
    expect(rows[1].value).toBe('10 years from the Commencement Date, ending on 24 March 2036')
  })
})

describe('quotes', () => {
  const pages = [
    { num: 1, text: '9. Insurance\nThe Landlord shall insure the building for full\nreplacement value.' },
    { num: 2, text: 'Signed for the Landlord\nThe Tenant is responsible for its own contents.' },
  ]
  it('cuts a sentence at the clause heading and finds its page', () => {
    const raw = pages.map((p) => p.text).join('\n')
    const index = raw.indexOf('The Landlord shall')
    const quote = sentenceAround(raw, index, 10)
    expect(quote).toBe('The Landlord shall insure the building for full replacement value.')
    expect(locateQuote(pages, quote)?.page).toBe(1)
  })
  it('locates a quote that was shortened or runs over a page break', () => {
    expect(locateQuote(pages, 'The Landlord shall insure the building for full replacement value. The Tenant is responsible for its own contents.')?.page).toBe(1)
    expect(locateQuote(pages, 'nothing like this appears anywhere in the lease text')).toBeNull()
  })
})

describe('rules on the sample leases', () => {
  it('reads every term of a New Zealand deed and a US residential lease, with a page for each', async () => {
    for (const file of ['lease-c-nz-01.pdf', 'lease-r-us-02.pdf']) {
      const doc = truth.leases.find((l) => l.file === file)!
      const pages = await pdfPages(readFileSync(join(DATA, file)))
      const { country, leaseType, hits } = extractLeaseRules(pages)
      expect(country).toBe(doc.country)
      expect(leaseType).toBe(doc.leaseType)
      const terms = rulesTerms(hits) as unknown as Record<string, unknown>
      for (const f of TERM_FIELDS) expect(sameTermValue(f, doc.fields[f], terms[f]), `${file} ${f}: ${JSON.stringify(terms[f])}`).toBe(true)
      for (const f of TERM_FIELDS) {
        if (terms[f] !== null && hits[f].quote) expect(hits[f].page, `${file} ${f} page`).toEqual(expect.any(Number))
      }
    }
  })
})
