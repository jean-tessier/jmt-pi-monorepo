import type { DomainEvent } from '../events/domain-event.js'
import type { ServiceId } from '../registry/service-id.js'
import type { ExecutionPlan } from './execution-plan.js'
import type { SubtaskSequence } from './subtask-sequence.js'
import type { TaskId } from './task-id.js'

export interface TaskCreated extends DomainEvent {
  readonly type: 'task.created'
  readonly taskId: TaskId
  readonly plan: ExecutionPlan
}

export interface TaskDispatched extends DomainEvent {
  readonly type: 'task.dispatched'
  readonly taskId: TaskId
  readonly targetServiceId: ServiceId
}

export interface TaskRunning extends DomainEvent {
  readonly type: 'task.running'
  readonly taskId: TaskId
}

export interface TaskCompleted extends DomainEvent {
  readonly type: 'task.completed'
  readonly taskId: TaskId
}

export interface TaskFailed extends DomainEvent {
  readonly type: 'task.failed'
  readonly taskId: TaskId
  readonly reason: string
}

export interface TaskBlocked extends DomainEvent {
  readonly type: 'task.blocked'
  readonly taskId: TaskId
  readonly reason: string
}

export interface SubtaskCompleted extends DomainEvent {
  readonly type: 'subtask.completed'
  readonly taskId: TaskId
  readonly sequence: SubtaskSequence
  readonly result: string | undefined
}

export interface SubtaskFailed extends DomainEvent {
  readonly type: 'subtask.failed'
  readonly taskId: TaskId
  readonly sequence: SubtaskSequence
  readonly reason: string
}
