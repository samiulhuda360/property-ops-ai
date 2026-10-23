import { Router, Response, NextFunction } from 'express'
import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import multer from 'multer'
import { aiConfig, aiEnabled } from '../ai/llm'
import { DEMO_LEASES, DEMO_LEASES_DIR } from '../leases/demo'
import {
  approveLease,
  defaultRoute,
  exportLease,
  importIssuedInvoices,
  leaseCsv,
  LeaseError,
  processLease,
  rejectLease,
  reviewField,
  reviewRisk,
  storedFilePath,
} from '../leases/service'
import { FIELD_LABELS, TERM_FIELDS } from '../leases/types'
import { prisma } from '../lib/prisma'
import { PermissionError } from '../lib/actor'
import { authenticate, requireWrite, AuthRequest } from '../middleware/auth'

const router = Router()
router.use(authenticate)
router.use(requireWrite)

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } })
const STATUSES = ['needs_review', 'approved', 'rejected']
const RELATIONS = { property: { select: { id: true, code: true, address: true, suburb: true } } } as const
const LIST_SELECT = {
  id: true,
  fileName: true,
  country: true,
  leaseType: true,
  route: true,
  leaseRef: true,
  terms: true,
  issues: true,
  risks: true,
  reconciliation: true,
  status: true,
  reviewedAt: true,
  reviewSeconds: true,
  createdAt: true,
  propertyId: true,
  ...RELATIONS,
} as const

function fail(res: Response, e: unknown) {
  if (e instanceof LeaseError || e instanceof PermissionError) {
    res.status(e.status).json({ error: e.message })
    return
  }
  console.error(e)
  res.status(500).json({ error: 'Server error' })
}

/** Which route uploads use right now, and the field list for the client. */
router.get('/method', (_req: AuthRequest, res: Response) => {
  res.json({
    route: defaultRoute(),
    aiEnabled: aiEnabled(),
    model: aiEnabled() ? aiConfig().model : null,
    fields: TERM_FIELDS.map((f) => ({ key: f, label: FIELD_LABELS[f] })),
  })
})

/** The sample leases shipped with the demo, for "pick a sample". */
router.get('/samples', (_req: AuthRequest, res: Response) => {
  res.json(DEMO_LEASES.map((s) => ({ ...s, available: existsSync(join(DEMO_LEASES_DIR, s.file)) })))
})

/** Abstracts one of the sample leases as if it had just been uploaded. */
router.post('/samples/:file', async (req: AuthRequest, res: Response) => {
  try {
    const file = basename(String(req.params.file))
    const sample = DEMO_LEASES.find((s) => s.file === file)
    const path = join(DEMO_LEASES_DIR, file)
    if (!sample || !existsSync(path)) {
      res.status(404).json({ error: 'Sample not found' })
      return
    }
    const lease = await processLease({ actor: req.actor!, fileName: file, data: readFileSync(path) })
    res.status(201).json(lease)
  } catch (e) {
    fail(res, e)
  }
})

/** Imports the billing system's issued invoices (CSV in the "file" field) for reconciliation. */
router.post(
  '/invoices',
  (req: AuthRequest, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (err) {
        res.status(400).json({ error: 'Upload one CSV in the "file" field.' })
        return
      }
      next()
    })
  },
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'Upload one CSV in the "file" field.' })
        return
      }
      const imported = await importIssuedInvoices(req.actor!, req.file.buffer.toString('utf8'))
      res.json({ imported })
    } catch (e) {
      fail(res, e)
    }
  },
)

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const status = typeof req.query.status === 'string' && STATUSES.includes(req.query.status) ? req.query.status : undefined
    const leases = await prisma.leaseAbstract.findMany({
      where: { organisationId: req.actor!.organisationId, ...(status ? { status } : {}) },
      select: LIST_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    res.json(leases)
  } catch (e) {
    fail(res, e)
  }
})

/** Upload one lease PDF (form field "file"); it is read, checked and queued for review. */
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
      const lease = await processLease({ actor: req.actor!, fileName: file.originalname || 'lease.pdf', data: file.buffer })
      res.status(201).json(lease)
    } catch (e) {
      fail(res, e)
    }
  },
)

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const lease = await prisma.leaseAbstract.findFirst({ where: { id: Number(req.params.id) || -1, organisationId: req.actor!.organisationId }, include: RELATIONS })
    if (!lease) {
      res.status(404).json({ error: 'Lease not found' })
      return
    }
    res.json(lease)
  } catch (e) {
    fail(res, e)
  }
})

/** The original PDF, for the review screen. */
router.get('/:id/file', async (req: AuthRequest, res: Response) => {
  try {
    const lease = await prisma.leaseAbstract.findFirst({
      where: { id: Number(req.params.id) || -1, organisationId: req.actor!.organisationId },
      select: { fileName: true, storagePath: true },
    })
    const path = lease ? storedFilePath(lease.storagePath) : null
    if (!lease || !path) {
      res.status(404).json({ error: 'File not found' })
      return
    }
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${lease.fileName.replace(/[^A-Za-z0-9._-]/g, '_')}"`)
    res.sendFile(path)
  } catch (e) {
    fail(res, e)
  }
})

/** The audit trail: who extracted, approved, corrected or decided what, and when. */
router.get('/:id/audit', async (req: AuthRequest, res: Response) => {
  try {
    const lease = await prisma.leaseAbstract.findFirst({ where: { id: Number(req.params.id) || -1, organisationId: req.actor!.organisationId }, select: { id: true } })
    if (!lease) {
      res.status(404).json({ error: 'Lease not found' })
      return
    }
    const events = await prisma.auditEvent.findMany({
      where: { leaseAbstractId: lease.id },
      include: { user: { select: { name: true, email: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    res.json(events)
  } catch (e) {
    fail(res, e)
  }
})

/** The abstraction as JSON (?format=csv for the CSV). */
router.get('/:id/export', async (req: AuthRequest, res: Response) => {
  try {
    const x = await exportLease(req.actor!, Number(req.params.id))
    const stem = x.fileName.replace(/\.pdf$/i, '').replace(/[^A-Za-z0-9._-]/g, '_')
    if (req.query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="${stem}-abstract.csv"`)
      res.send(leaseCsv(x))
      return
    }
    res.setHeader('Content-Disposition', `attachment; filename="${stem}-abstract.json"`)
    res.json(x)
  } catch (e) {
    fail(res, e)
  }
})

/** Body: { approve: true } to approve the term as read, or { value } to correct it. */
router.post('/:id/fields/:field', async (req: AuthRequest, res: Response) => {
  try {
    res.json(await reviewField(req.actor!, Number(req.params.id), String(req.params.field), req.body ?? {}))
  } catch (e) {
    fail(res, e)
  }
})

/** Body: { status: accepted | dismissed | open, note? }. */
router.post('/:id/risks/:code', async (req: AuthRequest, res: Response) => {
  try {
    res.json(await reviewRisk(req.actor!, Number(req.params.id), String(req.params.code), req.body ?? {}))
  } catch (e) {
    fail(res, e)
  }
})

/** Body: { reviewSeconds }. Records the decision; nothing is posted anywhere. */
router.post('/:id/approve', async (req: AuthRequest, res: Response) => {
  try {
    res.json(await approveLease(req.actor!, Number(req.params.id), req.body ?? {}))
  } catch (e) {
    fail(res, e)
  }
})

/** Body: { reviewSeconds, reason? }. */
router.post('/:id/reject', async (req: AuthRequest, res: Response) => {
  try {
    res.json(await rejectLease(req.actor!, Number(req.params.id), req.body ?? {}))
  } catch (e) {
    fail(res, e)
  }
})

export default router
