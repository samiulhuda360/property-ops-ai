import { describe, expect, it } from 'vitest'
import { validateSuggestion } from '../src/reconciliation/ai'
import { allocate, classifyRent, computeArrears, replayLease } from '../src/reconciliation/allocate'
import { parseStatement } from '../src/reconciliation/csv'
import { reconcile } from '../src/reconciliation/engine'
import { loadTruth, readDemoStatement, snapshotFromTruth } from '../src/reconciliation/fixture'
import { nameStrength } from '../src/reconciliation/text'
import type { RentPayment, Snapshot, StatementLine } from '../src/reconciliation/types'

const truth = loadTruth()
const statement = parseStatement(readDemoStatement()).lines
const fixture = snapshotFromTruth(truth)
const { results, payments } = reconcile(statement, fixture.snapshot)
const result = (row: number) => results.find((r) => r.row === row)!
const rowsOf = (name: string) => truth.lines.filter((l) => l.case === name).map((l) => l.row)
const weeks = (row: number) => result(row).allocations.map((a) => [a.dueDate, a.amount])

describe('the September statement against the ground truth', () => {
  it.each(truth.lines.map((l) => [l.row, l.payee || '(fee)', l] as const))('line %i (%s)', (row, _payee, expected) => {
    const r = result(row)
    expect(r.matchType ?? 'unknown').toBe(expected.expected.type)
    expect(r.exception).toBe(expected.expected.exception)
    if (expected.expected.type === 'rent' || expected.expected.type === 'refund') {
      const lease = fixture.leaseCode(r.leaseId)
      // Lines held for a person (ambiguous) carry no tenancy; the rest name the expected one.
      expect(expected.expected.lease === null ? null : lease).toBe(expected.expected.lease)
    }
    if (expected.expected.type === 'contractor') {
      expect(fixture.contractorName(r.contractorId)).toBe(expected.expected.contractor)
      expect(fixture.jobKey(r.jobId)).toBe(expected.expected.job)
    }
    expect(r.allocations.map((a) => ({ week: a.dueDate, amount: a.amount }))).toEqual(expected.expected.allocations)
    expect(r.credit).toBe(expected.expected.credit)
    expect(r.explanation.length).toBeGreaterThan(10)
    if (r.exception) expect(r.suggestedAction).toBeTruthy()
  })

  it('leaves the arrears the ground truth expects', () => {
    const arrears = computeArrears(fixture.snapshot.leases, payments, truth.period.end)
    expect(arrears.map((a) => [fixture.leaseCode(a.leaseId), a.total]).sort()).toEqual(
      truth.arrears.afterAutomatic.map((a) => [a.lease, a.amount]).sort(),
    )
  })

  it('does not change the snapshot it was given', () => {
    expect(fixture.snapshot.payments.filter((p) => p.dueDate >= '2026-09-01').every((p) => p.covered === 0)).toBe(true)
  })
})

describe('planted cases', () => {
  it('underpaid: one week $50 short, the week stays part-paid', () => {
    const [row] = rowsOf('underpaid')
    expect(result(row)).toMatchObject({ exception: 'underpaid', shortfall: 50, matchStatus: 'exception' })
    expect(weeks(row)).toEqual([['2026-09-14', 510]])
    expect(result(row).allocations[0].completes).toBe(false)
  })

  it('overpaid: the extra $50 is held as credit', () => {
    const [row] = rowsOf('overpaid')
    expect(result(row)).toMatchObject({ exception: 'overpaid', credit: 50 })
    expect(result(row).suggestedAction).toContain('credit')
  })

  it('missing payments: two weeks owing for Liam O\'Brien', () => {
    const arrears = computeArrears(fixture.snapshot.leases, payments, truth.period.end)
    const liam = arrears.find((a) => fixture.leaseCode(a.leaseId) === 'NLN11')!
    expect(liam.weeks.map((w) => w.dueDate)).toEqual(['2026-09-21', '2026-09-28'])
    expect(liam.total).toBe(1080)
  })

  it('wrong reference, known payer, exact amount: matched by payer name', () => {
    const [row] = rowsOf('wrong_reference_known_payer')
    expect(result(row)).toMatchObject({ method: 'payer_name', exception: null, matchStatus: 'matched' })
    expect(fixture.leaseCode(result(row).leaseId)).toBe('HND5')
  })

  it('fortnightly payments cover two weeks each', () => {
    const [first, second] = rowsOf('fortnightly_payment')
    expect(weeks(first)).toEqual([['2026-09-07', 610], ['2026-09-14', 610]])
    expect(weeks(second)).toEqual([['2026-09-21', 610], ['2026-09-28', 610]])
    expect(result(first).exception).toBeNull()
  })

  it('duplicate: the repeated line is held and points at the original', () => {
    const [row] = rowsOf('duplicate')
    expect(result(row)).toMatchObject({ exception: 'duplicate', allocatable: false, duplicateOf: `line ${row - 1}` })
    expect(fixture.leaseCode(result(row).leaseId)).toBe('PON7')
    expect(result(row).allocations).toEqual([])
  })

  it('unknown payers are held; a first-name lead is offered but never used as a match', () => {
    const [harris, sione] = rowsOf('unknown_payer')
    expect(result(harris)).toMatchObject({ exception: 'unknown_payer', leaseId: null, candidates: [] })
    expect(result(sione)).toMatchObject({ exception: 'unknown_payer', leaseId: null })
    expect(result(sione).candidates.map((c) => c.label)).toEqual([expect.stringContaining('Mele Fifita')])
  })

  it('ambiguous: surname points one way, amount the other, so both are offered', () => {
    const [row] = rowsOf('ambiguous')
    expect(result(row)).toMatchObject({ exception: 'ambiguous', leaseId: null, allocatable: false })
    expect(result(row).candidates.map((c) => fixture.leaseCode(c.id))).toEqual(['MRB6', 'TAK9'])
  })

  it('payment to an ended tenancy is not counted as rent', () => {
    const [row] = rowsOf('payment_after_lease_end')
    expect(result(row)).toMatchObject({ exception: 'payment_to_ended_lease', allocatable: false, allocations: [] })
    expect(result(row).suggestedAction).toMatch(/Refund \$760\.00 to Grace Chen/)
  })

  it('the refund to the former tenant is paired with that payment', () => {
    const [row] = rowsOf('refund_to_ex_tenant')
    expect(result(row)).toMatchObject({ matchType: 'refund', exception: null })
    expect(result(row).explanation).toContain('received on 07/09/2026')
  })

  it('contractor payments: at the quote, differing from the quote, and with no job', () => {
    for (const row of rowsOf('contractor_at_quote')) expect(result(row)).toMatchObject({ matchType: 'contractor', exception: null })
    const [differs] = rowsOf('amount_differs_from_quote')
    expect(result(differs).exception).toBe('amount_differs_from_quote')
    expect(result(differs).explanation).toContain('$35.00 more')
    const [none] = rowsOf('no_matching_job')
    expect(result(none)).toMatchObject({ exception: 'no_matching_job', jobId: null })
  })

  it('a contractor credit note with a property code is not read as rent', () => {
    const [row] = rowsOf('contractor_credit_note')
    expect(result(row)).toMatchObject({ matchType: 'contractor', category: 'contractor_credit', leaseId: null, allocations: [] })
  })

  it('bond, bank fees and transfers are categorised', () => {
    expect(result(rowsOf('bond_receipt')[0])).toMatchObject({ matchType: 'bond', exception: null })
    expect(result(rowsOf('bond_receipt')[0]).suggestedAction).toContain('23 working days')
    for (const row of rowsOf('bank_fee')) expect(result(row).matchType).toBe('fee')
    expect(result(rowsOf('transfer')[0]).matchType).toBe('transfer')
  })

  it('amount and date: a unique weekly rent with rent due is matched, with lower confidence', () => {
    const [row] = rowsOf('amount_and_date_match')
    expect(result(row)).toMatchObject({ method: 'amount_window', exception: null })
    expect(result(row).confidence).toBeLessThan(0.7)
    expect(fixture.leaseCode(result(row).leaseId)).toBe('MTE14')
  })

  it("a partner paying with the tenant's reference is matched by the reference, not the payer's surname", () => {
    const partner = truth.lines.filter((l) => l.noise.includes('partner_pays')).map((l) => l.row)
    for (const row of partner) expect(fixture.leaseCode(result(row).leaseId)).toBe('TAK9')
  })
})

// ---- The ledger ----

const pay = (id: number, dueDate: string, amount = 560, covered = 0): RentPayment => ({ id, leaseId: 1, dueDate, amount, covered })
const september = () => [pay(1, '2026-09-07'), pay(2, '2026-09-14'), pay(3, '2026-09-21'), pay(4, '2026-09-28')]

describe('allocation', () => {
  it('pays the oldest unpaid week first and carries a shortfall forward', () => {
    const ledger = september()
    allocate(560, '2026-09-07', 560, ledger)
    const short = allocate(510, '2026-09-14', 560, ledger)
    expect(classifyRent(510, 560, short)).toEqual({ exception: 'underpaid', shortfall: 50 })
    const next = allocate(560, '2026-09-21', 560, ledger)
    expect(next.allocations.map((a) => [a.dueDate, a.amount, a.completes])).toEqual([
      ['2026-09-14', 50, true],
      ['2026-09-21', 510, false],
    ])
    expect(classifyRent(560, 560, next).exception).toBeNull()
  })

  it('a small top-up that clears arrears is not an underpayment', () => {
    const ledger = [pay(1, '2026-09-07', 560, 510)]
    const topUp = allocate(50, '2026-09-08', 560, ledger)
    expect(classifyRent(50, 560, topUp).exception).toBeNull()
    expect(ledger[0].covered).toBe(560)
  })

  it('pays whole weeks in advance and holds anything else as credit', () => {
    const ledger = september()
    const fortnight = allocate(1120, '2026-09-07', 560, ledger)
    expect(fortnight.allocations.map((a) => a.dueDate)).toEqual(['2026-09-07', '2026-09-14'])
    expect(fortnight.credit).toBe(0)
    const odd = allocate(600, '2026-09-21', 560, ledger)
    expect(odd.allocations.map((a) => [a.dueDate, a.amount])).toEqual([['2026-09-21', 560]])
    expect(odd.credit).toBe(40)
    expect(classifyRent(600, 560, odd).exception).toBe('overpaid')
  })

  it('counts rent due within six days as due now (paid on Friday for Monday)', () => {
    const ledger = september()
    expect(allocate(560, '2026-09-04', 560, ledger).allocations[0].dueDate).toBe('2026-09-07')
    expect(allocate(560, '2026-09-11', 560, ledger).allocations[0].dueDate).toBe('2026-09-14')
  })

  it('holds money as credit when there is no rent left to pay', () => {
    const ledger = [pay(1, '2026-09-07', 560, 560)]
    const extra = allocate(560, '2026-09-07', 560, ledger)
    expect(extra).toMatchObject({ allocations: [], credit: 560 })
  })

  it('replays a tenancy the same way whatever order the lines arrive in', () => {
    const lines = [
      { key: 'a', date: '2026-09-28', amount: 560, order: 4 },
      { key: 'b', date: '2026-09-07', amount: 560, order: 1 },
      { key: 'c', date: '2026-09-14', amount: 510, order: 2 },
      { key: 'd', date: '2026-09-21', amount: 560, order: 3 },
    ]
    const sched = september().map((p) => ({ ...p, opening: false }))
    const forward = replayLease(560, sched, lines)
    const backward = replayLease(560, sched, [...lines].reverse())
    expect([...backward.perLine.entries()].sort()).toEqual([...forward.perLine.entries()].sort())
    expect(forward.payments.map((p) => [p.dueDate, p.covered, p.paidDate])).toEqual([
      ['2026-09-07', 560, '2026-09-07'],
      ['2026-09-14', 560, '2026-09-21'],
      ['2026-09-21', 560, '2026-09-28'],
      ['2026-09-28', 510, null],
    ])
    expect(forward.perLine.get('c')?.exception).toBe('underpaid')
  })

  it('once the ambiguous line is assigned to Sophie Clarke, her month is fully paid', () => {
    const tak9 = fixture.leaseId('TAK9')
    const lease = fixture.snapshot.leases.find((l) => l.id === tak9)!
    const own = fixture.snapshot.payments.filter((p) => p.leaseId === tak9)
    const lines = truth.lines
      .filter((l) => l.expected.lease === 'TAK9' && l.expected.autoAllocate)
      .concat(truth.lines.filter((l) => l.answer?.lease === 'TAK9'))
      .map((l) => ({ key: l.row, date: l.date, amount: l.amount, order: l.row }))
    const replayed = replayLease(lease.weeklyRent, own.map((p) => ({ ...p, opening: p.covered > 0 })), lines)
    const paid = Object.fromEntries(replayed.payments.filter((p) => p.dueDate >= '2026-09-01').map((p) => [p.dueDate, p.covered]))
    expect(paid).toEqual(truth.rentPaidByWeek.afterReview.TAK9)
  })
})

// ---- Matching rules in isolation ----

function tiny(extra: Partial<Snapshot> = {}): Snapshot {
  const lease = (id: number, code: string, first: string, last: string, rent: number) => ({
    id,
    propertyId: id,
    propertyCode: code,
    address: `${id} Test Street`,
    suburb: 'Testville',
    tenantFirstName: first,
    tenantLastName: last,
    weeklyRent: rent,
    rentReference: `${last.toUpperCase()} ${code}`,
    status: 'active',
    startDate: '2025-01-01',
    endDate: null,
  })
  return {
    properties: [1, 2].map((id) => ({ id, code: id === 1 ? 'AAA1' : 'BBB2', address: `${id} Test Street`, suburb: 'Testville' })),
    leases: [lease(1, 'AAA1', 'Ann', 'Smith', 500), lease(2, 'BBB2', 'Bob', 'Jones', 500)],
    payments: [
      { id: 1, leaseId: 1, dueDate: '2026-09-07', amount: 500, covered: 0 },
      { id: 2, leaseId: 2, dueDate: '2026-09-07', amount: 500, covered: 0 },
    ],
    contractors: [],
    jobs: [],
    priorLines: [],
    ...extra,
  }
}

const line = (fields: Partial<StatementLine>): StatementLine => ({
  row: 1,
  date: '2026-09-07',
  amount: 500,
  payee: '',
  particulars: '',
  code: '',
  reference: '',
  tranType: 'Direct Credit',
  ...fields,
})

describe('matching rules', () => {
  it('a reference naming two tenancies is ambiguous', () => {
    const [r] = reconcile([line({ reference: 'AAA1 BBB2' })], tiny()).results
    expect(r.exception).toBe('ambiguous')
    expect(r.candidates).toHaveLength(2)
  })

  it('the same rent at two tenancies is ambiguous when nothing else decides', () => {
    const [r] = reconcile([line({ payee: 'X Y' })], tiny()).results
    expect(r.exception).toBe('ambiguous')
  })

  it('the payer name decides between two tenancies with the same rent', () => {
    const [r] = reconcile([line({ payee: 'B JONES' })], tiny()).results
    expect(r).toMatchObject({ leaseId: 2, method: 'payer_name', exception: null })
  })

  it('a line seen in an earlier import is a duplicate', () => {
    const earlier = line({ payee: 'A SMITH', reference: 'SMITH AAA1' })
    const prior = { key: '2026-09-07|500.00|A SMITH|||SMITH AAA1|DIRECT CREDIT', label: 'line 3 of august', date: '2026-09-07', amount: 500, leaseId: 1, exception: null }
    const [r] = reconcile([earlier], tiny({ priorLines: [prior] })).results
    expect(r).toMatchObject({ exception: 'duplicate', duplicateOf: 'line 3 of august' })
  })

  it('money out to an unknown payee is held for a person', () => {
    const [r] = reconcile([line({ amount: -80, payee: 'SOMEONE' })], tiny()).results
    expect(r).toMatchObject({ exception: 'unknown_payer', matchType: 'other' })
  })
})

describe('payer names', () => {
  it('rates the match by surname and first name or initial', () => {
    expect(nameStrength('R PATEL', 'Rajesh', 'Patel')).toBe('strong')
    expect(nameStrength('KIM, D', 'Daniel', 'Kim')).toBe('strong')
    expect(nameStrength("LIAM O'BRIEN", 'Liam', "O'Brien")).toBe('strong')
    expect(nameStrength('MR PATEL', 'Rajesh', 'Patel')).toBe('medium')
    expect(nameStrength('J LEE', 'Hannah', 'Lee')).toBe('weak')
    expect(nameStrength('KIMBERLEY D', 'Daniel', 'Kim')).toBeNull()
    expect(nameStrength('MELE', 'Mele', 'Fifita')).toBeNull()
  })
})

describe('model suggestions are checked before they are stored', () => {
  const codes = ['TAK9', 'MRB6']
  it('accepts a listed tenancy or NONE', () => {
    expect(validateSuggestion({ tenancy: 'tak9', category: 'rent', confidence: 0.8, reason: 'same payer as before' }, codes)).toMatchObject({ status: 'ok', tenancy: 'TAK9' })
    expect(validateSuggestion({ tenancy: 'NONE', category: 'unidentified', confidence: 0.6, reason: 'not ours' }, codes)).toMatchObject({ status: 'ok', tenancy: null })
  })
  it('rejects a tenancy that does not exist and a malformed reply', () => {
    expect(validateSuggestion({ tenancy: 'XYZ1', category: 'rent', confidence: 0.9, reason: '?' }, codes)).toMatchObject({ status: 'invalid', tenancy: null })
    expect(validateSuggestion({ tenant: 'TAK9' }, codes).status).toBe('invalid')
    expect(validateSuggestion({ tenancy: 'TAK9', category: 'groceries', confidence: 7, reason: 'x' }, codes)).toMatchObject({ category: 'other', confidence: 1 })
  })
})
