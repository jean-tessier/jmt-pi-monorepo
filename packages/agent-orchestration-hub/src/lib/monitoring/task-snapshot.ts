import type { SubagentId } from '../execution/subagent-id.js'
import type { ExecutionPlan } from '../task/execution-plan.js'
import type { TaskId } from '../task/task-id.js'
import type { Progress } from '../task/progress.js'
import type { TaskStatus } from '../task/task-status.js'
import type { SubtaskSnapshot } from './subtask-snapshot.js'

export interface TaskSnapshot {
  readonly taskId: TaskId
  readonly status: TaskStatus
  readonly plan: ExecutionPlan
  readonly subtasks: readonly SubtaskSnapshot[]
  readonly progress: Progress
  readonly assignedSubagentId: SubagentId | undefined
  readonly createdAt: Date
  readonly updatedAt: Date
}
