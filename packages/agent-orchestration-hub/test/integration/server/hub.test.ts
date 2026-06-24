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
import { Subagent } from '../../../src/lib/execution/subagent.js'
import { createSubagentId } from '../../../src/lib/execution/subagent-id.js'

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

  it('opens post-condition gates when a task completes', () => {
    const hub = new Hub()
    const handler = new RequestHandler(hub)

    // Create a gate with 1 condition so it starts closed
    const gateId = createGateId()
    const gate = Gate.create(
      gateId,
      [{ kind: 'task_status', taskId: 'dummy' as TaskId, requiredStatus: TaskStatus.completed }],
      GatePolicy.all_of,
      hub.bus,
    )
    hub.gateRepo.save(gate)

    // Create a task with 1 subtask and a post-condition gate
    const serviceId = createServiceId()
    const task = Task.create(
      {
        subtasks: [{ sequence: 1, description: 'Step 1' }],
        preConditionGateIds: [],
        postConditionGateIds: [gateId as string],
      },
      hub.bus,
    )
    hub.taskRepo.save(task)

    // Wire _taskServiceMap by emitting prompt.routed (same pattern as existing gated-task test)
    const routedEvent: PromptRouted = {
      type: 'prompt.routed',
      occurredAt: new Date(),
      prompt: { text: 'post-condition test', metadata: {} },
      targetAgentId: serviceId,
      matchedPattern: '.*',
      taskId: task.taskId,
    }
    hub.bus.emit(routedEvent)

    // Gate is still closed before task completes
    expect(gate.isOpen()).toBe(false)

    // Complete the subtask — handler auto-calls task.complete() when all subtasks done
    handler.handle({
      id: 'sub1',
      method: 'report_subtask_completed',
      params: { taskId: task.taskId, sequence: 1 },
    })

    // task.completed event fired → hub handler opened the post-condition gate
    expect(gate.isOpen()).toBe(true)
  })

  it('blocks a task when its assigned subagent times out', () => {
    const hub = new Hub()
    const handler = new RequestHandler(hub)

    // Register a service and dispatch a prompt to get a task
    const registerResponse = handler.handle({
      id: 'r1',
      method: 'register_service',
      params: { serviceType: 'agent' },
    })
    const serviceId = (registerResponse as { id: string; result: { serviceId: string } }).result.serviceId

    handler.handle({
      id: 'rule1',
      method: 'add_routing_rule',
      params: { pattern: '.*', targetAgentId: serviceId },
    })

    const dispatchResponse = handler.handle({
      id: 'd1',
      method: 'dispatch_prompt',
      params: { text: 'timeout test' },
    })
    const taskId = (dispatchResponse as { id: string; result: { taskId: string } }).result.taskId

    // Confirm task is dispatched
    expect(hub.monitoring.getTaskStatus(taskId as TaskId)?.status).toBe(TaskStatus.dispatched)

    // Create a subagent, assign it the task, save it
    const subagentId = createSubagentId()
    const subagent = Subagent.create(subagentId, hub.bus)
    subagent.assign(taskId as TaskId)
    hub.subagentRepo.save(subagent)

    // Trigger a timeout (nowMs well past heartbeat, timeoutMs tiny)
    subagent.checkTimeout(Date.now() + 10_000, 100)

    // subagent.timeout event fired → hub handler blocked the task
    expect(hub.monitoring.getTaskStatus(taskId as TaskId)?.status).toBe(TaskStatus.blocked)
  })
})
