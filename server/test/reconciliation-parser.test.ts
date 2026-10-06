import { describe, expect, it } from 'vitest'
import { batchId, lineHashes, lineKey, parseAmount, parseCsv, parseNzDate, parseStatement } from '../src/reconciliation/csv'
import { readDemoStatement } from '../src/reconciliation/fixture'

describe('CSV reader', () => {
  it('handles quoted fields with commas, doubled quotes and line breaks, CRLF and a byte-order mark', () => {
    const text = '﻿a,b,c\r\n"KIM, D","say ""hi""","two\nlines"\r\nplain,,end\r\n'
    expect(parseCsv(text)).toEqual([
      ['a', 'b', 'c'],
      ['KIM, D', 'say "hi"', 'two\nlines'],
      ['plain', '', 'end'],
    ])
  })

  it('keeps a stray quote inside an unquoted field', () => {
    expect(parseCsv('12" PIPE,x')).toEqual([['12" PIPE', 'x']])
  })
})

describe('NZ dates and amounts', () => {
  it('reads dates day first', () => {
    expect(parseNzDate('07/09/2026')).toBe('2026-09-07')
    expect(parseNzDate('7/9/26')).toBe('2026-09-07')
    expect(parseNzDate('07-09-2026')).toBe('2026-09-07')
    expect(parseNzDate('7 Sep 2026')).toBe('2026-09-07')
    expect(parseNzDate('2026-09-07')).toBe('2026-09-07')
  })

  it('rejects dates that do not exist', () => {
    expect(parseNzDate('31/02/2026')).toBeNull()
    expect(parseNzDate('13/13/2026')).toBeNull()
    expect(parseNzDate('yesterday')).toBeNull()
  })

  it('reads signed amounts in the forms banks use', () => {
    expect(parseAmount('720.00')).toBe(720)
    expect(parseAmount('+720.00')).toBe(720)
    expect(parseAmount('-220.00')).toBe(-220)
    expect(parseAmount('-1,234.50')).toBe(-1234.5)
    expect(parseAmount('(12.00)')).toBe(-12)
    expect(parseAmount('12.00-')).toBe(-12)
    expect(parseAmount('12.00 DR')).toBe(-12)
    expect(parseAmount('12.00 CR')).toBe(12)
    expect(parseAmount('$45')).toBe(45)
    expect(parseAmount('−45.10')).toBe(-45.1)
    expect(parseAmount('abc')).toBeNull()
    expect(parseAmount('')).toBeNull()
  })
})

describe('statement parsing', () => {
  it('reads the September demo statement', () => {
    const { lines, errors, columns } = parseStatement(readDemoStatement())
    expect(errors).toEqual([])
    expect(columns).toEqual(['Date', 'Amount', 'Payee', 'Particulars', 'Code', 'Reference', 'Transaction Type'])
    expect(lines).toHaveLength(50)
    expect(lines[0]).toEqual({
      row: 1,
      date: '2026-09-01',
      amount: 1800,
      payee: 'K HAWKINS',
      particulars: 'BOND',
      code: 'BLK2',
      reference: '2/8 MANUKA RD',
      tranType: 'Direct Credit',
    })
    expect(lines.find((l) => l.payee === 'TUPOU, A')?.reference).toBe('tupou pap18')
    expect(lines.filter((l) => l.amount < 0)).toHaveLength(8)
  })

  it('skips a preamble, maps other header names and reports bad rows without stopping', () => {
    const text = [
      'Account,12-3140-0012345-00',
      'Statement period,01/09/2026 to 30/09/2026',
      '',
      'Date,Details,Particulars,Code,Reference,Tran Type,Amount',
      '07/09/2026,A NGATA,RENT,,NGATA MTE14,Automatic Payment,720.00',
      '31/02/2026,BAD DATE,,,,,1.00',
      '08/09/2026,BAD AMOUNT,,,,,lots',
      ',,,,,,',
      '09/09/2026,ACME PLUMBING,INV 1,PON7,,Bill Payment,(220.00)',
    ].join('\n')
    const { lines, errors, preamble } = parseStatement(text)
    expect(preamble).toHaveLength(2)
    expect(lines.map((l) => [l.date, l.amount, l.payee, l.tranType])).toEqual([
      ['2026-09-07', 720, 'A NGATA', 'Automatic Payment'],
      ['2026-09-09', -220, 'ACME PLUMBING', 'Bill Payment'],
    ])
    expect(errors.map((e) => e.line)).toEqual([6, 7])
    expect(errors[0].message).toContain('31/02/2026')
  })

  it('reads separate Debit and Credit columns as one signed amount', () => {
    const text = 'Date,Payee,Debit,Credit\n07/09/2026,D KIM,,650.00\n09/09/2026,ACME,220.00,\n'
    expect(parseStatement(text).lines.map((l) => l.amount)).toEqual([650, -220])
  })

  it('reads semicolon-separated exports', () => {
    const text = 'Date;Amount;Payee\n07/09/2026;650.00;D KIM\n'
    expect(parseStatement(text).lines[0]).toMatchObject({ amount: 650, payee: 'D KIM' })
  })

  it('explains a file without a usable header', () => {
    const result = parseStatement('hello,world\n1,2\n')
    expect(result.lines).toEqual([])
    expect(result.errors[0].message).toMatch(/header/i)
  })
})

describe('line fingerprints', () => {
  const { lines } = parseStatement(readDemoStatement())

  it('are the same every time the same file is read', () => {
    expect(lineHashes(parseStatement(readDemoStatement()).lines)).toEqual(lineHashes(lines))
    expect(batchId('2026-09-statement.csv', lines)).toMatch(/^2026-09-statement-[0-9a-f]{8}$/)
    expect(batchId('2026-09-statement.csv', lines)).toBe(batchId('2026-09-statement.csv', parseStatement(readDemoStatement()).lines))
  })

  it('keep a line repeated inside one file as a separate line', () => {
    const repeated = lines.filter((l) => l.payee === 'D KIM' && l.date === '2026-09-14')
    expect(repeated).toHaveLength(2)
    expect(lineKey(repeated[0])).toBe(lineKey(repeated[1]))
    const hashes = lineHashes(lines)
    expect(new Set(hashes).size).toBe(lines.length)
  })

  it('ignore case and punctuation in the key', () => {
    const a = { date: '2026-09-21', amount: 650, payee: 'KIM, D', particulars: '', code: '', reference: 'Kim Pon7', tranType: 'Automatic Payment' }
    expect(lineKey(a)).toBe(lineKey({ ...a, payee: 'kim d', reference: 'KIM PON7' }))
    expect(lineKey(a)).not.toBe(lineKey({ ...a, amount: 650.01 }))
  })
})
