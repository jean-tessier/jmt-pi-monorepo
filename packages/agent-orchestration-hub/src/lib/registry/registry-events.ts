import type { DomainEvent } from '../events/domain-event.js'
import type { ServiceId } from './service-id.js'
import type { ServiceType } from './service-type.js'

export interface ServiceRegistered extends DomainEvent {
  readonly type: 'service.registered'
  readonly serviceId: ServiceId
  readonly serviceType: ServiceType
}

export interface ServiceDeregistered extends DomainEvent {
  readonly type: 'service.deregistered'
  readonly serviceId: ServiceId
}

export interface ServiceLost extends DomainEvent {
  readonly type: 'service.lost'
  readonly serviceId: ServiceId
  readonly lastHeartbeatAt: Date
}
