import { describe, it } from 'vitest'

describe('scaffold', () => {
  it('imports the domain library barrel without throwing', async () => {
    await import('../../src/lib/index.js')
  })
})
