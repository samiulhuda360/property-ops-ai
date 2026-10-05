// The reconciliation workbook: a summary, the exceptions with an empty Decision column for the person working
// through them, what was matched to which tenancy, week or job, and the arrears.
import ExcelJS from 'exceljs'
import { nzDate } from './text'
import type { BatchSummary, LineView } from './service'

export const NZD = '"NZ$"#,##0.00;[Red]-"NZ$"#,##0.00'
const DATE = 'dd/mm/yyyy'
const BLUE = 'FF1D4ED8'
const LIGHT = 'FFEFF6FF'
const BORDER = 'FFD1D5DB'

const asDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

interface Column {
  header: string
  key: string
  width: number
  money?: boolean
  date?: boolean
  percent?: boolean
  wrap?: boolean
}

function table(sheet: ExcelJS.Worksheet, columns: Column[], rows: Record<string, unknown>[]) {
  sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width }))
  const header = sheet.getRow(1)
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } }
  header.alignment = { vertical: 'middle', wrapText: true }
  header.height = 30
  for (const row of rows) sheet.addRow(row)
  columns.forEach((c, i) => {
    const column = sheet.getColumn(i + 1)
    if (c.money) column.numFmt = NZD
    if (c.date) column.numFmt = DATE
    if (c.percent) column.numFmt = '0%'
    if (c.wrap) column.alignment = { wrapText: true, vertical: 'top' }
    else column.alignment = { vertical: 'top' }
  })
  header.alignment = { vertical: 'middle', wrapText: true }
  sheet.eachRow((row) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = { bottom: { style: 'thin', color: { argb: BORDER } } }
    })
  })
  sheet.views = [{ state: 'frozen', ySplit: 1, xSplit: 0 }]
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1 + rows.length, column: columns.length } }
}

function describeTarget(line: LineView): string {
  if (line.lease) return `${line.lease.tenant}, ${line.lease.address}${line.lease.propertyCode ? ` (${line.lease.propertyCode})` : ''}`
  if (line.job) return `${line.contractor?.name ?? 'Contractor'}: ${line.job.label}`
  if (line.contractor) return line.contractor.name
  if (line.category) return line.category.replace(/_/g, ' ')
  return line.candidates.length ? `Candidates: ${line.candidates.map((c) => c.label).join('; ')}` : ''
}

function suggestionText(line: LineView): string {
  const s = line.aiSuggestion
  if (!s) return ''
  if (s.status === 'failed') return `No suggestion (${s.error ?? 'model unavailable'})`
  const target = s.tenancy ? `Tenancy ${s.tenancy}` : `No tenancy (${s.category})`
  return `Suggestion only, not applied: ${target}. ${s.reason}`.trim()
}

export interface WorkbookInput {
  summary: BatchSummary
  lines: LineView[]
  generatedAt: Date
}

export function buildWorkbook({ summary, lines, generatedAt }: WorkbookInput): ExcelJS.Workbook {
  const book = new ExcelJS.Workbook()
  book.creator = 'Property Ops'
  book.created = generatedAt
  book.title = `Rent reconciliation ${summary.period.start} to ${summary.period.end}`

  // ---- Summary ----
  const sheet = book.addWorksheet('Summary', { properties: { tabColor: { argb: BLUE } } })
  sheet.columns = [{ width: 34 }, { width: 22 }, { width: 16 }, { width: 18 }]
  const title = sheet.addRow(['Rent reconciliation'])
  title.font = { bold: true, size: 14, color: { argb: BLUE } }
  sheet.addRow(['Statement', summary.fileName || summary.batch])
  sheet.addRow(['Period', `${nzDate(summary.period.start)} to ${nzDate(summary.period.end)}`])
  sheet.addRow(['Prepared', nzDate(generatedAt.toISOString().slice(0, 10))])
  sheet.addRow(['Method', summary.method.label])
  sheet.addRow([])

  const section = (columns: string[]) => {
    const row = sheet.addRow(columns)
    row.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    for (let c = 1; c <= columns.length; c++) row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } }
  }
  const figure = (label: string, value: number, format?: string) => {
    const row = sheet.addRow([label, value])
    if (format) row.getCell(2).numFmt = format
  }

  section(['Key figures', 'Value'])
  figure('Lines on the statement', summary.lines)
  figure('Money in', summary.moneyIn, NZD)
  figure('Money out', summary.moneyOut, NZD)
  figure('Net', Math.round((summary.moneyIn + summary.moneyOut) * 100) / 100, NZD)
  figure('Matched automatically', summary.matched.automatically)
  figure('Matched after review', summary.matched.afterReview)
  figure('Matched', summary.matched.percent / 100, '0.0%')
  figure('Exceptions open', summary.exceptions.open)
  figure('Exceptions resolved', summary.exceptions.resolved)
  figure('Lines left out', summary.ignored)
  figure(`Arrears at ${nzDate(summary.arrears.asOf)}`, summary.arrears.total, NZD)
  figure('Credit held', summary.credits.total, NZD)
  sheet.addRow([])

  section(['Exceptions by reason', 'Open', 'Resolved', 'Amount'])
  for (const r of summary.exceptions.byReason) {
    const row = sheet.addRow([r.label, r.open, r.resolved, r.amount])
    row.getCell(4).numFmt = NZD
  }
  if (summary.exceptions.byReason.length === 0) sheet.addRow(['None'])
  sheet.addRow([])

  section([`Arrears by tenant at ${nzDate(summary.arrears.asOf)}`, 'Property', 'Weeks owing', 'Amount'])
  for (const a of summary.arrears.tenants) {
    const row = sheet.addRow([a.tenant, a.propertyCode ?? a.address, a.weeks.length, a.total])
    row.getCell(4).numFmt = NZD
  }
  if (summary.arrears.tenants.length === 0) sheet.addRow(['None'])
  sheet.addRow([])

  section(['Credit held', 'Property', '', 'Amount'])
  for (const c of summary.credits.tenants) {
    const row = sheet.addRow([c.tenant, c.propertyCode ?? '', '', c.amount])
    row.getCell(4).numFmt = NZD
  }
  if (summary.credits.tenants.length === 0) sheet.addRow(['None'])
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  // ---- Exceptions ----
  const flagged = lines.filter((l) => l.exception || l.engine.exception)
  table(
    book.addWorksheet('Exceptions'),
    [
      { header: 'Line', key: 'row', width: 7 },
      { header: 'Date', key: 'date', width: 12, date: true },
      { header: 'Amount', key: 'amount', width: 14, money: true },
      { header: 'Payee', key: 'payee', width: 22 },
      { header: 'Particulars', key: 'particulars', width: 16 },
      { header: 'Code', key: 'code', width: 10 },
      { header: 'Reference', key: 'reference', width: 18 },
      { header: 'Reason', key: 'reason', width: 22 },
      { header: 'Tenancy or job found', key: 'target', width: 34, wrap: true },
      { header: 'What the rules found', key: 'explanation', width: 60, wrap: true },
      { header: 'Suggested action', key: 'action', width: 48, wrap: true },
      { header: 'Model suggestion', key: 'suggestion', width: 44, wrap: true },
      { header: 'Status', key: 'status', width: 18 },
      { header: 'Decision', key: 'decision', width: 14 },
      { header: 'Note', key: 'note', width: 30, wrap: true },
    ],
    flagged.map((l) => ({
      row: l.row,
      date: asDate(l.date),
      amount: l.amount,
      payee: l.payee,
      particulars: l.particulars,
      code: l.code,
      reference: l.reference,
      reason: l.exceptionLabel ?? l.engine.exception ?? '',
      target: describeTarget(l),
      explanation: l.explanation,
      action: l.suggestedAction ?? '',
      suggestion: suggestionText(l),
      status: l.matchStatus === 'exception' ? 'Open' : `Resolved: ${l.resolution?.decision ?? l.matchStatus}`,
      decision: '',
      note: '',
    })),
  )
  const exceptions = book.getWorksheet('Exceptions')!
  const decisionColumn = 14
  for (let r = 2; r <= flagged.length + 1; r++) {
    const cell = exceptions.getCell(r, decisionColumn)
    cell.dataValidation = { type: 'list', allowBlank: true, formulae: ['"Accept,Reassign,Ignore"'] }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } }
    exceptions.getCell(r, decisionColumn + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } }
  }

  // ---- Matched ----
  const matched = lines.filter((l) => l.matchStatus === 'matched')
  table(
    book.addWorksheet('Matched'),
    [
      { header: 'Line', key: 'row', width: 7 },
      { header: 'Date', key: 'date', width: 12, date: true },
      { header: 'Amount', key: 'amount', width: 14, money: true },
      { header: 'Payee', key: 'payee', width: 22 },
      { header: 'Reference', key: 'reference', width: 26 },
      { header: 'Type', key: 'type', width: 12 },
      { header: 'Matched to', key: 'target', width: 40, wrap: true },
      { header: 'Rent weeks', key: 'weeks', width: 34, wrap: true },
      { header: 'Allocated to rent', key: 'allocated', width: 16, money: true },
      { header: 'Credit', key: 'credit', width: 12, money: true },
      { header: 'Method', key: 'method', width: 20 },
      { header: 'Confidence', key: 'confidence', width: 12, percent: true },
      { header: 'How', key: 'how', width: 14 },
    ],
    matched.map((l) => ({
      row: l.row,
      date: asDate(l.date),
      amount: l.amount,
      payee: l.payee,
      reference: [l.particulars, l.code, l.reference].filter(Boolean).join(' / '),
      type: l.matchType ?? '',
      target: describeTarget(l),
      weeks: l.allocations.map((a) => `${nzDate(a.dueDate)}${a.completes ? '' : ' (part)'}`).join(', '),
      allocated: Math.round(l.allocations.reduce((s, a) => s + a.amount, 0) * 100) / 100,
      credit: l.credit,
      method: l.methodLabel,
      confidence: l.confidence,
      how: l.resolution ? 'After review' : 'Automatic',
    })),
  )

  // ---- Arrears ----
  const arrearsRows = summary.arrears.tenants.flatMap((a) =>
    a.weeks.map((w) => ({
      tenant: a.tenant,
      property: a.propertyCode ?? '',
      address: a.address,
      due: asDate(w.dueDate),
      rent: w.amount,
      paid: w.paid,
      outstanding: w.outstanding,
    })),
  )
  table(
    book.addWorksheet('Arrears'),
    [
      { header: 'Tenant', key: 'tenant', width: 22 },
      { header: 'Property', key: 'property', width: 10 },
      { header: 'Address', key: 'address', width: 26 },
      { header: 'Week due', key: 'due', width: 12, date: true },
      { header: 'Rent', key: 'rent', width: 13, money: true },
      { header: 'Paid', key: 'paid', width: 13, money: true },
      { header: 'Outstanding', key: 'outstanding', width: 14, money: true },
    ],
    arrearsRows,
  )
  const arrears = book.getWorksheet('Arrears')!
  const totalRow = arrears.addRow({
    tenant: `Total at ${nzDate(summary.arrears.asOf)}`,
    outstanding: { formula: `SUM(G2:G${arrearsRows.length + 1})`, result: summary.arrears.total },
  })
  totalRow.font = { bold: true }
  totalRow.getCell(7).numFmt = NZD

  return book
}
