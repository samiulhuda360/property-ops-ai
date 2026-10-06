// Parsing and normalising the values found on documents: NZ dates, money, GST numbers, names.
// The same normalisers decide whether two values are "the same" for validation, confidence and evaluation.

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}
const MONTH_NAME = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'

function isoFrom(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null
  return date.toISOString().slice(0, 10)
}

const DATE_PATTERNS: { re: RegExp; iso: (m: RegExpMatchArray) => string | null }[] = [
  { re: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/, iso: (m) => isoFrom(+m[1], +m[2], +m[3]) },
  // NZ order: day first.
  { re: /\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/, iso: (m) => isoFrom(+m[3], +m[2], +m[1]) },
  {
    re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_NAME}\\.?,?\\s+(\\d{4})\\b`, 'i'),
    iso: (m) => isoFrom(+m[3], MONTHS[m[2].toLowerCase().slice(0, 3)], +m[1]),
  },
  {
    re: new RegExp(`\\b${MONTH_NAME}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'i'),
    iso: (m) => isoFrom(+m[3], MONTHS[m[1].toLowerCase().slice(0, 3)], +m[2]),
  },
]

/** Every date in the text, in order, as ISO strings. */
export function findDates(text: string): { iso: string; index: number }[] {
  const found: { iso: string; index: number }[] = []
  for (const { re, iso } of DATE_PATTERNS) {
    const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
    for (const m of text.matchAll(global)) {
      const value = iso(m)
      if (value && !found.some((f) => f.index === m.index)) found.push({ iso: value, index: m.index ?? 0 })
    }
  }
  return found.sort((a, b) => a.index - b.index)
}

/** The first date in the text as ISO, or null. Accepts 12/09/2026, 12 Sep 2026, 12 September 2026, 2026-09-12. */
export function parseDate(text: string | null | undefined): string | null {
  if (!text) return null
  return findDates(text)[0]?.iso ?? null
}

const MONEY_RE = /-?\$?\s?(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(?!\d)/g

/** Every amount with cents in the text ("$1,234.56", "64.80", "-251.20"), in order. */
export function findMoney(text: string): number[] {
  return [...text.matchAll(MONEY_RE)].map((m) => {
    const value = Number(`${m[1].replace(/,/g, '')}.${m[2]}`)
    return m[0].trim().startsWith('-') ? -value : value
  })
}

/** Parses "$1,234.56", "1234.5", "1,234" or a number; null when there is no amount. */
export function parseMoney(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) / 100 : null
  if (typeof value !== 'string') return null
  const m = value.replace(/\s/g, '').match(/-?\$?(\d[\d,]*(?:\.\d+)?)/)
  if (!m) return null
  const n = Number(m[1].replace(/,/g, ''))
  if (!Number.isFinite(n)) return null
  return Math.round((value.trim().startsWith('-') ? -n : n) * 100) / 100
}

export const toCents = (amount: number) => Math.round(amount * 100)

export const formatMoney = (amount: number) =>
  `$${amount.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${SHORT_MONTHS[m - 1]} ${y}`
}

export const digitsOnly = (text: string) => text.replace(/\D/g, '')

/** Invoice numbers compare without spaces and case ("ap-2296 " is "AP-2296"); hyphens and letters still count. */
export const normaliseInvoiceNumber = (text: string) => text.replace(/\s+/g, '').toUpperCase()

const COMPANY_SUFFIXES = new Set(['ltd', 'limited', 'co', 'company', 'nz', 'inc', 'the'])

/** "Acme Cleaning Co Ltd." -> "acme cleaning" (case, punctuation and legal suffixes removed). */
export function normaliseCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !COMPANY_SUFFIXES.has(t))
    .join(' ')
}

/** "Liam O'Brien" -> "liam obrien". */
export const normalisePersonName = (name: string) =>
  name
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Optimal string alignment distance (Levenshtein plus adjacent transpositions). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  const rows = a.length + 1
  const cols = b.length + 1
  const d: number[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

/** Tokens match when equal, or (for words of 5+ letters) one typo apart. */
export const fuzzyTokenMatch = (a: string, b: string) =>
  a === b || (a.length >= 5 && b.length >= 5 && !/\d/.test(a + b) && editDistance(a, b) <= 1)
