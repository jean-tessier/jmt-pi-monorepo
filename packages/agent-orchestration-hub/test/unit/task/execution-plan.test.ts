import { describe, it, expect } from 'vitest'
import type { ExecutionPlan } from '../../../src/lib/task/execution-plan.js'

describe('ExecutionPlan', () => {
  it('accepts an ordered list of subtask specs', () => {
    const plan: ExecutionPlan = {
      subtasks: [
        { sequence: 1, description: 'First step' },
        { sequence: 2, description: 'Second step' },
      ],
      preConditionGateIds: [],
      postConditionGateIds: [],
    }
    expect(plan.subtasks).toHaveLength(2)
    expect(plan.subtasks[0].sequence).toBe(1)
    expect(plan.subtasks[1].sequence).toBe(2)
  })

  it('accepts empty preConditionGateIds and postConditionGateIds', () => {
    const plan: ExecutionPlan = {
      subtasks: [{ sequence: 1, description: 'step' }],
      preConditionGateIds: [],
      postConditionGateIds: [],
    }
    expect(plan.preConditionGateIds).toHaveLength(0)
    expect(plan.postConditionGateIds).toHaveLength(0)
  })
})
