import { InMemoryEventBus } from '../lib/events/in-memory-event-bus.js'
import { ServiceRegistry } from '../lib/registry/service-registry.js'
import type { ServiceId } from '../lib/registry/service-id.js'
import type { ServiceLost } from '../lib/registry/registry-events.js'
import { InMemoryTaskRepository } from '../lib/task/in-memory-task-repository.js'
import type { TaskId } from '../lib/task/task-id.js'
import { TaskStatus } from '../lib/task/task-status.js'
import type { TaskDispatched } from '../lib/task/task-events.js'
import { InMemorySubagentRepository } from '../lib/execution/in-memory-subagent-repository.js'
import { InMemoryGateRepository } from '../lib/gating/in-memory-gate-repository.js'
import { GateService } from '../lib/gating/gate-service.js'
import type { GateId } from '../lib/gating/gate-id.js'
import type { GateOpened } from '../lib/gating/gate-events.js'
import { DispatchRouter } from '../lib/dispatch/dispatch-router.js'
import type { PromptRouted } from '../lib/dispatch/dispatch-events.js'
import { MonitoringProjection } from '../lib/monitoring/monitoring-projection.js'

export interface HubOptions {
  heartbeatTimeoutMs?: number
}

export class Hub {
  readonly bus: InMemoryEventBus
  readonly registry: ServiceRegistry
  readonly router: DispatchRouter
  readonly taskRepo: InMemoryTaskRepository
  readonly subagentRepo: InMemorySubagentRepository
  readonly gateRepo: InMemoryGateRepository
  readonly gateService: GateService
  readonly monitoring: MonitoringProjection
  private readonly _serviceTaskMap = new Map<ServiceId, Set<TaskId>>()
  private readonly _taskServiceMap = new Map<TaskId, ServiceId>()

  constructor(options: HubOptions = {}) {
    this.bus = new InMemoryEventBus()
    this.registry = new ServiceRegistry({
      heartbeatTimeoutMs: options.heartbeatTimeoutMs ?? 30_000,
      bus: this.bus,
    })
    this.taskRepo = new InMemoryTaskRepository()
    this.subagentRepo = new InMemorySubagentRepository()
    this.gateRepo = new InMemoryGateRepository()
    this.gateService = new GateService(this.gateRepo, this.bus)
    this.router = new DispatchRouter({ bus: this.bus, taskRepository: this.taskRepo })
    this.monitoring = new MonitoringProjection(this.bus)
    this.gateService.start()
    this._wireSubscriptions()
  }

  private _wireSubscriptions(): void {
    // prompt.routed → task.dispatch(); populate _taskServiceMap
    this.bus.on<PromptRouted>('prompt.routed', (event) => {
      const task = this.taskRepo.getById(event.taskId)
      if (task) {
        this._taskServiceMap.set(event.taskId, event.targetAgentId)
        if (task.plan.preConditionGateIds.length === 0) {
          task.dispatch(event.targetAgentId)
        }
      }
    })

    // task.dispatched → populate _serviceTaskMap
    this.bus.on<TaskDispatched>('task.dispatched', (event) => {
      const set = this._serviceTaskMap.get(event.targetServiceId) ?? new Set<TaskId>()
      set.add(event.taskId)
      this._serviceTaskMap.set(event.targetServiceId, set)
    })

    // service.lost → block associated tasks
    this.bus.on<ServiceLost>('service.lost', (event) => {
      const taskIds = this._serviceTaskMap.get(event.serviceId) ?? new Set<TaskId>()
      for (const taskId of taskIds) {
        const task = this.taskRepo.getById(taskId)
        if (
          task &&
          task.status !== TaskStatus.completed &&
          task.status !== TaskStatus.failed
        ) {
          task.block('service lost')
        }
      }
    })

    // gate.opened → dispatch pending tasks whose all pre-condition gates are now open
    this.bus.on<GateOpened>('gate.opened', (event) => {
      const allTasks = this.taskRepo
        .listAll()
        .filter(
          (t) =>
            t.status === TaskStatus.pending &&
            t.plan.preConditionGateIds.includes(event.gateId as GateId),
        )
      for (const task of allTasks) {
        const allOpen = task.plan.preConditionGateIds.every((gateId) => {
          const gate = this.gateRepo.getById(gateId as GateId)
          return gate?.isOpen() ?? false
        })
        if (allOpen) {
          const targetServiceId = this._taskServiceMap.get(task.taskId)
          if (targetServiceId) task.dispatch(targetServiceId)
        }
      }
    })
  }
}
