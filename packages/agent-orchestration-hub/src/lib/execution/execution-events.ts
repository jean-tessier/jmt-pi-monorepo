import type { DomainEvent } from '../events/domain-event.js'
import type { TaskId } from '../task/task-id.js'
import type { SubagentId } from './subagent-id.js'

export interface SubagentAssigned extends DomainEvent {
  readonly type: 'subagent.assigned'
  readonly subagentId: SubagentId
  readonly taskId: TaskId
  readonly assignedAt: Date
}

export interface SubagentStarted extends DomainEvent {
  readonly type: 'subagent.started'
  readonly subagentId: SubagentId
  readonly taskId: TaskId
}

export interface SubagentCompleted extends DomainEvent {
  readonly type: 'subagent.completed'
  readonly subagentId: SubagentId
  readonly taskId: TaskId
}

export interface SubagentFailed extends DomainEvent {
  readonly type: 'subagent.failed'
  readonly subagentId: SubagentId
  readonly taskId: TaskId
  readonly reason: string
}

export interface SubagentTimeout extends DomainEvent {
  readonly type: 'subagent.timeout'
  readonly subagentId: SubagentId
  readonly taskId: TaskId | undefined
  readonly lastHeartbeatAt: Date
}
