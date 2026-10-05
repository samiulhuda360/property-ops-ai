// The synthetic September 2026 statement and its ground truth (data/bank), and a portfolio snapshot built from the
// truth file, so the engine can be tested and evaluated without a database.
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ExceptionCode, Snapshot } from './types'

export const BANK_DATA_DIR = resolve(__dirname, '..', '..', '..', 'data', 'bank')
export const DEMO_STATEMENT = '2026-09-statement.csv'

export function readDemoStatement(): string {
  return readFileSync(join(BANK_DATA_DIR, DEMO_STATEMENT), 'utf8')
}

export interface TruthLine {
  row: number
  date: string
  amount: number
  payee: string
  particulars: string
  code: string
  reference: string
  transactionType: string
  expected: {
    type: 'rent' | 'contractor' | 'bond' | 'refund' | 'fee' | 'transfer' | 'other' | 'unknown'
    lease: string | null
    contractor: string | null
    job: string | null
    property: string | null
    exception: ExceptionCode | null
    autoAllocate: boolean
    allocations: { week: string; amount: number }[]
    credit: number
  }
  answer: { lease: string | null; category: string } | null
  case: string | null
  noise: string[]
  note: string
}

export interface TruthArrears {
  lease: string
  tenant: string
  amount: number
  weeks: { week: string; outstanding: number }[]
}

export interface Truth {
  period: { start: string; end: string }
  portfolio: {
    leases: {
      code: string
      address: string
      suburb: string
      tenant: { firstName: string; lastName: string }
      weeklyRent: number
      rentReference: string
      status: string
      startDate: string
      endDate: string | null
      payments: { dueDate: string; amount: number; status: string }[]
    }[]
    vacantProperties: { code: string; address: string; suburb: string }[]
    contractors: { name: string; trade: string }[]
    jobs: { key: string; property: string; contractor: string; title: string; status: string; quoteAmount: number }[]
  }
  lines: TruthLine[]
  totals: { lines: number; moneyIn: number; moneyOut: number; exceptions: number }
  arrears: { afterAutomatic: TruthArrears[]; afterReview: TruthArrears[] }
  credits: { afterAutomatic: { lease: string; amount: number }[]; afterReview: { lease: string; amount: number }[] }
  rentPaidByWeek: { afterAutomatic: Record<string, Record<string, number>>; afterReview: Record<string, Record<string, number>> }
}

export function loadTruth(): Truth {
  return JSON.parse(readFileSync(join(BANK_DATA_DIR, 'truth.json'), 'utf8')) as Truth
}

export interface TruthSnapshot {
  snapshot: Snapshot
  leaseCode: (leaseId: number | null) => string | null
  leaseId: (code: string) => number
  jobKey: (jobId: number | null) => string | null
  contractorName: (contractorId: number | null) => string | null
  propertyCode: (propertyId: number | null) => string | null
}

/** The portfolio from truth.json with numeric ids, as the engine would see it before the statement is imported. */
export function snapshotFromTruth(truth: Truth): TruthSnapshot {
  const { leases, vacantProperties, contractors, jobs } = truth.portfolio
  const properties = [
    ...leases.map((l) => ({ code: l.code, address: l.address, suburb: l.suburb })),
    ...vacantProperties,
  ].map((p, i) => ({ id: i + 1, ...p }))
  const propertyId = (code: string) => properties.find((p) => p.code === code)!.id
  let paymentId = 0
  const snapshot: Snapshot = {
    properties,
    leases: leases.map((l, i) => ({
      id: i + 1,
      propertyId: propertyId(l.code),
      propertyCode: l.code,
      address: l.address,
      suburb: l.suburb,
      tenantFirstName: l.tenant.firstName,
      tenantLastName: l.tenant.lastName,
      weeklyRent: l.weeklyRent,
      rentReference: l.rentReference,
      status: l.status,
      startDate: l.startDate,
      endDate: l.endDate,
    })),
    payments: leases.flatMap((l, i) =>
      l.payments.map((p) => ({
        id: ++paymentId,
        leaseId: i + 1,
        dueDate: p.dueDate,
        amount: p.amount,
        covered: p.status === 'paid' ? p.amount : 0,
      })),
    ),
    contractors: contractors.map((c, i) => ({ id: i + 1, name: c.name, trade: c.trade })),
    jobs: jobs.map((j, i) => ({
      id: i + 1,
      contractorId: contractors.findIndex((c) => c.name === j.contractor) + 1,
      propertyId: propertyId(j.property),
      propertyCode: j.property,
      address: properties.find((p) => p.code === j.property)!.address,
      title: j.title,
      quoteAmount: j.quoteAmount,
      cost: null,
      status: j.status,
    })),
    priorLines: [],
  }
  return {
    snapshot,
    leaseCode: (id) => (id === null ? null : (snapshot.leases.find((l) => l.id === id)?.propertyCode ?? null)),
    leaseId: (code) => snapshot.leases.find((l) => l.propertyCode === code)!.id,
    jobKey: (id) => (id === null ? null : (jobs[id - 1]?.key ?? null)),
    contractorName: (id) => (id === null ? null : (contractors[id - 1]?.name ?? null)),
    propertyCode: (id) => (id === null ? null : (properties.find((p) => p.id === id)?.code ?? null)),
  }
}
