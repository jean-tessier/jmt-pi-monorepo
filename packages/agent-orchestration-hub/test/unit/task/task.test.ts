import { describe, it, expect, vi } from 'vitest'
import { InMemoryEventBus } from '../../../src/lib/events/in-memory-event-bus.js'
import { createServiceId } from '../../../src/lib/registry/service-id.js'
import type { ExecutionPlan } from '../../../src/lib/task/execution-plan.js'
import { createSubtaskSequence } from '../../../src/lib/task/subtask-sequence.js'
import type { SubtaskCompleted, SubtaskFailed, TaskBlocked, TaskCompleted, TaskCreated, TaskDispatched, TaskFailed, TaskRunning } from '../../../src/lib/task/task-events.js'
import { Task } from '../../../src/lib/task/task.js'
import { TaskStatus } from '../../../src/lib/task/task-status.js'

function makePlan(overrides: Partial<ExecutionPlan> = {}): ExecutionPlan {
  return {
    subtasks: [
      { sequence: 1, description: 'First step' },
      { sequence: 2, description: 'Second step' },
    ],
    preConditionGateIds: [],
    postConditionGateIds: [],
    ...overrides,
  }
}

function makeTask(plan = makePlan()) {
  const bus = new InMemoryEventBus()
  const task = Task.create(plan, bus)
  return { task, bus }
}

function makeRunningTask() {
  const serviceId = createServiceId()
  const { task, bus } = makeTask()
  task.dispatch(serviceId)
  task.start()
  return { task, bus, serviceId }
}

describe('Task', () => {
  describe('create()', () => {
    it('initialises with status pending', () => {
      const { task } = makeTask()
      expect(task.status).toBe(TaskStatus.pending)
    })

    it('initialises subtasks from the execution plan in sequence order', () => {
      const plan = makePlan({
        subtasks: [
          { sequence: 2, description: 'Second' },
          { sequence: 1, description: 'First' },
        ],
      })
      const { task } = makeTask(plan)
      expect(task.subtasks).toHaveLength(2)
      expect(task.subtasks[0].sequence).toBe(1)
      expect(task.subtasks[1].sequence).toBe(2)
      expect(task.subtasks[0].status).toBe('pending')
    })

    it('emits TaskCreated with the full execution plan', () => {
      const bus = new InMemoryEventBus()
      const plan = makePlan()
      const handler = vi.fn()
      bus.on<TaskCreated>('task.created', handler)
      const task = Task.create(plan, bus)
      expect(handler).toHaveBeenCalledOnce()
      const event = handler.mock.calls[0][0] as TaskCreated
      expect(event.taskId).toBe(task.taskId)
      expect(event.plan).toBe(plan)
    })

    it('throws if the execution plan has no subtasks', () => {
      const bus = new InMemoryEventBus()
      const plan = makePlan({ subtasks: [] })
      expect(() => Task.create(plan, bus)).toThrow()
    })

    it('throws if two subtasks have the same sequence number', () => {
      const bus = new InMemoryEventBus()
      const plan = makePlan({
        subtasks: [
          { sequence: 1, description: 'A' },
          { sequence: 1, description: 'B' },
        ],
      })
      expect(() => Task.create(plan, bus)).toThrow()
    })
  })

  describe('dispatch()', () => {
    it('transitions status to dispatched and emits TaskDispatched', () => {
      const { task, bus } = makeTask()
      const handler = vi.fn()
      bus.on<TaskDispatched>('task.dispatched', handler)
      const serviceId = createServiceId()
      task.dispatch(serviceId)
      expect(task.status).toBe(TaskStatus.dispatched)
      expect(handler).toHaveBeenCalledOnce()
      const event = handler.mock.calls[0][0] as TaskDispatched
      expect(event.taskId).toBe(task.taskId)
      expect(event.targetServiceId).toBe(serviceId)
    })

    it('throws when called on a non-pending task', () => {
      const serviceId = createServiceId()
      const { task } = makeTask()
      task.dispatch(serviceId)
      expect(() => task.dispatch(serviceId)).toThrow()
    })
  })

  describe('start()', () => {
    it('transitions status to running and emits TaskRunning', () => {
      const { task, bus } = makeTask()
      const handler = vi.fn()
      bus.on<TaskRunning>('task.running', handler)
      task.dispatch(createServiceId())
      task.start()
      expect(task.status).toBe(TaskStatus.running)
      expect(handler).toHaveBeenCalledOnce()
      const event = handler.mock.calls[0][0] as TaskRunning
      expect(event.taskId).toBe(task.taskId)
    })

    it('throws when called on a non-dispatched task', () => {
      const { task } = makeTask()
      expect(() => task.start()).toThrow()
    })
  })

  describe('completeSubtask()', () => {
    it('marks the subtask completed and emits SubtaskCompleted with result', () => {
      const { task, bus } = makeRunningTask()
      const handler = vi.fn()
      bus.on<SubtaskCompleted>('subtask.completed', handler)
      const seq = createSubtaskSequence(1)
      task.completeSubtask(seq, 'done')
      const subtask = task.subtasks.find(s => s.sequence === 1)
      expect(subtask?.status).toBe('completed')
      expect(subtask?.result).toBe('done')
      expect(handler).toHaveBeenCalledOnce()
      const event = handler.mock.calls[0][0] as SubtaskCompleted
      expect(event.sequence).toBe(1)
      expect(event.result).toBe('done')
    })

    it('throws if the sequence number does not exist', () => {
      const { task } = makeRunningTask()
      const seq = createSubtaskSequence(99)
      expect(() => task.completeSubtask(seq)).toThrow()
    })

    it('throws if the subtask is already completed', () => {
      const { task } = makeRunningTask()
      const seq = createSubtaskSequence(1)
      task.completeSubtask(seq)
      expect(() => task.completeSubtask(seq)).toThrow()
    })
  })

  describe('failSubtask()', () => {
    it('marks the subtask failed and emits SubtaskFailed', () => {
      const { task, bus } = makeRunningTask()
      const subtaskHandler = vi.fn()
      const taskFailedHandler = vi.fn()
      bus.on<SubtaskFailed>('subtask.failed', subtaskHandler)
      bus.on<TaskFailed>('task.failed', taskFailedHandler)
      const seq = createSubtaskSequence(1)
      task.failSubtask(seq, 'oops')
      const subtask = task.subtasks.find(s => s.sequence === 1)
      expect(subtask?.status).toBe('failed')
      expect(subtaskHandler).toHaveBeenCalledOnce()
      const event = subtaskHandler.mock.calls[0][0] as SubtaskFailed
      expect(event.sequence).toBe(1)
      expect(event.reason).toBe('oops')
      expect(taskFailedHandler).toHaveBeenCalledOnce()
    })

    it('throws if the sequence number does not exist', () => {
      const { task } = makeRunningTask()
      const seq = createSubtaskSequence(99)
      expect(() => task.failSubtask(seq, 'bad')).toThrow()
    })
  })

  describe('complete()', () => {
    it('transitions to completed and emits TaskCompleted when all subtasks are completed', () => {
      const { task, bus } = makeRunningTask()
      const handler = vi.fn()
      bus.on<TaskCompleted>('task.completed', handler)
      task.completeSubtask(createSubtaskSequence(1))
      task.completeSubtask(createSubtaskSequence(2))
      task.complete()
      expect(task.status).toBe(TaskStatus.completed)
      expect(handler).toHaveBeenCalledOnce()
    })

    it('throws if any required subtask is not completed', () => {
      const { task } = makeRunningTask()
      task.completeSubtask(createSubtaskSequence(1))
      expect(() => task.complete()).toThrow()
    })

    it('throws when called on an already-completed task', () => {
      const { task } = makeRunningTask()
      task.completeSubtask(createSubtaskSequence(1))
      task.completeSubtask(createSubtaskSequence(2))
      task.complete()
      expect(() => task.complete()).toThrow()
    })
  })

  describe('fail()', () => {
    it('transitions to failed and emits TaskFailed with the reason', () => {
      const { task, bus } = makeRunningTask()
      const handler = vi.fn()
      bus.on<TaskFailed>('task.failed', handler)
      task.fail('something went wrong')
      expect(task.status).toBe(TaskStatus.failed)
      expect(handler).toHaveBeenCalledOnce()
      const event = handler.mock.calls[0][0] as TaskFailed
      expect(event.reason).toBe('something went wrong')
    })

    it('throws when called on a completed task', () => {
      const { task } = makeRunningTask()
      task.completeSubtask(createSubtaskSequence(1))
      task.completeSubtask(createSubtaskSequence(2))
      task.complete()
      expect(() => task.fail('nope')).toThrow()
    })
  })

  describe('block()', () => {
    it('transitions to blocked and emits TaskBlocked with the reason', () => {
      const { task, bus } = makeRunningTask()
      const handler = vi.fn()
      bus.on<TaskBlocked>('task.blocked', handler)
      task.block('waiting on gate')
      expect(task.status).toBe(TaskStatus.blocked)
      expect(handler).toHaveBeenCalledOnce()
      const event = handler.mock.calls[0][0] as TaskBlocked
      expect(event.reason).toBe('waiting on gate')
    })
  })
})
