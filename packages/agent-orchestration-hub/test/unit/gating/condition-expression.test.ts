import { describe, it, expect } from 'vitest'
import { createTaskId } from '../../../src/lib/task/task-id.js'
import { TaskStatus } from '../../../src/lib/task/task-status.js'
import {
  evaluateCondition,
} from '../../../src/lib/gating/condition-expression.js'
import type { GateEvaluationContext } from '../../../src/lib/gating/gate-evaluation-context.js'

describe('evaluateCondition', () => {
  it('returns true when task status matches the required status', () => {
    const taskId = createTaskId()
    const ctx: GateEvaluationContext = {
      getTaskStatus: () => TaskStatus.completed,
    }
    const result = evaluateCondition(
      { kind: 'task_status', taskId, requiredStatus: TaskStatus.completed },
      ctx,
    )
    expect(result).toBe(true)
  })

  it('returns false when task status does not match', () => {
    const taskId = createTaskId()
    const ctx: GateEvaluationContext = {
      getTaskStatus: () => TaskStatus.running,
    }
    const result = evaluateCondition(
      { kind: 'task_status', taskId, requiredStatus: TaskStatus.completed },
      ctx,
    )
    expect(result).toBe(false)
  })

  it('returns false when the task is not found in the context', () => {
    const taskId = createTaskId()
    const ctx: GateEvaluationContext = {
      getTaskStatus: () => undefined,
    }
    const result = evaluateCondition(
      { kind: 'task_status', taskId, requiredStatus: TaskStatus.completed },
      ctx,
    )
    expect(result).toBe(false)
  })
})
