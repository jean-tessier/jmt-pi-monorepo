import { describe, it, expect } from 'vitest'
import { Hub } from '../../../src/server/hub.js'
import { RequestHandler } from '../../../src/server/request-handler.js'
import { TaskStatus } from '../../../src/lib/task/task-status.js'
import { createServiceId } from '../../../src/lib/registry/service-id.js'
import { ServiceType } from '../../../src/lib/registry/service-type.js'
import { Gate } from '../../../src/lib/gating/gate.js'
import { createGateId } from '../../../src/lib/gating/gate-id.js'

import { GatePolicy } from '../../../src/lib/gating/gate-policy.js'
import { Task } from '../../../src/lib/task/task.js'
import type { TaskId } from '../../../src/lib/task/task-id.js'
import type { PromptRouted } from '../../../src/lib/dispatch/dispatch-events.js'

describe('Hub cross-context wiring', () => {
  it('blocks a task when the assigned service is declared lost', () => {
    const hub = new Hub({ heartbeatTimeoutMs: 50 })
    const handler = new RequestHandler(hub)

    // Register a service
    const registerResponse = handler.handle({
      id: 'r1',
      method: 'register_service',
      params: { serviceType: 'agent' },
    })
    const serviceId = (registerResponse as { id: string; result: { serviceId: string } }).result.serviceId

    // Add a routing rule and dispatch a prompt
    handler.handle({
      id: 'rule1',
      method: 'add_routing_rule',
      params: { pattern: '.*', targetAgentId: serviceId },
    })
    const dispatchResponse = handler.handle({
      id: 'd1',
      method: 'dispatch_prompt',
      params: { text: 'do something' },
    })
    const taskId = (dispatchResponse as { id: string; result: { taskId: string } }).result.taskId

    // Confirm task is dispatched
    const snapshot1 = hub.monitoring.getTaskStatus(taskId as TaskId)
    expect(snapshot1?.status).toBe(TaskStatus.dispatched)

    // Simulate service timeout
    hub.registry.checkForLostServices(Date.now() + 1000)

    // Task should now be blocked
    const snapshot2 = hub.monitoring.getTaskStatus(taskId as TaskId)
    expect(snapshot2?.status).toBe(TaskStatus.blocked)
  })

  it('dispatches a pending gated task when its pre-condition gate opens', () => {
    const hub = new Hub()

    // Create and register a gate
    const gateId = createGateId()
    const gate = Gate.create(gateId, [{ kind: 'task_status', taskId: 'dummy' as TaskId, requiredStatus: TaskStatus.completed }], GatePolicy.all_of, hub.bus)
    hub.gateRepo.save(gate)

    // Register a target service
    const serviceId = createServiceId()
    hub.registry.register(serviceId, ServiceType.agent)

    // Create a task with the pre-condition gate, save it, and wire _taskServiceMap by emitting prompt.routed manually
    const task = Task.create(
      {
        subtasks: [{ sequence: 1, description: 'Gated step' }],
        preConditionGateIds: [gateId as string],
        postConditionGateIds: [],
      },
      hub.bus,
    )
    hub.taskRepo.save(task)

    // Manually populate _taskServiceMap by emitting prompt.routed
    const routedEvent: PromptRouted = {
      type: 'prompt.routed',
      occurredAt: new Date(),
      prompt: { text: 'gated task', metadata: {} },
      targetAgentId: serviceId,
      matchedPattern: '.*',
      taskId: task.taskId,
    }
    hub.bus.emit(routedEvent)

    // Task should still be pending (gate is not open)
    expect(hub.monitoring.getTaskStatus(task.taskId)?.status).toBe(TaskStatus.pending)

    // Force-open the gate
    gate.forceOpen()

    // Task should now be dispatched
    expect(hub.monitoring.getTaskStatus(task.taskId)?.status).toBe(TaskStatus.dispatched)
  })

  it.skip('opens post-condition gates when a task completes', () => {
    // Deferred to Step 10 — requires post-condition gate wiring beyond MVP scope
  })

  it.skip('blocks a task when its assigned subagent times out', () => {
    // Deferred to Step 10 — requires subagent creation flow not exposed in protocol
  })
})
