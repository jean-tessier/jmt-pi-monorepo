import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    pool: 'forks',
    coverage: { provider: 'v8' },
    environment: 'node'
  }
})
