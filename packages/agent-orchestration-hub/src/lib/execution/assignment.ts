import type { TaskId } from '../task/task-id.js'
import type { SubagentId } from './subagent-id.js'

export interface Assignment {
  readonly taskId: TaskId
  readonly subagentId: SubagentId
  readonly assignedAt: Date
}
