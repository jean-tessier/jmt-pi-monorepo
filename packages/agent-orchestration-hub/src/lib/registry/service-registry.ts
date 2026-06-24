import type { EventBus } from '../events/event-bus.js'
import type { ServiceId } from './service-id.js'
import type { ServiceDeregistered, ServiceLost, ServiceRegistered } from './registry-events.js'
import type { Service } from './service.js'
import { ServiceStatus } from './service-status.js'
import { ServiceType } from './service-type.js'

export interface ServiceRegistryOptions {
  readonly heartbeatTimeoutMs: number
  readonly bus: EventBus
}

export class ServiceRegistry {
  private readonly services = new Map<ServiceId, Service>()
  private readonly heartbeatTimeoutMs: number
  private readonly bus: EventBus

  constructor(options: ServiceRegistryOptions) {
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 30_000
    this.bus = options.bus
  }

  register(serviceId: ServiceId, type: ServiceType): Service {
    if (this.services.has(serviceId)) {
      throw new Error(`Service already registered: ${serviceId}`)
    }
    const now = new Date()
    const service: Service = {
      serviceId,
      type,
      status: ServiceStatus.active,
      registeredAt: now,
      lastHeartbeatAt: now,
    }
    this.services.set(serviceId, service)
    const event: ServiceRegistered = {
      type: 'service.registered',
      occurredAt: now,
      serviceId,
      serviceType: type,
    }
    this.bus.emit(event)
    return service
  }

  deregister(serviceId: ServiceId): void {
    const service = this.services.get(serviceId)
    if (!service) {
      throw new Error(`Service not found: ${serviceId}`)
    }
    service.status = ServiceStatus.disconnected
    const event: ServiceDeregistered = {
      type: 'service.deregistered',
      occurredAt: new Date(),
      serviceId,
    }
    this.bus.emit(event)
  }

  heartbeat(serviceId: ServiceId): void {
    const service = this.services.get(serviceId)
    if (!service) {
      throw new Error(`Service not found: ${serviceId}`)
    }
    service.lastHeartbeatAt = new Date()
  }

  checkForLostServices(nowMs: number): void {
    for (const service of this.services.values()) {
      if (service.status === ServiceStatus.disconnected) continue
      const elapsed = nowMs - service.lastHeartbeatAt.getTime()
      if (elapsed > this.heartbeatTimeoutMs) {
        const lastHeartbeatAt = service.lastHeartbeatAt
        service.status = ServiceStatus.disconnected
        const event: ServiceLost = {
          type: 'service.lost',
          occurredAt: new Date(nowMs),
          serviceId: service.serviceId,
          lastHeartbeatAt,
        }
        this.bus.emit(event)
      }
    }
  }

  getById(serviceId: ServiceId): Service | undefined {
    return this.services.get(serviceId)
  }

  listByType(type: ServiceType): Service[] {
    return Array.from(this.services.values()).filter(s => s.type === type)
  }

  listAll(): Service[] {
    return Array.from(this.services.values())
  }
}
