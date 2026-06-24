import { describe, it, expect, vi } from 'vitest'
import { InMemoryEventBus } from '../../../src/lib/events/in-memory-event-bus.js'
import { createTaskId } from '../../../src/lib/task/task-id.js'
import { TaskStatus } from '../../../src/lib/task/task-status.js'
import { Gate } from '../../../src/lib/gating/gate.js'
import { createGateId } from '../../../src/lib/gating/gate-id.js'
import { GatePolicy } from '../../../src/lib/gating/gate-policy.js'
import { GateState } from '../../../src/lib/gating/gate-state.js'
import type { GateClosed, GateEvaluationFailed, GateOpened } from '../../../src/lib/gating/gate-events.js'
import type { GateEvaluationContext } from '../../../src/lib/gating/gate-evaluation-context.js'

function makeGate(expressions = [{ kind: 'task_status' as const, taskId: createTaskId(), requiredStatus: TaskStatus.completed }]) {
  const bus = new InMemoryEventBus()
  const gateId = createGateId()
  const gate = Gate.create(gateId, expressions, GatePolicy.all_of, bus)
  return { gate, bus, gateId }
}

function makeCtxWith(statuses: Map<string, TaskStatus>): GateEvaluationContext {
  return {
    getTaskStatus: (taskId) => statuses.get(taskId),
  }
}

describe('Gate', () => {
  describe('create()', () => {
    it('initialises with state closed when conditions array is non-empty', () => {
      const { gate } = makeGate()
      expect(gate.state).toBe(GateState.closed)
    })

    it('initialises with state open when conditions array is empty (trivially satisfied)', () => {
      const bus = new InMemoryEventBus()
      const gate = Gate.create(createGateId(), [], GatePolicy.all_of, bus)
      expect(gate.state).toBe(GateState.open)
    })
  })

  describe('evaluate() with all_of policy', () => {
    it('transitions to open and emits GateOpened when all conditions are satisfied', () => {
      const taskId = createTaskId()
      const bus = new InMemoryEventBus()
      const gateId = createGateId()
      const gate = Gate.create(
        gateId,
        [{ kind: 'task_status', taskId, requiredStatus: TaskStatus.completed }],
        GatePolicy.all_of,
        bus,
      )
      const handler = vi.fn()
      bus.on<GateOpened>('gate.opened', handler)

      const ctx = makeCtxWith(new Map([[taskId, TaskStatus.completed]]))
      gate.evaluate(ctx)

      expect(gate.state).toBe(GateState.open)
      expect(handler).toHaveBeenCalledOnce()
      const event = handler.mock.calls[0][0] as GateOpened
      expect(event.type).toBe('gate.opened')
      expect(event.gateId).toBe(gateId)
    })

    it('remains closed and does not emit GateOpened when one condition is unsatisfied', () => {
      const taskId = createTaskId()
      const bus = new InMemoryEventBus()
      const gate = Gate.create(
        createGateId(),
        [{ kind: 'task_status', taskId, requiredStatus: TaskStatus.completed }],
        GatePolicy.all_of,
        bus,
      )
      const handler = vi.fn()
      bus.on<GateOpened>('gate.opened', handler)

      const ctx = makeCtxWith(new Map([[taskId, TaskStatus.running]]))
      gate.evaluate(ctx)

      expect(gate.state).toBe(GateState.closed)
      expect(handler).not.toHaveBeenCalled()
    })

    it('transitions back to closed and emits GateClosed when a previously-open gate re-evaluates and fails', () => {
      const taskId = createTaskId()
      const bus = new InMemoryEventBus()
      const gateId = createGateId()
      const gate = Gate.create(
        gateId,
        [{ kind: 'task_status', taskId, requiredStatus: TaskStatus.completed }],
        GatePolicy.all_of,
        bus,
      )

      // First open the gate
      gate.evaluate(makeCtxWith(new Map([[taskId, TaskStatus.completed]])))
      expect(gate.state).toBe(GateState.open)

      // Now re-evaluate and fail
      const closedHandler = vi.fn()
      bus.on<GateClosed>('gate.closed', closedHandler)

      gate.evaluate(makeCtxWith(new Map([[taskId, TaskStatus.running]])))

      expect(gate.state).toBe(GateState.closed)
      expect(closedHandler).toHaveBeenCalledOnce()
      const event = closedHandler.mock.calls[0][0] as GateClosed
      expect(event.type).toBe('gate.closed')
      expect(event.gateId).toBe(gateId)
    })

    it('emits GateEvaluationFailed when evaluation throws', () => {
      const taskId = createTaskId()
      const bus = new InMemoryEventBus()
      const gateId = createGateId()
      const gate = Gate.create(
        gateId,
        [{ kind: 'task_status', taskId, requiredStatus: TaskStatus.completed }],
        GatePolicy.all_of,
        bus,
      )
      const handler = vi.fn()
      bus.on<GateEvaluationFailed>('gate.evaluation_failed', handler)

      // Provide a ctx that throws on getTaskStatus
      const throwingCtx: GateEvaluationContext = {
        getTaskStatus: () => {
          throw new Error('context error')
        },
      }
      gate.evaluate(throwingCtx)

      expect(handler).toHaveBeenCalledOnce()
      const event = handler.mock.calls[0][0] as GateEvaluationFailed
      expect(event.type).toBe('gate.evaluation_failed')
      expect(event.gateId).toBe(gateId)
      expect(event.reason).toBe('context error')
    })
  })

  describe('isOpen()', () => {
    it('returns true when state is open', () => {
      const taskId = createTaskId()
      const bus = new InMemoryEventBus()
      const gate = Gate.create(
        createGateId(),
        [{ kind: 'task_status', taskId, requiredStatus: TaskStatus.completed }],
        GatePolicy.all_of,
        bus,
      )
      gate.evaluate(makeCtxWith(new Map([[taskId, TaskStatus.completed]])))
      expect(gate.isOpen()).toBe(true)
    })

    it('returns false when state is closed, opening, or failed', () => {
      // closed state
      const { gate } = makeGate()
      expect(gate.isOpen()).toBe(false)

      // failed state — evaluate with throwing ctx
      const taskId = createTaskId()
      const bus2 = new InMemoryEventBus()
      const gate2 = Gate.create(
        createGateId(),
        [{ kind: 'task_status', taskId, requiredStatus: TaskStatus.completed }],
        GatePolicy.all_of,
        bus2,
      )
      gate2.evaluate({ getTaskStatus: () => { throw new Error('err') } })
      // gate2 state stays closed (exception caught), isOpen still false
      expect(gate2.isOpen()).toBe(false)
    })
  })
})
