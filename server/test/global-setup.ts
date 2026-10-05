// Resets the test database and loads the demo seed once before the database tests run.
import { execSync } from 'node:child_process'

export default function setup() {
  const url = process.env.TEST_DATABASE_URL
  if (!url) return
  const name = new URL(url).pathname.replace(/^\//, '')
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to reset "${name}": TEST_DATABASE_URL must point at a database whose name ends in _test.`)
  }
  execSync('npx prisma migrate reset --force --skip-generate', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'ignore',
  })
}
