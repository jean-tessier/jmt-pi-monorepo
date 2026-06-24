import type { EventBus } from '../events/event-bus.js'
import type { TaskId } from '../task/task-id.js'
import type { Assignment } from './assignment.js'
import type {
  SubagentAssigned,
  SubagentCompleted,
  SubagentFailed,
  SubagentStarted,
  SubagentTimeout,
} from './execution-events.js'
import { ExecutionStatus } from './execution-status.js'
import type { SubagentId } from './subagent-id.js'

export class Subagent {
  readonly subagentId: SubagentId
  private _status: ExecutionStatus
  private _assignment: Assignment | undefined
  private _lastHeartbeatAt: Date
  private readonly bus: EventBus

  private constructor(subagentId: SubagentId, bus: EventBus, createdAt: Date) {
    this.subagentId = subagentId
    this._status = ExecutionStatus.idle
    this._assignment = undefined
    this._lastHeartbeatAt = createdAt
    this.bus = bus
  }

  get status(): ExecutionStatus {
    return this._status
  }

  get assignment(): Assignment | undefined {
    return this._assignment
  }

  get lastHeartbeatAt(): Date {
    return this._lastHeartbeatAt
  }

  static create(subagentId: SubagentId, bus: EventBus): Subagent {
    return new Subagent(subagentId, bus, new Date())
  }

  assign(taskId: TaskId): void {
    if (this._assignment !== undefined || this._status !== ExecutionStatus.idle) {
      throw new Error(`Cannot assign task to subagent in status: ${this._status}`)
    }
    const assignedAt = new Date()
    this._assignment = { taskId, subagentId: this.subagentId, assignedAt }
    const event: SubagentAssigned = {
      type: 'subagent.assigned',
      occurredAt: assignedAt,
      subagentId: this.subagentId,
      taskId,
      assignedAt,
    }
    this.bus.emit(event)
  }

  start(): void {
    if (!this._assignment) {
      throw new Error('Cannot start: no assignment exists')
    }
    this._status = ExecutionStatus.executing
    const event: SubagentStarted = {
      type: 'subagent.started',
      occurredAt: new Date(),
      subagentId: this.subagentId,
      taskId: this._assignment.taskId,
    }
    this.bus.emit(event)
  }

  heartbeat(): void {
    this._lastHeartbeatAt = new Date()
  }

  complete(): void {
    const taskId = this._assignment!.taskId
    this._status = ExecutionStatus.idle
    this._assignment = undefined
    const event: SubagentCompleted = {
      type: 'subagent.completed',
      occurredAt: new Date(),
      subagentId: this.subagentId,
      taskId,
    }
    this.bus.emit(event)
  }

  fail(reason: string): void {
    const taskId = this._assignment?.taskId
    const event: SubagentFailed = {
      type: 'subagent.failed',
      occurredAt: new Date(),
      subagentId: this.subagentId,
      taskId: taskId!,
      reason,
    }
    this.bus.emit(event)
  }

  checkTimeout(nowMs: number, timeoutMs: number): void {
    if (this._status === ExecutionStatus.stalled) {
      return
    }
    if (nowMs - this._lastHeartbeatAt.getTime() > timeoutMs) {
      this._status = ExecutionStatus.stalled
      const event: SubagentTimeout = {
        type: 'subagent.timeout',
        occurredAt: new Date(nowMs),
        subagentId: this.subagentId,
        taskId: this._assignment?.taskId,
        lastHeartbeatAt: this._lastHeartbeatAt,
      }
      this.bus.emit(event)
    }
  }
}
