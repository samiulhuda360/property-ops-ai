// The arrears model in Node: the features match the Python definitions, the exported weights reproduce the Python
// probabilities, and the reasons and next steps read sensibly. No database needed.
import { describe, expect, it } from 'vitest'
import { loadHistory } from '../src/risk/demo'
import { computeFeatures, FEATURE_NAMES, monthlyRent } from '../src/risk/features'
import { bandFor, draftFor, loadModel, probability, score } from '../src/risk/model'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SCORES = JSON.parse(readFileSync(resolve(__dirname, '../../data/risk/scores.json'), 'utf8')) as {
  backtest: { asOf: string; scores: Record<string, { probability: number; features: Record<string, number> }> }
  demo: { asOf: string; scores: Record<string, { probability: number; features: Record<string, number> }> }
}

const row = (month: string, rentDue: number, paidAmount: number, daysLate: number, arrears30 = false) => ({ month, rentDue, paidAmount, daysLate, arrears30 })

describe('arrears features', () => {
  it('counts late months, partials, misses, the trend and the balance over the right windows', () => {
    const rows = [
      row('2026-01', 1000, 1000, 0),
      row('2026-02', 1000, 1000, 3),
      row('2026-03', 1000, 1000, 0),
      row('2026-04', 1000, 600, 12),
      row('2026-05', 1000, 0, 60, true),
      row('2026-06', 1000, 1000, 20),
      row('2026-07', 1000, 1000, 35, true),
    ]
    const f = computeFeatures({ start: '2025-10-01', rentMonthly: 1000, marketMonthly: 950, rows }, '2026-07')
    expect(f.late_share_6).toBeCloseTo(5 / 6)
    expect(f.avg_days_late_6).toBeCloseTo((3 + 0 + 12 + 60 + 20 + 35) / 6)
    expect(f.late_trend).toBeCloseTo((60 + 20 + 35) / 3 - (3 + 0 + 12) / 3)
    expect(f.partial_count_6).toBe(1)
    expect(f.missed_count_12).toBe(1)
    expect(f.max_days_late_12).toBe(60)
    expect(f.prior_arrears).toBe(1)
    expect(f.tenancy_months).toBe(10)
    expect(f.rent_ratio).toBeCloseTo(1000 / 950)
    expect(f.balance_ratio).toBeCloseTo(1.4)
    // An earlier cutoff only sees the rows up to it.
    const early = computeFeatures({ start: '2025-10-01', rentMonthly: 1000, marketMonthly: null, rows }, '2026-03')
    expect(early).toMatchObject({ late_share_6: 1 / 3, late_trend: 0, prior_arrears: 0, rent_ratio: 1, balance_ratio: 0, tenancy_months: 6 })
  })

  it('handles a brand-new tenancy with no rows', () => {
    const f = computeFeatures({ start: '2026-09-01', rentMonthly: 1000, marketMonthly: 1000, rows: [] }, '2026-09')
    expect(f).toEqual({ late_share_6: 0, avg_days_late_6: 0, late_trend: 0, partial_count_6: 0, missed_count_12: 0, max_days_late_12: 0, prior_arrears: 0, tenancy_months: 1, rent_ratio: 1, balance_ratio: 0 })
  })

  it('turns a weekly rent into the monthly figure the generator uses', () => {
    expect(monthlyRent(720)).toBe(3120)
    expect(monthlyRent(265)).toBe(1148.33)
  })
})

describe('exported model', () => {
  const model = loadModel()
  const history = loadHistory()

  it('has the ten features in order and a backtest AUC recorded from the training run', () => {
    expect(model.features).toEqual([...FEATURE_NAMES])
    expect(model.coef).toHaveLength(10)
    expect(Number(model.backtest.auc)).toBeGreaterThan(0.8)
  })

  it('reproduces every Python probability from the exported weights, at both scoring points', () => {
    for (const point of [SCORES.backtest, SCORES.demo]) {
      let checked = 0
      for (const t of history.tenancies) {
        const expected = point.scores[t.id]
        if (!expected) continue
        const rows = t.months.filter((m) => m.month <= point.asOf)
        if (!rows.length) continue
        const f = computeFeatures({ start: t.start, rentMonthly: t.rentMonthly, marketMonthly: t.marketMonthly, rows }, point.asOf)
        for (const name of FEATURE_NAMES) expect(f[name], `${t.id} ${name} at ${point.asOf}`).toBeCloseTo(expected.features[name], 6)
        expect(probability(model, f), `${t.id} at ${point.asOf}`).toBeCloseTo(expected.probability, 6)
        checked++
      }
      expect(checked).toBe(60)
    }
  })

  it('ranks the truly late tenancies ahead of the reliable ones on the held-out months', () => {
    const scored = history.tenancies.map((t) => {
      const rows = t.months.filter((m) => m.month <= history.cutoff)
      const f = computeFeatures({ start: t.start, rentMonthly: t.rentMonthly, marketMonthly: t.marketMonthly, rows }, history.cutoff)
      return { id: t.id, p: probability(model, f), truth: history.truth[t.id] }
    })
    const positives = scored.filter((s) => s.truth)
    const negatives = scored.filter((s) => !s.truth)
    let wins = 0
    for (const p of positives) for (const n of negatives) if (p.p > n.p) wins++
    const auc = wins / (positives.length * negatives.length)
    expect(auc).toBeCloseTo(Number(model.backtest.auc), 2)
  })

  it('explains a score in plain words and suggests a step that fits the band', () => {
    const f = computeFeatures(
      {
        start: '2025-01-01',
        rentMonthly: 2000,
        marketMonthly: 1800,
        rows: [row('2026-04', 2000, 2000, 9), row('2026-05', 2000, 1200, 18), row('2026-06', 2000, 2000, 22), row('2026-07', 2000, 0, 60, true), row('2026-08', 2000, 2000, 28), row('2026-09', 2000, 2000, 31, true)],
      },
      '2026-09',
    )
    const s = score(model, f, { months: 6, rentMonthly: 2000, currency: 'NZD' })
    expect(s.band).toBe('high')
    expect(s.reasons.length).toBeLessThanOrEqual(3)
    expect(s.reasons.map((r) => r.text).join(' ')).toMatch(/late|behind|payment/)
    expect(s.nextStep).toBe('payment_plan')
    const draft = draftFor(s.nextStep, { firstName: 'Ben', address: '5 Rimu Crescent, Henderson', company: 'Acme Property Group', behind: 2800, currency: 'NZD', reasons: s.reasons })
    expect(draft).toContain('Hi Ben')
    expect(draft).toContain('NZD 2,800')

    const calm = score(model, computeFeatures({ start: '2023-01-01', rentMonthly: 2000, marketMonthly: 2000, rows: Array.from({ length: 12 }, (_, i) => row(`2026-${String(i + 1).padStart(2, '0')}`, 2000, 2000, 0)) }, '2026-12'), { months: 12, rentMonthly: 2000, currency: 'NZD' })
    expect(calm.band).toBe('low')
    expect(calm.nextStep).toBe('none')
    expect(calm.reasons[0].text).toContain('paid on time')
    expect(bandFor(model, 0.3)).toBe('medium')
  })
})
