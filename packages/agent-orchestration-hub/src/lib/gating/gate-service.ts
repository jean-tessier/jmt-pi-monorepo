import type { EventBus } from '../events/event-bus.js'
import { TaskStatus } from '../task/task-status.js'
import type { TaskCompleted } from '../task/task-events.js'
import type { TaskId } from '../task/task-id.js'
import type { GateEvaluationContext } from './gate-evaluation-context.js'
import type { GateRepository } from './gate-repository.js'

export class GateService {
  private readonly repo: GateRepository
  private readonly bus: EventBus
  private readonly handler: (event: TaskCompleted) => void

  constructor(repo: GateRepository, bus: EventBus) {
    this.repo = repo
    this.bus = bus
    this.handler = (event: TaskCompleted) => {
      const completedTaskId = event.taskId
      const gates = this.repo.listAll()
      const ctx = GateService.buildContext(completedTaskId)
      for (const gate of gates) {
        const isReferenced = gate.conditions.some(
          condition =>
            condition.expression.kind === 'task_status' &&
            condition.expression.taskId === completedTaskId,
        )
        if (isReferenced) {
          gate.evaluate(ctx)
        }
      }
    }
  }

  private static buildContext(completedTaskId: TaskId): GateEvaluationContext {
    return {
      getTaskStatus: (taskId: TaskId) => {
        if (taskId === completedTaskId) {
          return TaskStatus.completed
        }
        return undefined
      },
    }
  }

  start(): void {
    this.bus.on<TaskCompleted>('task.completed', this.handler)
  }

  stop(): void {
    this.bus.off<TaskCompleted>('task.completed', this.handler)
  }
}
