import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    include: ['test/e2e/**/*.test.ts'],
    pool: 'forks',
    environment: 'node',
    testTimeout: 10_000,
    hookTimeout: 10_000,
  }
})
