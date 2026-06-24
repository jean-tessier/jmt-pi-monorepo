import type { TaskId } from '../task/task-id.js'
import type { TaskStatus } from '../task/task-status.js'

export interface GateEvaluationContext {
  getTaskStatus(taskId: TaskId): TaskStatus | undefined
}
