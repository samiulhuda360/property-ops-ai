// New Zealand IRD / GST number check digit (Inland Revenue's published modulus-11 algorithm).
// GST numbers are IRD numbers: 8 or 9 digits, written like 123-456-789.

const PRIMARY = [3, 2, 7, 6, 5, 4, 3, 2]
const SECONDARY = [7, 4, 3, 2, 5, 2, 7, 6]

function checkDigit(base: number[], weights: number[]): number {
  const remainder = base.reduce((sum, d, i) => sum + d * weights[i], 0) % 11
  return remainder === 0 ? 0 : 11 - remainder
}

/** The check digit for the first 8 digits (zero-padded), or null if no valid number has this base. */
export function irdCheckDigitFor(base8: string): number | null {
  const digits = base8.padStart(8, '0').split('').map(Number)
  let check = checkDigit(digits, PRIMARY)
  if (check === 10) check = checkDigit(digits, SECONDARY)
  return check === 10 ? null : check
}

/** True when the text is a well-formed IRD/GST number in the issued range with a correct check digit. */
export function isValidIrdNumber(text: string): boolean {
  const digits = text.replace(/[\s-]/g, '')
  if (!/^\d{8,9}$/.test(digits)) return false
  const value = Number(digits)
  if (value < 10_000_000 || value > 150_000_000) return false
  const padded = digits.padStart(9, '0')
  return irdCheckDigitFor(padded.slice(0, 8)) === Number(padded[8])
}

/** Formats 9 digits as 123-456-789. */
export function formatIrdNumber(text: string): string {
  const d = text.replace(/[\s-]/g, '').padStart(9, '0')
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`
}
