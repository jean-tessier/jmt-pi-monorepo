import { describe, it, expect, vi } from 'vitest'
import { InMemoryEventBus } from '../../../src/lib/events/in-memory-event-bus.js'
import { createTaskId } from '../../../src/lib/task/task-id.js'
import type {
  SubagentAssigned,
  SubagentCompleted,
  SubagentFailed,
  SubagentStarted,
  SubagentTimeout,
} from '../../../src/lib/execution/execution-events.js'
import { ExecutionStatus } from '../../../src/lib/execution/execution-status.js'
import { createSubagentId } from '../../../src/lib/execution/subagent-id.js'
import { Subagent } from '../../../src/lib/execution/subagent.js'

function makeSubagent() {
  const bus = new InMemoryEventBus()
  const subagentId = createSubagentId()
  const subagent = Subagent.create(subagentId, bus)
  return { subagent, bus, subagentId }
}

function makeAssignedSubagent() {
  const { subagent, bus, subagentId } = makeSubagent()
  const taskId = createTaskId()
  subagent.assign(taskId)
  return { subagent, bus, subagentId, taskId }
}

function makeExecutingSubagent() {
  const result = makeAssignedSubagent()
  result.subagent.start()
  return result
}

describe('Subagent', () => {
  describe('create()', () => {
    it('initialises with status idle', () => {
      const { subagent } = makeSubagent()
      expect(subagent.status).toBe(ExecutionStatus.idle)
    })

    it('initialises with no assignment', () => {
      const { subagent } = makeSubagent()
      expect(subagent.assignment).toBeUndefined()
    })
  })

  describe('assign()', () => {
    it('sets assignment and emits SubagentAssigned', () => {
      const { subagent, bus, subagentId } = makeSubagent()
      const taskId = createTaskId()
      const handler = vi.fn()
      bus.on<SubagentAssigned>('subagent.assigned', handler)

      subagent.assign(taskId)

      expect(subagent.assignment).toBeDefined()
      expect(subagent.assignment?.taskId).toBe(taskId)
      expect(subagent.assignment?.subagentId).toBe(subagentId)
      expect(handler).toHaveBeenCalledOnce()
      const event = handler.mock.calls[0][0] as SubagentAssigned
      expect(event.type).toBe('subagent.assigned')
      expect(event.subagentId).toBe(subagentId)
      expect(event.taskId).toBe(taskId)
    })

    it('throws if the subagent is not idle', () => {
      const { subagent } = makeAssignedSubagent()
      const anotherTaskId = createTaskId()
      expect(() => subagent.assign(anotherTaskId)).toThrow()
    })
  })

  describe('start()', () => {
    it('transitions to executing and emits SubagentStarted', () => {
      const { subagent, bus, subagentId, taskId } = makeAssignedSubagent()
      const handler = vi.fn()
      bus.on<SubagentStarted>('subagent.started', handler)

      subagent.start()

      expect(subagent.status).toBe(ExecutionStatus.executing)
      expect(handler).toHaveBeenCalledOnce()
      const event = handler.mock.calls[0][0] as SubagentStarted
      expect(event.type).toBe('subagent.started')
      expect(event.subagentId).toBe(subagentId)
      expect(event.taskId).toBe(taskId)
    })

    it('throws if no assignment exists', () => {
      const { subagent } = makeSubagent()
      expect(() => subagent.start()).toThrow()
    })
  })

  describe('heartbeat()', () => {
    it('updates lastHeartbeatAt to now', async () => {
      const { subagent } = makeSubagent()
      const before = subagent.lastHeartbeatAt.getTime()
      await new Promise(resolve => setTimeout(resolve, 5))
      subagent.heartbeat()
      expect(subagent.lastHeartbeatAt.getTime()).toBeGreaterThan(before)
    })
  })

  describe('complete()', () => {
    it('emits SubagentCompleted and transitions back to idle', () => {
      const { subagent, bus, subagentId, taskId } = makeExecutingSubagent()
      const handler = vi.fn()
      bus.on<SubagentCompleted>('subagent.completed', handler)

      subagent.complete()

      expect(subagent.status).toBe(ExecutionStatus.idle)
      expect(handler).toHaveBeenCalledOnce()
      const event = handler.mock.calls[0][0] as SubagentCompleted
      expect(event.type).toBe('subagent.completed')
      expect(event.subagentId).toBe(subagentId)
      expect(event.taskId).toBe(taskId)
    })

    it('clears the assignment after completion', () => {
      const { subagent } = makeExecutingSubagent()
      subagent.complete()
      expect(subagent.assignment).toBeUndefined()
    })
  })

  describe('fail()', () => {
    it('emits SubagentFailed with the reason', () => {
      const { subagent, bus, subagentId, taskId } = makeExecutingSubagent()
      const handler = vi.fn()
      bus.on<SubagentFailed>('subagent.failed', handler)

      subagent.fail('network error')

      expect(handler).toHaveBeenCalledOnce()
      const event = handler.mock.calls[0][0] as SubagentFailed
      expect(event.type).toBe('subagent.failed')
      expect(event.subagentId).toBe(subagentId)
      expect(event.taskId).toBe(taskId)
      expect(event.reason).toBe('network error')
    })
  })

  describe('checkTimeout()', () => {
    it('emits SubagentTimeout when heartbeat has exceeded the threshold', () => {
      const { subagent, bus, subagentId } = makeSubagent()
      const handler = vi.fn()
      bus.on<SubagentTimeout>('subagent.timeout', handler)

      const lastHeartbeat = subagent.lastHeartbeatAt.getTime()
      const nowMs = lastHeartbeat + 10_000
      subagent.checkTimeout(nowMs, 5_000)

      expect(subagent.status).toBe(ExecutionStatus.stalled)
      expect(handler).toHaveBeenCalledOnce()
      const event = handler.mock.calls[0][0] as SubagentTimeout
      expect(event.type).toBe('subagent.timeout')
      expect(event.subagentId).toBe(subagentId)
    })

    it('does not emit SubagentTimeout when within the threshold', () => {
      const { subagent, bus } = makeSubagent()
      const handler = vi.fn()
      bus.on<SubagentTimeout>('subagent.timeout', handler)

      const lastHeartbeat = subagent.lastHeartbeatAt.getTime()
      const nowMs = lastHeartbeat + 1_000
      subagent.checkTimeout(nowMs, 5_000)

      expect(subagent.status).toBe(ExecutionStatus.idle)
      expect(handler).not.toHaveBeenCalled()
    })

    it('does not emit SubagentTimeout again if already in stalled status', () => {
      const { subagent, bus } = makeSubagent()
      const handler = vi.fn()
      bus.on<SubagentTimeout>('subagent.timeout', handler)

      const lastHeartbeat = subagent.lastHeartbeatAt.getTime()
      const nowMs = lastHeartbeat + 10_000
      subagent.checkTimeout(nowMs, 5_000)
      subagent.checkTimeout(nowMs + 5_000, 5_000)

      expect(handler).toHaveBeenCalledOnce()
    })
  })
})
