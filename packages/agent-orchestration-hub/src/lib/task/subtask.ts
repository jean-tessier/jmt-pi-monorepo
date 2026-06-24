import type { SubtaskSequence } from './subtask-sequence.js'

export type SubtaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export interface Subtask {
  sequence: SubtaskSequence
  description: string
  status: SubtaskStatus
  result?: string
}
