import type { SubtaskSequence } from '../task/subtask-sequence.js'

export interface SubtaskSnapshot {
  readonly sequence: SubtaskSequence
  readonly description: string
  readonly status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  readonly result: string | undefined
}
