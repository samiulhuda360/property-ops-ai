import { NextFunction, Response, Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { authenticate, AuthRequest } from '../middleware/auth'
import { loadDemo } from '../reconciliation/demo'
import { buildWorkbook } from '../reconciliation/excel'
import {
  batchSummary,
  importStatement,
  latestBatch,
  listBatches,
  listTransactions,
  ReconciliationError,
  resolveLine,
  type StatusFilter,
} from '../reconciliation/service'

// Rent reconciliation: import a bank statement CSV, match it, review the exceptions, export the workbook.
const router = Router()
router.use(authenticate)

const MAX_BYTES = 2 * 1024 * 1024
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } })

type Handler = (req: AuthRequest, res: Response) => Promise<void>

const handle = (fn: Handler) => async (req: AuthRequest, res: Response) => {
  try {
    await fn(req, res)
  } catch (e) {
    if (e instanceof ReconciliationError) {
      res.status(e.status).json({ error: e.message, details: e.details })
      return
    }
    console.error(e)
    res.status(500).json({ error: 'Server error' })
  }
}

/** Bank exports are UTF-8 or Windows-1252; read the bytes as UTF-8 when they are valid UTF-8, else as Latin-1. */
function decode(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return buffer.toString('latin1')
  }
}

async function batchFrom(req: AuthRequest): Promise<string | null> {
  const requested = typeof req.query.batch === 'string' ? req.query.batch.trim() : ''
  return requested || (await latestBatch(req.userId!))
}

/** POST /api/reconciliation/import (multipart, field "file"): imports the lines and runs the matching. */
router.post(
  '/import',
  (req: AuthRequest, res: Response, next: NextFunction) =>
    upload.single('file')(req, res, (err: unknown) => {
      if (err) {
        const tooBig = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
        res.status(400).json({ error: tooBig ? 'The file is larger than 2 MB.' : 'The upload failed. Attach one CSV file.' })
        return
      }
      next()
    }),
  handle(async (req, res) => {
    const file = req.file
    if (!file) {
      res.status(400).json({ error: 'Attach the bank statement as a CSV file in the "file" field.' })
      return
    }
    if (!/\.(csv|txt)$/i.test(file.originalname)) {
      res.status(400).json({ error: 'Upload the CSV export from the bank (a .csv file).' })
      return
    }
    const result = await importStatement(req.userId!, file.originalname, decode(file.buffer))
    res.status(result.alreadyImported ? 200 : 201).json(result)
  }),
)

/** POST /api/reconciliation/demo: imports the synthetic September 2026 statement for the signed-in manager. */
router.post(
  '/demo',
  handle(async (req, res) => {
    const result = await loadDemo(req.userId!)
    res.status(result.alreadyImported ? 200 : 201).json(result)
  }),
)

/** GET /api/reconciliation/batches: imported statements, newest first. */
router.get(
  '/batches',
  handle(async (req, res) => {
    res.json(await listBatches(req.userId!))
  }),
)

const STATUSES: StatusFilter[] = ['all', 'exception', 'matched', 'ignored', 'resolved']

/** GET /api/reconciliation/transactions?batch=&status=all|exception|matched|ignored|resolved */
router.get(
  '/transactions',
  handle(async (req, res) => {
    const status = (typeof req.query.status === 'string' && req.query.status) || 'all'
    if (!STATUSES.includes(status as StatusFilter)) {
      res.status(400).json({ error: `status must be one of ${STATUSES.join(', ')}` })
      return
    }
    const batch = await batchFrom(req)
    res.json(batch ? await listTransactions(req.userId!, batch, status as StatusFilter) : [])
  }),
)

/** GET /api/reconciliation/summary?batch= (defaults to the latest statement). */
router.get(
  '/summary',
  handle(async (req, res) => {
    const batch = await batchFrom(req)
    const summary = batch ? await batchSummary(req.userId!, batch) : null
    if (!summary) {
      res.status(404).json({ error: batch ? 'That statement was not found.' : 'No statement has been imported yet.' })
      return
    }
    res.json(summary)
  }),
)

const resolveBody = z.object({
  decision: z.enum(['accept', 'reassign', 'ignore']),
  leaseId: z.number().int().positive().optional(),
  jobId: z.number().int().positive().optional(),
  note: z.string().max(1000).optional(),
  reviewSeconds: z.number().min(0).max(86_400),
})

/** POST /api/reconciliation/transactions/:id/resolve { decision, leaseId?, jobId?, note?, reviewSeconds } */
router.post(
  '/transactions/:id/resolve',
  handle(async (req, res) => {
    const id = Number(req.params.id)
    const parsed = resolveBody.safeParse(req.body)
    if (!Number.isInteger(id) || id <= 0 || !parsed.success) {
      res.status(400).json({
        error: 'Send a decision (accept, reassign or ignore) and reviewSeconds; reassign needs a leaseId or jobId.',
        details: parsed.success ? undefined : parsed.error.issues,
      })
      return
    }
    res.json(await resolveLine(req.userId!, id, parsed.data))
  }),
)

/** GET /api/reconciliation/export.xlsx?batch=: Summary, Exceptions (with a Decision column), Matched and Arrears. */
router.get(
  '/export.xlsx',
  handle(async (req, res) => {
    const batch = await batchFrom(req)
    const summary = batch ? await batchSummary(req.userId!, batch) : null
    if (!batch || !summary) {
      res.status(404).json({ error: 'No statement to export.' })
      return
    }
    const lines = await listTransactions(req.userId!, batch, 'all')
    const book = buildWorkbook({ summary, lines, generatedAt: new Date() })
    const buffer = Buffer.from(await book.xlsx.writeBuffer())
    res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('content-disposition', `attachment; filename="reconciliation-${batch}.xlsx"`)
    res.send(buffer)
  }),
)

export default router
