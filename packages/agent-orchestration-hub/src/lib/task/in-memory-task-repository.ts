import type { TaskRepository } from './task-repository.js'
import type { Task } from './task.js'
import type { TaskId } from './task-id.js'
import { TaskStatus } from './task-status.js'

export class InMemoryTaskRepository implements TaskRepository {
  private readonly tasks = new Map<TaskId, Task>()

  save(task: Task): void {
    this.tasks.set(task.taskId, task)
  }

  getById(taskId: TaskId): Task | undefined {
    return this.tasks.get(taskId)
  }

  listAll(): Task[] {
    return Array.from(this.tasks.values())
  }

  listByStatus(status: TaskStatus): Task[] {
    return Array.from(this.tasks.values()).filter(t => t.status === status)
  }
}
