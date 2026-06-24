import type { TaskId } from '../task/task-id.js'

export interface DependencySpec {
  readonly taskIds: TaskId[]
}
