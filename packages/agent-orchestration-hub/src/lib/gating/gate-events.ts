import type { DomainEvent } from '../events/domain-event.js'
import type { GateId } from './gate-id.js'

export interface GateOpened extends DomainEvent {
  readonly type: 'gate.opened'
  readonly gateId: GateId
}

export interface GateClosed extends DomainEvent {
  readonly type: 'gate.closed'
  readonly gateId: GateId
}

export interface GateEvaluationFailed extends DomainEvent {
  readonly type: 'gate.evaluation_failed'
  readonly gateId: GateId
  readonly reason: string
}
