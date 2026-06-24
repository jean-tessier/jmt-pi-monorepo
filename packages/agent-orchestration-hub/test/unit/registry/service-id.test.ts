import { describe, it, expect } from 'vitest'
import { createServiceId } from '../../../src/lib/registry/service-id.js'

describe('createServiceId', () => {
  it('returns a non-empty string', () => {
    const id = createServiceId()
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('returns unique values on successive calls', () => {
    const id1 = createServiceId()
    const id2 = createServiceId()
    expect(id1).not.toBe(id2)
  })
})
