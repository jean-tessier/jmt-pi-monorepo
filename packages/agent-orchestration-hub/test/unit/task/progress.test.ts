import { describe, it, expect } from 'vitest'
import { computeProgress } from '../../../src/lib/task/progress.js'
import { createSubtaskSequence } from '../../../src/lib/task/subtask-sequence.js'
import type { Subtask } from '../../../src/lib/task/subtask.js'

function makeSubtask(sequence: number, status: Subtask['status']): Subtask {
  return { sequence: createSubtaskSequence(sequence), description: `step ${sequence}`, status }
}

describe('computeProgress', () => {
  it('returns 0/N when no subtasks are completed', () => {
    const subtasks = [makeSubtask(1, 'pending'), makeSubtask(2, 'pending')]
    const progress = computeProgress(subtasks)
    expect(progress.completed).toBe(0)
    expect(progress.total).toBe(2)
  })

  it('returns N/N when all subtasks are completed', () => {
    const subtasks = [makeSubtask(1, 'completed'), makeSubtask(2, 'completed')]
    const progress = computeProgress(subtasks)
    expect(progress.completed).toBe(2)
    expect(progress.total).toBe(2)
  })

  it('counts skipped subtasks as completed', () => {
    const subtasks = [makeSubtask(1, 'completed'), makeSubtask(2, 'skipped')]
    const progress = computeProgress(subtasks)
    expect(progress.completed).toBe(2)
    expect(progress.total).toBe(2)
  })

  it('does not count failed subtasks as completed', () => {
    const subtasks = [makeSubtask(1, 'completed'), makeSubtask(2, 'failed')]
    const progress = computeProgress(subtasks)
    expect(progress.completed).toBe(1)
    expect(progress.total).toBe(2)
  })
})
