import { defineConfig } from 'vitest/config'

// Database tests run only when TEST_DATABASE_URL points at a disposable database (its name must end in _test);
// global-setup resets it and loads the demo seed. Unit tests always run.
const testDb = process.env.TEST_DATABASE_URL

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 20_000,
    globalSetup: testDb ? ['test/global-setup.ts'] : [],
    env: {
      JWT_SECRET: 'test-secret',
      AI_DRIVER: 'off',
      ...(testDb ? { DATABASE_URL: testDb } : {}),
    },
  },
})
