import { describe, it, expect, vi } from 'vitest'
import { InMemoryEventBus } from '../../../src/lib/events/in-memory-event-bus.js'
import { createTaskId } from '../../../src/lib/task/task-id.js'
import { TaskStatus } from '../../../src/lib/task/task-status.js'
import type { TaskCompleted } from '../../../src/lib/task/task-events.js'
import { Gate } from '../../../src/lib/gating/gate.js'
import { createGateId } from '../../../src/lib/gating/gate-id.js'
import { GatePolicy } from '../../../src/lib/gating/gate-policy.js'
import { GateState } from '../../../src/lib/gating/gate-state.js'
import { InMemoryGateRepository } from '../../../src/lib/gating/in-memory-gate-repository.js'
import { GateService } from '../../../src/lib/gating/gate-service.js'
import type { GateOpened } from '../../../src/lib/gating/gate-events.js'

describe('GateService', () => {
  it('evaluates gates referencing a task when task.completed is emitted on the bus', () => {
    const bus = new InMemoryEventBus()
    const repo = new InMemoryGateRepository()

    const taskId = createTaskId()
    const gate = Gate.create(
      createGateId(),
      [{ kind: 'task_status', taskId, requiredStatus: TaskStatus.completed }],
      GatePolicy.all_of,
      bus,
    )
    repo.save(gate)

    const openedHandler = vi.fn()
    bus.on<GateOpened>('gate.opened', openedHandler)

    const service = new GateService(repo, bus)
    service.start()

    const event: TaskCompleted = {
      type: 'task.completed',
      occurredAt: new Date(),
      taskId,
    }
    bus.emit(event)

    expect(gate.state).toBe(GateState.open)
    expect(openedHandler).toHaveBeenCalledOnce()
  })

  it('does not evaluate gates that do not reference the completed task', () => {
    const bus = new InMemoryEventBus()
    const repo = new InMemoryGateRepository()

    const taskIdA = createTaskId()
    const taskIdB = createTaskId()

    // Gate references taskIdA only
    const gate = Gate.create(
      createGateId(),
      [{ kind: 'task_status', taskId: taskIdA, requiredStatus: TaskStatus.completed }],
      GatePolicy.all_of,
      bus,
    )
    repo.save(gate)

    const openedHandler = vi.fn()
    bus.on<GateOpened>('gate.opened', openedHandler)

    const service = new GateService(repo, bus)
    service.start()

    // Emit completion for taskIdB — gate should NOT be evaluated
    const event: TaskCompleted = {
      type: 'task.completed',
      occurredAt: new Date(),
      taskId: taskIdB,
    }
    bus.emit(event)

    expect(gate.state).toBe(GateState.closed)
    expect(openedHandler).not.toHaveBeenCalled()
  })

  it('stops listening after stop() is called', () => {
    const bus = new InMemoryEventBus()
    const repo = new InMemoryGateRepository()

    const taskId = createTaskId()
    const gate = Gate.create(
      createGateId(),
      [{ kind: 'task_status', taskId, requiredStatus: TaskStatus.completed }],
      GatePolicy.all_of,
      bus,
    )
    repo.save(gate)

    const openedHandler = vi.fn()
    bus.on<GateOpened>('gate.opened', openedHandler)

    const service = new GateService(repo, bus)
    service.start()
    service.stop()

    // Emit task.completed after stop — gate should NOT be evaluated
    const event: TaskCompleted = {
      type: 'task.completed',
      occurredAt: new Date(),
      taskId,
    }
    bus.emit(event)

    expect(gate.state).toBe(GateState.closed)
    expect(openedHandler).not.toHaveBeenCalled()
  })
})
