import request from 'supertest'
import { createApp } from '../src/app'

export const hasDb = Boolean(process.env.TEST_DATABASE_URL)

export const app = createApp()

/** Signs in as the seeded demo user and returns an Authorization header. */
export async function demoAuth(): Promise<{ Authorization: string }> {
  const res = await request(app).post('/api/auth/login').send({ email: 'demo@example.com', password: 'demo1234' })
  if (res.status !== 200) throw new Error(`demo login failed: ${res.status}`)
  return { Authorization: `Bearer ${res.body.token}` }
}
