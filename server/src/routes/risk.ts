import { Router, Response } from 'express'
import { PermissionError } from '../lib/actor'
import { authenticate, requireWrite, AuthRequest } from '../middleware/auth'
import { loadModel, NEXT_STEP_LABELS } from '../risk/model'
import { listRisks, reviewRisk, RiskError, riskHistory, scoreOrganisation } from '../risk/service'

// Arrears risk for the signed-in company's tenancies. Approving a next step stores it; nothing is sent from here.
const router = Router()
router.use(authenticate)
router.use(requireWrite)

const BANDS = ['low', 'medium', 'high']

function fail(res: Response, e: unknown) {
  if (e instanceof RiskError || e instanceof PermissionError) {
    res.status(e.status).json({ error: e.message })
    return
  }
  console.error(e)
  res.status(500).json({ error: 'Server error' })
}

/** The model behind the scores: version, features, backtest numbers, bands. */
router.get('/model', (_req: AuthRequest, res: Response) => {
  try {
    const m = loadModel()
    res.json({ version: m.version, trainedAt: m.trainedAt, features: m.features, bands: m.bands, training: m.training, backtest: m.backtest, nextSteps: NEXT_STEP_LABELS })
  } catch (e) {
    fail(res, e)
  }
})

/** GET /api/risk?band=high: every scored tenancy, highest probability first. */
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const band = typeof req.query.band === 'string' && BANDS.includes(req.query.band) ? req.query.band : undefined
    res.json(await listRisks(req.actor!.organisationId, band))
  } catch (e) {
    fail(res, e)
  }
})

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    res.json(await riskHistory(req.actor!.organisationId, Number(req.params.id) || -1))
  } catch (e) {
    fail(res, e)
  }
})

/** Scores every tenancy again from the rent history on file (for example after importing a bank statement). */
router.post('/rescore', async (req: AuthRequest, res: Response) => {
  try {
    const asOf = typeof req.body?.asOf === 'string' && /^\d{4}-\d{2}$/.test(req.body.asOf) ? req.body.asOf : undefined
    res.json(await scoreOrganisation(req.actor!, asOf))
  } catch (e) {
    fail(res, e)
  }
})

/** Body: { decision: approve | dismiss, nextStep?, draft?, note?, reviewSeconds }. */
router.post('/:id/review', async (req: AuthRequest, res: Response) => {
  try {
    res.json(await reviewRisk(req.actor!, Number(req.params.id) || -1, req.body ?? {}))
  } catch (e) {
    fail(res, e)
  }
})

export default router
