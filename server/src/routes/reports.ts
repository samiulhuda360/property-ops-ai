import { Router, Response } from 'express'
import { authenticate, AuthRequest } from '../middleware/auth'
import { aiUsage, hoursReport, monthsWithRuns } from '../reports/hours'

const router = Router()
router.use(authenticate)

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

/** GET /api/reports/hours?month=YYYY-MM (defaults to the latest month with automation runs). */
router.get('/hours', async (req: AuthRequest, res: Response) => {
  const months = await monthsWithRuns(req.userId!)
  const requested = typeof req.query.month === 'string' ? req.query.month : undefined
  if (requested && !MONTH.test(requested)) {
    res.status(400).json({ error: 'month must look like 2026-09' })
    return
  }
  const month = requested ?? months[0] ?? new Date().toISOString().slice(0, 7)
  const [report, usage] = await Promise.all([hoursReport(req.userId!, month), aiUsage(month)])
  res.json({ ...report, months, aiUsage: usage })
})

/** GET /api/reports/hours.csv?month=YYYY-MM: the same table for a spreadsheet or an owner report. */
router.get('/hours.csv', async (req: AuthRequest, res: Response) => {
  const month = typeof req.query.month === 'string' && MONTH.test(req.query.month) ? req.query.month : undefined
  const months = await monthsWithRuns(req.userId!)
  const report = await hoursReport(req.userId!, month ?? months[0] ?? new Date().toISOString().slice(0, 7))
  const lines = [
    'automation,items,baseline_minutes_per_item,baseline_hours,review_hours,hours_returned',
    ...report.rows.map(
      (r) => `${r.label},${r.items},${r.baselineMinutesPerItem},${r.baselineHours},${r.reviewHours},${r.hoursReturned}`,
    ),
    `Total,${report.totals.items},,${report.totals.baselineHours},${report.totals.reviewHours},${report.totals.hoursReturned}`,
  ]
  res.setHeader('content-type', 'text/csv; charset=utf-8')
  res.setHeader('content-disposition', `attachment; filename="hours-returned-${report.month}.csv"`)
  res.send(lines.join('\n') + '\n')
})

export default router
