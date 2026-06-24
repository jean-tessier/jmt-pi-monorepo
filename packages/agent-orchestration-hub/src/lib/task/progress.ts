import type { Subtask } from './subtask.js'

export interface Progress {
  readonly completed: number
  readonly total: number
}

export function computeProgress(subtasks: Subtask[]): Progress {
  const total = subtasks.length
  const completed = subtasks.filter(
    s => s.status === 'completed' || s.status === 'skipped',
  ).length
  return { completed, total }
}
