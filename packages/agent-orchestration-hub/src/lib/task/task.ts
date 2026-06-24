import type { EventBus } from '../events/event-bus.js'
import type { ServiceId } from '../registry/service-id.js'
import type { ExecutionPlan } from './execution-plan.js'
import type { Subtask } from './subtask.js'
import type {
  SubtaskCompleted,
  SubtaskFailed,
  TaskBlocked,
  TaskCompleted,
  TaskCreated,
  TaskDispatched,
  TaskFailed,
  TaskRunning,
} from './task-events.js'
import { TaskId, createTaskId } from './task-id.js'
import { TaskStatus } from './task-status.js'
import { SubtaskSequence, createSubtaskSequence } from './subtask-sequence.js'

export class Task {
  readonly taskId: TaskId
  private _status: TaskStatus
  private readonly _subtasks: Subtask[]
  private readonly _plan: ExecutionPlan
  private readonly bus: EventBus

  private constructor(taskId: TaskId, plan: ExecutionPlan, bus: EventBus) {
    this.taskId = taskId
    this._status = TaskStatus.pending
    this._plan = plan
    this._subtasks = plan.subtasks
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map(spec => ({
        sequence: createSubtaskSequence(spec.sequence),
        description: spec.description,
        status: 'pending' as const,
      }))
    this.bus = bus
  }

  get status(): TaskStatus {
    return this._status
  }

  get subtasks(): readonly Subtask[] {
    return this._subtasks
  }

  get plan(): ExecutionPlan {
    return this._plan
  }

  static create(plan: ExecutionPlan, bus: EventBus): Task {
    if (plan.subtasks.length === 0) {
      throw new Error('ExecutionPlan must have at least one subtask')
    }
    const sequences = plan.subtasks.map(s => s.sequence)
    if (new Set(sequences).size !== sequences.length) {
      throw new Error('ExecutionPlan subtasks must have unique sequence numbers')
    }

    const taskId = createTaskId()
    const task = new Task(taskId, plan, bus)
    const event: TaskCreated = {
      type: 'task.created',
      occurredAt: new Date(),
      taskId,
      plan,
    }
    bus.emit(event)
    return task
  }

  dispatch(targetServiceId: ServiceId): void {
    if (this._status !== TaskStatus.pending) {
      throw new Error(`Cannot dispatch task in status: ${this._status}`)
    }
    this._status = TaskStatus.dispatched
    const event: TaskDispatched = {
      type: 'task.dispatched',
      occurredAt: new Date(),
      taskId: this.taskId,
      targetServiceId,
    }
    this.bus.emit(event)
  }

  start(): void {
    if (this._status !== TaskStatus.dispatched) {
      throw new Error(`Cannot start task in status: ${this._status}`)
    }
    this._status = TaskStatus.running
    const event: TaskRunning = {
      type: 'task.running',
      occurredAt: new Date(),
      taskId: this.taskId,
    }
    this.bus.emit(event)
  }

  completeSubtask(sequence: SubtaskSequence, result?: string): void {
    const subtask = this._subtasks.find(s => s.sequence === sequence)
    if (!subtask) {
      throw new Error(`Subtask not found: sequence ${sequence}`)
    }
    if (subtask.status === 'completed') {
      throw new Error(`Subtask already completed: sequence ${sequence}`)
    }
    subtask.status = 'completed'
    subtask.result = result
    const event: SubtaskCompleted = {
      type: 'subtask.completed',
      occurredAt: new Date(),
      taskId: this.taskId,
      sequence,
      result,
    }
    this.bus.emit(event)
  }

  failSubtask(sequence: SubtaskSequence, reason: string): void {
    const subtask = this._subtasks.find(s => s.sequence === sequence)
    if (!subtask) {
      throw new Error(`Subtask not found: sequence ${sequence}`)
    }
    subtask.status = 'failed'
    const event: SubtaskFailed = {
      type: 'subtask.failed',
      occurredAt: new Date(),
      taskId: this.taskId,
      sequence,
      reason,
    }
    this.bus.emit(event)
    this.fail(reason)
  }

  complete(): void {
    if (this._status === TaskStatus.completed) {
      throw new Error('Task is already completed')
    }
    const allDone = this._subtasks.every(
      s => s.status === 'completed' || s.status === 'skipped',
    )
    if (!allDone) {
      throw new Error('Cannot complete task: not all subtasks are completed or skipped')
    }
    this._status = TaskStatus.completed
    const event: TaskCompleted = {
      type: 'task.completed',
      occurredAt: new Date(),
      taskId: this.taskId,
    }
    this.bus.emit(event)
  }

  fail(reason: string): void {
    if (this._status === TaskStatus.completed) {
      throw new Error('Cannot fail an already-completed task')
    }
    this._status = TaskStatus.failed
    const event: TaskFailed = {
      type: 'task.failed',
      occurredAt: new Date(),
      taskId: this.taskId,
      reason,
    }
    this.bus.emit(event)
  }

  block(reason: string): void {
    this._status = TaskStatus.blocked
    const event: TaskBlocked = {
      type: 'task.blocked',
      occurredAt: new Date(),
      taskId: this.taskId,
      reason,
    }
    this.bus.emit(event)
  }
}
