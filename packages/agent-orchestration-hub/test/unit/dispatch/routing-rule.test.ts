import { describe, it, expect } from 'vitest'
import { createServiceId } from '../../../src/lib/registry/service-id.js'
import type { RoutingRule } from '../../../src/lib/dispatch/routing-rule.js'

describe('RoutingRule', () => {
  it('stores the pattern as a RegExp', () => {
    const rule: RoutingRule = {
      pattern: /hello/,
      targetAgentId: createServiceId(),
    }
    expect(rule.pattern).toBeInstanceOf(RegExp)
    expect(rule.pattern.source).toBe('hello')
  })

  it('stores the targetAgentId', () => {
    const targetAgentId = createServiceId()
    const rule: RoutingRule = {
      pattern: /test/,
      targetAgentId,
    }
    expect(rule.targetAgentId).toBe(targetAgentId)
  })
})
