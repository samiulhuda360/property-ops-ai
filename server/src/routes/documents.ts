import { Router, Response, NextFunction } from 'express'
import multer from 'multer'
import { aiConfig, aiEnabled } from '../ai/llm'
import { exportXeroBills, listAccountingBills, pushToAccounting } from '../documents/export'
import {
  approveDocument,
  defaultMethod,
  DocumentError,
  processDocument,
  rejectDocument,
  storedFilePath,
} from '../documents/service'
import { prisma } from '../lib/prisma'
import { authenticate, AuthRequest } from '../middleware/auth'

const router = Router()
router.use(authenticate)

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } })
const STATUSES = ['needs_review', 'approved', 'exported', 'rejected']

const RELATIONS = {
  property: { select: { id: true, code: true, address: true, suburb: true } },
  contractor: { select: { id: true, name: true, trade: true, gstNumber: true, bankAccount: true } },
  maintenanceRequest: { select: { id: true, title: true, status: true, quoteAmount: true } },
  lease: {
    select: {
      id: true,
      weeklyRent: true,
      bondAmount: true,
      startDate: true,
      endDate: true,
      status: true,
      tenant: { select: { firstName: true, lastName: true } },
    },
  },
} as const

function fail(res: Response, e: unknown) {
  if (e instanceof DocumentError) {
    res.status(e.status).json({ error: e.message })
    return
  }
  console.error(e)
  res.status(500).json({ error: 'Server error' })
}

/** Which extraction method uploads use right now. */
router.get('/method', (_req: AuthRequest, res: Response) => {
  res.json({ method: defaultMethod(), aiEnabled: aiEnabled(), model: aiEnabled() ? aiConfig().model : null })
})

/**
 * Approved invoices as a CSV in the Xero bill-import layout. Downloading marks them exported.
 * ?ids=1,2 downloads those invoices again (approved or already exported).
 */
router.get('/export/xero-bills.csv', async (req: AuthRequest, res: Response) => {
  try {
    const ids =
      typeof req.query.ids === 'string' && req.query.ids.trim()
        ? req.query.ids.split(',').map((s) => Number(s)).filter(Number.isInteger)
        : undefined
    const result = await exportXeroBills(req.userId!, ids)
    if (!result) {
      res.status(404).json({ error: 'No approved invoices to export.' })
      return
    }
    const day = new Date().toISOString().slice(0, 10)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="xero-bills-${day}.csv"`)
    res.setHeader('X-Exported-Count', String(result.count))
    res.send(result.csv)
  } catch (e) {
    fail(res, e)
  }
})

/** Bills sent to the accounting adapter (the mock keeps them in a local file). */
router.get('/accounting/bills', async (req: AuthRequest, res: Response) => {
  try {
    res.json(await listAccountingBills(req.userId!))
  } catch (e) {
    fail(res, e)
  }
})

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const status = typeof req.query.status === 'string' && STATUSES.includes(req.query.status) ? req.query.status : undefined
    const kind = req.query.kind === 'invoice' || req.query.kind === 'lease' ? req.query.kind : undefined
    const documents = await prisma.document.findMany({
      where: { userId: req.userId, ...(status ? { status } : {}), ...(kind ? { kind } : {}) },
      select: {
        id: true,
        kind: true,
        fileName: true,
        method: true,
        extracted: true,
        issues: true,
        status: true,
        invoiceNumber: true,
        invoiceDate: true,
        dueDate: true,
        total: true,
        gst: true,
        reviewedAt: true,
        reviewSeconds: true,
        createdAt: true,
        propertyId: true,
        contractorId: true,
        maintenanceRequestId: true,
        leaseId: true,
        ...RELATIONS,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    res.json(documents)
  } catch (e) {
    fail(res, e)
  }
})

/** Upload one PDF (form field "file"); it is read, checked and queued for review. */
router.post(
  '/',
  (req: AuthRequest, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (err) {
        const tooBig = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
        res.status(400).json({ error: tooBig ? 'The file is larger than 10 MB.' : 'Upload one PDF in the "file" field.' })
        return
      }
      next()
    })
  },
  async (req: AuthRequest, res: Response) => {
    try {
      const file = req.file
      if (!file) {
        res.status(400).json({ error: 'Upload one PDF in the "file" field.' })
        return
      }
      const doc = await processDocument({ userId: req.userId!, fileName: file.originalname || 'document.pdf', data: file.buffer })
      const full = await prisma.document.findUnique({ where: { id: doc.id }, include: RELATIONS })
      res.status(201).json(full)
    } catch (e) {
      fail(res, e)
    }
  },
)

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const doc = await prisma.document.findFirst({
      where: { id: Number(req.params.id) || -1, userId: req.userId },
      include: RELATIONS,
    })
    if (!doc) {
      res.status(404).json({ error: 'Document not found' })
      return
    }
    res.json(doc)
  } catch (e) {
    fail(res, e)
  }
})

/** The original PDF, for the review screen (fetched with the token, shown from a blob URL). */
router.get('/:id/file', async (req: AuthRequest, res: Response) => {
  try {
    const doc = await prisma.document.findFirst({
      where: { id: Number(req.params.id) || -1, userId: req.userId },
      select: { fileName: true, storagePath: true },
    })
    const path = doc ? storedFilePath(doc.storagePath) : null
    if (!doc || !path) {
      res.status(404).json({ error: 'File not found' })
      return
    }
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${doc.fileName.replace(/[^A-Za-z0-9._-]/g, '_')}"`)
    res.sendFile(path)
  } catch (e) {
    fail(res, e)
  }
})

/** Body: { fields: { name: value }, reviewSeconds }. Records the review; nothing is paid or posted. */
router.post('/:id/approve', async (req: AuthRequest, res: Response) => {
  try {
    const result = await approveDocument(req.userId!, Number(req.params.id), req.body ?? {})
    const document = await prisma.document.findUnique({ where: { id: result.document.id }, include: RELATIONS })
    res.json({ document, changedFields: result.changedFields })
  } catch (e) {
    fail(res, e)
  }
})

/** Body: { reviewSeconds, reason? }. */
router.post('/:id/reject', async (req: AuthRequest, res: Response) => {
  try {
    const doc = await rejectDocument(req.userId!, Number(req.params.id), req.body ?? {})
    res.json(await prisma.document.findUnique({ where: { id: doc.id }, include: RELATIONS }))
  } catch (e) {
    fail(res, e)
  }
})

/** Sends one approved invoice to the accounting adapter as a draft bill (a person's button). */
router.post('/:id/push', async (req: AuthRequest, res: Response) => {
  try {
    res.json(await pushToAccounting(req.userId!, Number(req.params.id)))
  } catch (e) {
    fail(res, e)
  }
})

export default router
