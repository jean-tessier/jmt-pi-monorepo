import { describe, it, expect, vi } from 'vitest'
import { InMemoryEventBus } from '../../../src/lib/events/in-memory-event-bus.js'
import { createServiceId } from '../../../src/lib/registry/service-id.js'
import { ServiceRegistry } from '../../../src/lib/registry/service-registry.js'
import { ServiceStatus } from '../../../src/lib/registry/service-status.js'
import { ServiceType } from '../../../src/lib/registry/service-type.js'
import type { ServiceRegistered, ServiceDeregistered, ServiceLost } from '../../../src/lib/registry/registry-events.js'

const TIMEOUT_MS = 30_000

function makeRegistry() {
  const bus = new InMemoryEventBus()
  const registry = new ServiceRegistry({ heartbeatTimeoutMs: TIMEOUT_MS, bus })
  return { registry, bus }
}

describe('ServiceRegistry', () => {
  describe('register()', () => {
    it('adds a service with status active', () => {
      const { registry } = makeRegistry()
      const id = createServiceId()
      const service = registry.register(id, ServiceType.agent)
      expect(service.serviceId).toBe(id)
      expect(service.type).toBe(ServiceType.agent)
      expect(service.status).toBe(ServiceStatus.active)
    })

    it('emits ServiceRegistered with correct serviceId and type', () => {
      const { registry, bus } = makeRegistry()
      const handler = vi.fn()
      bus.on<ServiceRegistered>('service.registered', handler)
      const id = createServiceId()
      registry.register(id, ServiceType.db)
      expect(handler).toHaveBeenCalledOnce()
      const evt: ServiceRegistered = handler.mock.calls[0][0]
      expect(evt.serviceId).toBe(id)
      expect(evt.serviceType).toBe(ServiceType.db)
    })

    it('throws if the same serviceId is registered twice', () => {
      const { registry } = makeRegistry()
      const id = createServiceId()
      registry.register(id, ServiceType.agent)
      expect(() => registry.register(id, ServiceType.agent)).toThrow()
    })
  })

  describe('deregister()', () => {
    it('sets service status to disconnected', () => {
      const { registry } = makeRegistry()
      const id = createServiceId()
      const service = registry.register(id, ServiceType.agent)
      registry.deregister(id)
      expect(service.status).toBe(ServiceStatus.disconnected)
    })

    it('emits ServiceDeregistered', () => {
      const { registry, bus } = makeRegistry()
      const handler = vi.fn()
      bus.on<ServiceDeregistered>('service.deregistered', handler)
      const id = createServiceId()
      registry.register(id, ServiceType.agent)
      registry.deregister(id)
      expect(handler).toHaveBeenCalledOnce()
      const evt: ServiceDeregistered = handler.mock.calls[0][0]
      expect(evt.serviceId).toBe(id)
    })

    it('throws if serviceId is not found', () => {
      const { registry } = makeRegistry()
      const id = createServiceId()
      expect(() => registry.deregister(id)).toThrow()
    })
  })

  describe('heartbeat()', () => {
    it('updates lastHeartbeatAt on the service', async () => {
      const { registry } = makeRegistry()
      const id = createServiceId()
      const service = registry.register(id, ServiceType.agent)
      const before = service.lastHeartbeatAt.getTime()
      await new Promise(r => setTimeout(r, 5))
      registry.heartbeat(id)
      expect(service.lastHeartbeatAt.getTime()).toBeGreaterThan(before)
    })

    it('throws if serviceId is not found', () => {
      const { registry } = makeRegistry()
      const id = createServiceId()
      expect(() => registry.heartbeat(id)).toThrow()
    })
  })

  describe('checkForLostServices()', () => {
    it('emits ServiceLost for each service whose heartbeat has expired', () => {
      const { registry, bus } = makeRegistry()
      const handler = vi.fn()
      bus.on<ServiceLost>('service.lost', handler)
      const id = createServiceId()
      registry.register(id, ServiceType.agent)
      const futureMs = Date.now() + TIMEOUT_MS + 1
      registry.checkForLostServices(futureMs)
      expect(handler).toHaveBeenCalledOnce()
      const evt: ServiceLost = handler.mock.calls[0][0]
      expect(evt.serviceId).toBe(id)
    })

    it('does not emit ServiceLost for services within the heartbeat window', () => {
      const { registry, bus } = makeRegistry()
      const handler = vi.fn()
      bus.on<ServiceLost>('service.lost', handler)
      const id = createServiceId()
      registry.register(id, ServiceType.agent)
      registry.checkForLostServices(Date.now())
      expect(handler).not.toHaveBeenCalled()
    })

    it('sets the lost service status to disconnected', () => {
      const { registry } = makeRegistry()
      const id = createServiceId()
      const service = registry.register(id, ServiceType.agent)
      registry.checkForLostServices(Date.now() + TIMEOUT_MS + 1)
      expect(service.status).toBe(ServiceStatus.disconnected)
    })

    it('does not emit ServiceLost twice for the same already-disconnected service', () => {
      const { registry, bus } = makeRegistry()
      const handler = vi.fn()
      bus.on<ServiceLost>('service.lost', handler)
      const id = createServiceId()
      registry.register(id, ServiceType.agent)
      const futureMs = Date.now() + TIMEOUT_MS + 1
      registry.checkForLostServices(futureMs)
      registry.checkForLostServices(futureMs + TIMEOUT_MS)
      expect(handler).toHaveBeenCalledOnce()
    })
  })

  describe('getById()', () => {
    it('returns the service when registered', () => {
      const { registry } = makeRegistry()
      const id = createServiceId()
      registry.register(id, ServiceType.ui)
      expect(registry.getById(id)).toBeDefined()
    })

    it('returns undefined when not registered', () => {
      const { registry } = makeRegistry()
      const id = createServiceId()
      expect(registry.getById(id)).toBeUndefined()
    })
  })

  describe('listByType()', () => {
    it('returns only services of the requested type', () => {
      const { registry } = makeRegistry()
      registry.register(createServiceId(), ServiceType.agent)
      registry.register(createServiceId(), ServiceType.agent)
      registry.register(createServiceId(), ServiceType.db)
      const agents = registry.listByType(ServiceType.agent)
      expect(agents).toHaveLength(2)
      expect(agents.every(s => s.type === ServiceType.agent)).toBe(true)
    })

    it('returns an empty array when no services of that type exist', () => {
      const { registry } = makeRegistry()
      registry.register(createServiceId(), ServiceType.agent)
      expect(registry.listByType(ServiceType.webhook)).toHaveLength(0)
    })
  })
})
