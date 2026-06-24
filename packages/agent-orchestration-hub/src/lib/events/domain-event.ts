export type DomainEventType =
  | 'service.registered'
  | 'service.deregistered'
  | 'service.lost'
  | 'task.created'
  | 'task.dispatched'
  | 'task.running'
  | 'task.completed'
  | 'task.failed'
  | 'task.blocked'
  | 'subtask.completed'
  | 'subtask.failed'
  | 'subagent.assigned'
  | 'subagent.started'
  | 'subagent.completed'
  | 'subagent.failed'
  | 'subagent.timeout'
  | 'gate.opened'
  | 'gate.closed'
  | 'gate.evaluation_failed'
  | 'prompt.routed'
  | 'routing.fallback'

export interface DomainEvent {
  readonly type: string
  readonly occurredAt: Date
}
