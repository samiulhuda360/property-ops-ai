// Text and number helpers for matching bank lines: normalisation, tokens, names, money and dates.

/** Upper case, apostrophes dropped (O'Brien -> OBRIEN), anything else that isn't a letter or digit becomes a space. */
export function normalise(text: string | null | undefined): string {
  return (text ?? '')
    .toUpperCase()
    .replace(/['’`]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

export function tokens(text: string | null | undefined): string[] {
  const n = normalise(text)
  return n ? n.split(' ') : []
}

/** Tokens plus each adjacent pair joined, so "MTE 14" also yields "MTE14". */
export function tokenSet(text: string | null | undefined): Set<string> {
  const list = tokens(text)
  const set = new Set(list)
  for (let i = 0; i + 1 < list.length; i++) set.add(list[i] + list[i + 1])
  return set
}

export const round2 = (n: number) => Math.round(n * 100) / 100
export const sameMoney = (a: number, b: number) => Math.abs(a - b) < 0.005

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000)
}

/** 07/09/2026 */
export function nzDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

/** $1,234.50 */
export function money(n: number): string {
  const abs = Math.abs(n).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${n < 0 ? '-' : ''}$${abs}`
}

const NAME_NOISE = new Set(['MR', 'MRS', 'MS', 'MISS', 'DR', 'AND', 'THE', 'FAMILY', 'TRUST', 'LTD', 'LIMITED'])

export type NameStrength = 'strong' | 'medium' | 'weak'

/**
 * How well a payer name matches a tenant.
 * - strong: surname plus the first name or its initial ("R PATEL", "KIM, D", "LIAM O'BRIEN");
 * - medium: the surname alone ("PATEL");
 * - weak: the surname with a different first name or initial ("J LEE" for Hannah Lee).
 * Returns null when the surname isn't there: a first name alone is never enough.
 */
export function nameStrength(payer: string, firstName: string, lastName: string): NameStrength | null {
  const payerTokens = tokens(payer).filter((t) => !NAME_NOISE.has(t))
  const surname = tokens(lastName)
  if (surname.length === 0 || !surname.every((t) => payerTokens.includes(t))) return null
  const given = payerTokens.filter((t) => !surname.includes(t))
  if (given.length === 0) return 'medium'
  const first = tokens(firstName)[0] ?? ''
  if (given.some((t) => t === first || (t.length === 1 && t === first[0]))) return 'strong'
  return 'weak'
}

/** A file-name stem safe to use in a batch id: "Sept export (2).csv" -> "sept-export-2". */
export function slug(text: string): string {
  return (
    text
      .replace(/\.[a-z0-9]+$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'statement'
  )
}
