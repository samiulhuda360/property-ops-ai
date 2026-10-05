import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { app, demoAuth, hasDb } from './helpers'

describe.skipIf(!hasDb)('API on the demo data', () => {
  it('rejects requests without a token', async () => {
    const res = await request(app).get('/api/properties')
    expect(res.status).toBe(401)
  })

  it('lists the demo portfolio for the signed-in manager', async () => {
    const auth = await demoAuth()
    const properties = await request(app).get('/api/properties').set(auth)
    expect(properties.status).toBe(200)
    expect(properties.body).toHaveLength(12)

    const contractors = await request(app).get('/api/contractors').set(auth)
    expect(contractors.body.map((c: { name: string }) => c.name)).toContain('Acme Plumbing')
  })
})

describe('health', () => {
  it('answers without a database', async () => {
    const res = await request(app).get('/api/health')
    expect(res.body).toEqual({ status: 'ok' })
  })
})
