// Reads bank statement CSV exports in the formats NZ banks use:
// - quoted fields with commas, doubled quotes and line breaks; a byte-order mark; CRLF or LF line endings;
// - an optional preamble (account number, statement period) above the header row;
// - dates as dd/mm/yyyy (also d/m/yy, dd-mm-yyyy, 07 Sep 2026 and yyyy-mm-dd);
// - one signed Amount column, or separate Debit and Credit columns; amounts like -1,234.50, (12.00), 12.00 DR.
import { createHash } from 'node:crypto'
import { normalise, slug } from './text'
import type { StatementLine } from './types'

/** Splits CSV text into rows of fields (RFC 4180, tolerant of stray quotes inside unquoted fields). */
export function parseCsv(input: string, delimiter = ','): string[][] {
  const text = input.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
      continue
    }
    if (c === '"' && field.trim() === '') {
      field = ''
      inQuotes = true
    } else if (c === delimiter) {
      row.push(field)
      field = ''
    } else if (c === '\r' || c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      if (c === '\r' && text[i + 1] === '\n') i++
    } else {
      field += c
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function detectDelimiter(text: string): string {
  const firstLines = text.split(/\r?\n/).slice(0, 15).join('\n')
  const count = (ch: string) => firstLines.split(ch).length - 1
  const candidates = [',', ';', '\t'].map((d) => ({ d, n: count(d) }))
  candidates.sort((a, b) => b.n - a.n)
  return candidates[0].n > 0 ? candidates[0].d : ','
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

function validDate(y: number, m: number, d: number): string | null {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2200)) return null
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null
  return date.toISOString().slice(0, 10)
}

/** NZ dates are day first. Returns yyyy-mm-dd, or null when the text isn't a real date. */
export function parseNzDate(text: string): string | null {
  const s = text.trim()
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]))
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/)
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    return validDate(year, Number(m[2]), Number(m[1]))
  }
  m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s-]+(\d{2}|\d{4})$/)
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toUpperCase()) + 1
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    return month > 0 ? validDate(year, month, Number(m[1])) : null
  }
  return null
}

/** Parses "-1,234.50", "+720.00", "(12.00)", "12.00-", "$45.00", "12.00 DR" and "12.00 CR". Null when it isn't money. */
export function parseAmount(text: string): number | null {
  let s = text.trim().toUpperCase().replace(/−/g, '-')
  if (!s) return null
  let sign = 1
  if (/^\(.*\)$/.test(s)) {
    sign = -1
    s = s.slice(1, -1)
  }
  const suffix = s.match(/\s*(DR|CR)$/)
  if (suffix) {
    if (suffix[1] === 'DR') sign = -sign
    s = s.slice(0, s.length - suffix[0].length)
  }
  s = s.replace(/NZD|NZ\$|\$|\s/g, '')
  if (s.endsWith('-')) {
    sign = -sign
    s = s.slice(0, -1)
  }
  if (s.startsWith('-')) {
    sign = -sign
    s = s.slice(1)
  } else if (s.startsWith('+')) {
    s = s.slice(1)
  }
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(s) && !/^\.\d+$/.test(s)) return null
  const value = Number(s.replace(/,/g, ''))
  return Number.isFinite(value) ? Math.round(sign * value * 100) / 100 : null
}

type Field = 'date' | 'amount' | 'debit' | 'credit' | 'payee' | 'particulars' | 'code' | 'reference' | 'tranType'

// Header names seen in NZ bank exports, normalised to lower case words.
const HEADERS: Record<Field, string[]> = {
  date: ['date', 'transaction date', 'trans date', 'posted date', 'processed date', 'date processed'],
  amount: ['amount', 'amount nzd', 'value', 'transaction amount'],
  debit: ['debit', 'debits', 'withdrawal', 'withdrawals', 'money out', 'debit amount'],
  credit: ['credit', 'credits', 'deposit', 'deposits', 'money in', 'credit amount'],
  payee: ['payee', 'other party', 'payer', 'name', 'description', 'details', 'payee name', 'other party name'],
  particulars: ['particulars'],
  code: ['code', 'analysis code'],
  reference: ['reference', 'ref', 'references'],
  tranType: ['transaction type', 'tran type', 'type', 'trans type'],
}

const headerKey = (h: string) =>
  h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

function mapHeader(row: string[]): Partial<Record<Field, number>> | null {
  const map: Partial<Record<Field, number>> = {}
  row.forEach((cell, index) => {
    const key = headerKey(cell)
    for (const field of Object.keys(HEADERS) as Field[]) {
      if (map[field] === undefined && HEADERS[field].includes(key)) {
        map[field] = index
        break
      }
    }
  })
  const hasMoney = map.amount !== undefined || map.debit !== undefined || map.credit !== undefined
  return map.date !== undefined && hasMoney ? map : null
}

export interface ParseError {
  /** 1-based line number in the file. */
  line: number
  message: string
}

export interface ParsedStatement {
  lines: StatementLine[]
  errors: ParseError[]
  /** The header row as found in the file. */
  columns: string[]
  /** Rows above the header (account details, statement period). */
  preamble: string[]
}

export function parseStatement(text: string): ParsedStatement {
  const rows = parseCsv(text, detectDelimiter(text))
  const headerIndex = rows.slice(0, 20).findIndex((r) => mapHeader(r) !== null)
  if (headerIndex < 0) {
    return {
      lines: [],
      errors: [{ line: 1, message: 'No header row with a Date and an Amount (or Debit/Credit) column was found.' }],
      columns: [],
      preamble: [],
    }
  }
  const header = rows[headerIndex]
  const map = mapHeader(header)!
  const cell = (r: string[], f: Field) => (map[f] === undefined ? '' : (r[map[f]!] ?? '').trim())

  const lines: StatementLine[] = []
  const errors: ParseError[] = []
  rows.slice(headerIndex + 1).forEach((r, i) => {
    const fileLine = headerIndex + 2 + i
    if (r.every((c) => c.trim() === '')) return
    const date = parseNzDate(cell(r, 'date'))
    if (!date) {
      errors.push({ line: fileLine, message: `"${cell(r, 'date')}" is not a date (expected dd/mm/yyyy).` })
      return
    }
    let amount: number | null
    if (map.amount !== undefined) {
      amount = parseAmount(cell(r, 'amount'))
    } else {
      const debit = cell(r, 'debit') ? parseAmount(cell(r, 'debit')) : 0
      const credit = cell(r, 'credit') ? parseAmount(cell(r, 'credit')) : 0
      amount = debit === null || credit === null ? null : Math.round((Math.abs(credit) - Math.abs(debit)) * 100) / 100
    }
    if (amount === null) {
      errors.push({ line: fileLine, message: `"${cell(r, 'amount') || cell(r, 'debit') || cell(r, 'credit')}" is not an amount.` })
      return
    }
    lines.push({
      row: lines.length + 1,
      date,
      amount,
      payee: cell(r, 'payee'),
      particulars: cell(r, 'particulars'),
      code: cell(r, 'code'),
      reference: cell(r, 'reference'),
      tranType: cell(r, 'tranType'),
    })
  })
  return {
    lines,
    errors,
    columns: header.map((h) => h.trim()),
    preamble: rows.slice(0, headerIndex).map((r) => r.join(',').trim()).filter(Boolean),
  }
}

/** What makes two lines the same payment: date, amount and every text field, ignoring case and punctuation. */
export function lineKey(line: Pick<StatementLine, 'date' | 'amount' | 'payee' | 'particulars' | 'code' | 'reference' | 'tranType'>): string {
  return [
    line.date,
    line.amount.toFixed(2),
    normalise(line.payee),
    normalise(line.particulars),
    normalise(line.code),
    normalise(line.reference),
    normalise(line.tranType),
  ].join('|')
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

/**
 * A fingerprint per line: its key plus how many identical lines came before it in the same file. Importing the
 * same file again gives the same fingerprints (so nothing is counted twice), while a line repeated inside one file
 * keeps its own fingerprint and is flagged as a possible duplicate instead of disappearing.
 */
export function lineHashes(lines: StatementLine[]): string[] {
  const seen = new Map<string, number>()
  return lines.map((line) => {
    const key = lineKey(line)
    const occurrence = seen.get(key) ?? 0
    seen.set(key, occurrence + 1)
    return sha256(`${key}#${occurrence}`)
  })
}

/** A batch id from the file name and its content: the same file always gets the same id. */
export function batchId(fileName: string, lines: StatementLine[]): string {
  return `${slug(fileName)}-${sha256(lines.map(lineKey).join('\n')).slice(0, 8)}`
}
