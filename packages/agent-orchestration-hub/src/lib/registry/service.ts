import type { ServiceId } from './service-id.js'
import type { ServiceStatus } from './service-status.js'
import type { ServiceType } from './service-type.js'

export interface Service {
  readonly serviceId: ServiceId
  readonly type: ServiceType
  status: ServiceStatus
  readonly registeredAt: Date
  lastHeartbeatAt: Date
}
