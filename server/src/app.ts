import express from 'express'
import cors from 'cors'

import { setCallLogger } from './ai/llm'
import { prisma } from './lib/prisma'
import authRoutes from './routes/auth'
import propertyRoutes from './routes/properties'
import tenantRoutes from './routes/tenants'
import leaseRoutes from './routes/leases'
import paymentRoutes from './routes/payments'
import maintenanceRoutes from './routes/maintenance'
import contractorRoutes from './routes/contractors'
import documentRoutes from './routes/documents'
import reconciliationRoutes from './routes/reconciliation'
import inboxRoutes from './routes/inbox'
import webhookRoutes from './routes/webhooks'
import reportRoutes from './routes/reports'

// Every model call is stored for the AI usage panel; a failed write never breaks a feature.
setCallLogger((record) => prisma.aiCall.create({ data: record }).then(() => undefined))

export function createApp() {
  const app = express()

  const allowedOrigins = process.env.FRONTEND_URL
    ? [process.env.FRONTEND_URL, 'http://localhost:5173']
    : ['http://localhost:5173']
  app.use(cors({ origin: allowedOrigins, credentials: true }))
  app.use(express.json({ limit: '1mb' }))

  app.use('/api/auth', authRoutes)
  app.use('/api/properties', propertyRoutes)
  app.use('/api/tenants', tenantRoutes)
  app.use('/api/leases', leaseRoutes)
  app.use('/api/payments', paymentRoutes)
  app.use('/api/maintenance', maintenanceRoutes)
  app.use('/api/contractors', contractorRoutes)
  app.use('/api/documents', documentRoutes)
  app.use('/api/reconciliation', reconciliationRoutes)
  app.use('/api/inbox', inboxRoutes)
  app.use('/api/webhooks', webhookRoutes)
  app.use('/api/reports', reportRoutes)

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))
  return app
}
