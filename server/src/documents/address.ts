// Address normalising and fuzzy matching against the portfolio.
// "Flat 3, 41 Arthur St, Onehunga, Auckland 1061" and "3/41 Arthur Street" are the same property.
import { fuzzyTokenMatch } from './parse'

const ABBREVIATIONS: Record<string, string> = {
  rd: 'road',
  st: 'street',
  str: 'street',
  ave: 'avenue',
  av: 'avenue',
  cres: 'crescent',
  cr: 'crescent',
  tce: 'terrace',
  terr: 'terrace',
  dr: 'drive',
  drv: 'drive',
  ln: 'lane',
  pl: 'place',
  mt: 'mount',
  hwy: 'highway',
  pde: 'parade',
  cl: 'close',
  ct: 'court',
  gr: 'grove',
  sq: 'square',
  bvd: 'boulevard',
  blvd: 'boulevard',
}

const UNIT_WORDS = /\b(flat|unit|apartment|apt|house|level|lot)\b/g

/** Lower case, no punctuation, abbreviations expanded, city/country/postcode dropped: "3 41 arthur street onehunga". */
export function normaliseAddress(address: string): string {
  const tokens = address
    .toLowerCase()
    .replace(/new zealand/g, ' ')
    .replace(UNIT_WORDS, ' ')
    .replace(/[/]/g, ' ')
    .replace(/(\d)([a-z])\b/g, '$1 $2') // 14a -> 14 a
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => ABBREVIATIONS[t] ?? t)
    .filter((t) => t !== 'auckland' && t !== 'nz')
  // A trailing 4-digit token is a postcode.
  while (tokens.length > 1 && /^\d{4}$/.test(tokens[tokens.length - 1])) tokens.pop()
  return tokens.join(' ')
}

export interface PropertyRef {
  id: number
  code: string | null
  address: string
  suburb: string
}

export interface PropertyMatch<P extends PropertyRef = PropertyRef> {
  property: P
  /** 1 = street and suburb agree, 0.9 = street agrees and no suburb was given. */
  score: number
}

const isNumber = (t: string) => /^\d+$/.test(t)

function covers(candidate: string[], wanted: string[]): boolean {
  const pool = [...candidate]
  return wanted.every((w) => {
    const i = pool.findIndex((c) => fuzzyTokenMatch(c, w))
    if (i < 0) return false
    pool.splice(i, 1)
    return true
  })
}

/** Scores one address against one property: 0 when the street number or street name differ. */
export function addressScore(address: string, property: PropertyRef): number {
  const tokens = normaliseAddress(address).split(' ').filter(Boolean)
  const street = normaliseAddress(property.address).split(' ')
  const suburb = normaliseAddress(property.suburb).split(' ')

  const numbers = tokens.filter(isNumber)
  const streetNumbers = street.filter(isNumber)
  if (numbers.length === 0 || streetNumbers.length === 0) return 0
  // The house number (last number of the street address) must be there; any unit number given must agree.
  if (!numbers.includes(streetNumbers[streetNumbers.length - 1])) return 0
  if (!numbers.every((n) => streetNumbers.includes(n))) return 0

  const words = tokens.filter((t) => !isNumber(t))
  const streetWords = street.filter((t) => !isNumber(t))
  if (!covers(words, streetWords)) return 0

  const rest = [...words]
  for (const w of streetWords) {
    const i = rest.findIndex((c) => fuzzyTokenMatch(c, w))
    if (i >= 0) rest.splice(i, 1)
  }
  if (rest.length === 0) return 0.9
  if (covers(rest, suburb)) return 1
  // Extra words that are not this property's suburb: probably the same street name somewhere else.
  return 0.5
}

/** The best-matching property (score at least 0.85), or null when the address is not in the portfolio. */
export function matchProperty<P extends PropertyRef>(address: string | null | undefined, properties: P[]): PropertyMatch<P> | null {
  if (!address) return null
  let best: PropertyMatch<P> | null = null
  for (const property of properties) {
    const score = addressScore(address, property)
    if (score >= 0.85 && (!best || score > best.score)) best = { property, score }
  }
  return best
}

/** True when two addresses normalise to the same place (used to compare extracted values). */
export function sameAddress(a: string, b: string): boolean {
  const x = normaliseAddress(a)
  const y = normaliseAddress(b)
  if (x === y) return true
  const xs = x.split(' ')
  const ys = y.split(' ')
  return xs.length === ys.length && xs.every((t, i) => fuzzyTokenMatch(t, ys[i]))
}
