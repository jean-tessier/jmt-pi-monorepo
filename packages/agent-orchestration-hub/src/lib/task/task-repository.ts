import type { Task } from './task.js'
import type { TaskId } from './task-id.js'
import type { TaskStatus } from './task-status.js'

export interface TaskRepository {
  save(task: Task): void
  getById(taskId: TaskId): Task | undefined
  listAll(): Task[]
  listByStatus(status: TaskStatus): Task[]
}
