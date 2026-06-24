import { describe, it, expect } from 'vitest'
import { InMemoryEventBus } from '../../../src/lib/events/in-memory-event-bus.js'
import { MonitoringProjection } from '../../../src/lib/monitoring/monitoring-projection.js'
import { TaskStatus } from '../../../src/lib/task/task-status.js'
import { createTaskId } from '../../../src/lib/task/task-id.js'
import { createSubtaskSequence } from '../../../src/lib/task/subtask-sequence.js'
import { createSubagentId } from '../../../src/lib/execution/subagent-id.js'
import { createServiceId } from '../../../src/lib/registry/service-id.js'
import type { TaskCreated, TaskDispatched, TaskRunning, TaskCompleted, TaskFailed, TaskBlocked, SubtaskCompleted, SubtaskFailed } from '../../../src/lib/task/task-events.js'
import type { SubagentAssigned } from '../../../src/lib/execution/execution-events.js'
import type { ExecutionPlan } from '../../../src/lib/task/execution-plan.js'

function makePlan(count = 2): ExecutionPlan {
  return {
    subtasks: Array.from({ length: count }, (_, i) => ({
      sequence: i + 1,
      description: `subtask ${i + 1}`,
    })),
    preConditionGateIds: [],
    postConditionGateIds: [],
  }
}

function makeTaskCreatedEvent(taskId = createTaskId(), plan = makePlan()): TaskCreated {
  return {
    type: 'task.created',
    occurredAt: new Date(),
    taskId,
    plan,
  }
}

describe('MonitoringProjection', () => {
  describe('getTaskStatus()', () => {
    it('returns undefined for an unknown taskId', () => {
      const bus = new InMemoryEventBus()
      const projection = new MonitoringProjection(bus)
      const unknownId = createTaskId()
      expect(projection.getTaskStatus(unknownId)).toBeUndefined()
    })

    it('returns a snapshot with status pending after TaskCreated', () => {
      const bus = new InMemoryEventBus()
      const projection = new MonitoringProjection(bus)
      const event = makeTaskCreatedEvent()
      bus.emit(event)
      const snapshot = projection.getTaskStatus(event.taskId)
      expect(snapshot).toBeDefined()
      expect(snapshot?.status).toBe(TaskStatus.pending)
    })

    it('updates snapshot status to dispatched after TaskDispatched', () => {
      const bus = new InMemoryEventBus()
      const projection = new MonitoringProjection(bus)
      const created = makeTaskCreatedEvent()
      bus.emit(created)
      const dispatched: TaskDispatched = {
        type: 'task.dispatched',
        occurredAt: new Date(),
        taskId: created.taskId,
        targetServiceId: createServiceId(),
      }
      bus.emit(dispatched)
      expect(projection.getTaskStatus(created.taskId)?.status).toBe(TaskStatus.dispatched)
    })

    it('updates snapshot status to running after TaskRunning', () => {
      const bus = new InMemoryEventBus()
      const projection = new MonitoringProjection(bus)
      const created = makeTaskCreatedEvent()
      bus.emit(created)
      const running: TaskRunning = {
        type: 'task.running',
        occurredAt: new Date(),
        taskId: created.taskId,
      }
      bus.emit(running)
      expect(projection.getTaskStatus(created.taskId)?.status).toBe(TaskStatus.running)
    })

    it('updates snapshot status to completed after TaskCompleted', () => {
      const bus = new InMemoryEventBus()
      const projection = new MonitoringProjection(bus)
      const created = makeTaskCreatedEvent()
      bus.emit(created)
      const completed: TaskCompleted = {
        type: 'task.completed',
        occurredAt: new Date(),
        taskId: created.taskId,
      }
      bus.emit(completed)
      expect(projection.getTaskStatus(created.taskId)?.status).toBe(TaskStatus.completed)
    })

    it('updates snapshot status to failed after TaskFailed', () => {
      const bus = new InMemoryEventBus()
      const projection = new MonitoringProjection(bus)
      const created = makeTaskCreatedEvent()
      bus.emit(created)
      const failed: TaskFailed = {
        type: 'task.failed',
        occurredAt: new Date(),
        taskId: created.taskId,
        reason: 'something went wrong',
      }
      bus.emit(failed)
      expect(projection.getTaskStatus(created.taskId)?.status).toBe(TaskStatus.failed)
    })

    it('updates snapshot status to blocked after TaskBlocked', () => {
      const bus = new InMemoryEventBus()
      const projection = new MonitoringProjection(bus)
      const created = makeTaskCreatedEvent()
      bus.emit(created)
      const blocked: TaskBlocked = {
        type: 'task.blocked',
        occurredAt: new Date(),
        taskId: created.taskId,
        reason: 'waiting for gate',
      }
      bus.emit(blocked)
      expect(projection.getTaskStatus(created.taskId)?.status).toBe(TaskStatus.blocked)
    })

    it('updates subtask status in the snapshot after SubtaskCompleted', () => {
      const bus = new InMemoryEventBus()
      const projection = new MonitoringProjection(bus)
      const created = makeTaskCreatedEvent()
      bus.emit(created)
      const subtaskCompleted: SubtaskCompleted = {
        type: 'subtask.completed',
        occurredAt: new Date(),
        taskId: created.taskId,
        sequence: createSubtaskSequence(1),
        result: 'done',
      }
      bus.emit(subtaskCompleted)
      const snapshot = projection.getTaskStatus(created.taskId)
      const subtask = snapshot?.subtasks.find(s => s.sequence === 1)
      expect(subtask?.status).toBe('completed')
      expect(subtask?.result).toBe('done')
    })

    it('updates subtask status in the snapshot after SubtaskFailed', () => {
      const bus = new InMemoryEventBus()
      const projection = new MonitoringProjection(bus)
      const created = makeTaskCreatedEvent()
      bus.emit(created)
      const subtaskFailed: SubtaskFailed = {
        type: 'subtask.failed',
        occurredAt: new Date(),
        taskId: created.taskId,
        sequence: createSubtaskSequence(2),
        reason: 'network error',
      }
      bus.emit(subtaskFailed)
      const snapshot = projection.getTaskStatus(created.taskId)
      const subtask = snapshot?.subtasks.find(s => s.sequence === 2)
      expect(subtask?.status).toBe('failed')
    })

    it('sets assignedSubagentId after SubagentAssigned', () => {
      const bus = new InMemoryEventBus()
      const projection = new MonitoringProjection(bus)
      const created = makeTaskCreatedEvent()
      bus.emit(created)
      const subagentId = createSubagentId()
      const assigned: SubagentAssigned = {
        type: 'subagent.assigned',
        occurredAt: new Date(),
        subagentId,
        taskId: created.taskId,
        assignedAt: new Date(),
      }
      bus.emit(assigned)
      expect(projection.getTaskStatus(created.taskId)?.assignedSubagentId).toBe(subagentId)
    })

    it('recomputes progress when subtasks are completed', () => {
      const bus = new InMemoryEventBus()
      const projection = new MonitoringProjection(bus)
      const plan = makePlan(3)
      const created = makeTaskCreatedEvent(createTaskId(), plan)
      bus.emit(created)

      const snapshotBefore = projection.getTaskStatus(created.taskId)
      expect(snapshotBefore?.progress).toEqual({ total: 3, completed: 0 })

      const sc1: SubtaskCompleted = {
        type: 'subtask.completed',
        occurredAt: new Date(),
        taskId: created.taskId,
        sequence: createSubtaskSequence(1),
        result: undefined,
      }
      bus.emit(sc1)

      const sc2: SubtaskCompleted = {
        type: 'subtask.completed',
        occurredAt: new Date(),
        taskId: created.taskId,
        sequence: createSubtaskSequence(2),
        result: 'ok',
      }
      bus.emit(sc2)

      const snapshotAfter = projection.getTaskStatus(created.taskId)
      expect(snapshotAfter?.progress).toEqual({ total: 3, completed: 2 })
    })
  })

  describe('listTasks()', () => {
    it('returns all snapshots when no filter is provided', () => {
      const bus = new InMemoryEventBus()
      const projection = new MonitoringProjection(bus)
      bus.emit(makeTaskCreatedEvent())
      bus.emit(makeTaskCreatedEvent())
      bus.emit(makeTaskCreatedEvent())
      expect(projection.listTasks()).toHaveLength(3)
    })

    it('filters by status when TaskFilter.status is set', () => {
      const bus = new InMemoryEventBus()
      const projection = new MonitoringProjection(bus)

      const task1 = makeTaskCreatedEvent()
      const task2 = makeTaskCreatedEvent()
      const task3 = makeTaskCreatedEvent()
      bus.emit(task1)
      bus.emit(task2)
      bus.emit(task3)

      // Transition task1 to running
      const running1: TaskRunning = {
        type: 'task.running',
        occurredAt: new Date(),
        taskId: task1.taskId,
      }
      bus.emit(running1)

      // Transition task2 to running
      const running2: TaskRunning = {
        type: 'task.running',
        occurredAt: new Date(),
        taskId: task2.taskId,
      }
      bus.emit(running2)

      const pendingTasks = projection.listTasks({ status: TaskStatus.pending })
      expect(pendingTasks).toHaveLength(1)
      expect(pendingTasks[0].taskId).toBe(task3.taskId)

      const runningTasks = projection.listTasks({ status: TaskStatus.running })
      expect(runningTasks).toHaveLength(2)
    })

    it('returns an empty array when no tasks match the filter', () => {
      const bus = new InMemoryEventBus()
      const projection = new MonitoringProjection(bus)
      bus.emit(makeTaskCreatedEvent())
      bus.emit(makeTaskCreatedEvent())

      const completedTasks = projection.listTasks({ status: TaskStatus.completed })
      expect(completedTasks).toHaveLength(0)
    })

    it('returns only tasks dispatched to the given serviceId', () => {
      const bus = new InMemoryEventBus()
      const projection = new MonitoringProjection(bus)

      const task1 = makeTaskCreatedEvent()
      const task2 = makeTaskCreatedEvent()
      const task3 = makeTaskCreatedEvent()
      bus.emit(task1)
      bus.emit(task2)
      bus.emit(task3)

      const serviceA = createServiceId()
      const serviceB = createServiceId()

      const dispatched1: TaskDispatched = {
        type: 'task.dispatched',
        occurredAt: new Date(),
        taskId: task1.taskId,
        targetServiceId: serviceA,
      }
      const dispatched2: TaskDispatched = {
        type: 'task.dispatched',
        occurredAt: new Date(),
        taskId: task2.taskId,
        targetServiceId: serviceA,
      }
      const dispatched3: TaskDispatched = {
        type: 'task.dispatched',
        occurredAt: new Date(),
        taskId: task3.taskId,
        targetServiceId: serviceB,
      }
      bus.emit(dispatched1)
      bus.emit(dispatched2)
      bus.emit(dispatched3)

      const tasksForServiceA = projection.listTasks({ serviceId: serviceA })
      expect(tasksForServiceA).toHaveLength(2)
      expect(tasksForServiceA.map(t => t.taskId)).toContain(task1.taskId)
      expect(tasksForServiceA.map(t => t.taskId)).toContain(task2.taskId)
    })

    it('returns an empty array for an unknown serviceId', () => {
      const bus = new InMemoryEventBus()
      const projection = new MonitoringProjection(bus)
      bus.emit(makeTaskCreatedEvent())

      const unknownService = createServiceId()
      const tasks = projection.listTasks({ serviceId: unknownService })
      expect(tasks).toHaveLength(0)
    })

    it('applies both serviceId and status filters with AND semantics', () => {
      const bus = new InMemoryEventBus()
      const projection = new MonitoringProjection(bus)

      const task1 = makeTaskCreatedEvent()
      const task2 = makeTaskCreatedEvent()
      bus.emit(task1)
      bus.emit(task2)

      const serviceA = createServiceId()

      const dispatched1: TaskDispatched = {
        type: 'task.dispatched',
        occurredAt: new Date(),
        taskId: task1.taskId,
        targetServiceId: serviceA,
      }
      const dispatched2: TaskDispatched = {
        type: 'task.dispatched',
        occurredAt: new Date(),
        taskId: task2.taskId,
        targetServiceId: serviceA,
      }
      bus.emit(dispatched1)
      bus.emit(dispatched2)

      // Complete task1 only
      const completed1: TaskCompleted = {
        type: 'task.completed',
        occurredAt: new Date(),
        taskId: task1.taskId,
      }
      bus.emit(completed1)

      // Filtering by serviceA AND completed should return only task1
      const tasks = projection.listTasks({ serviceId: serviceA, status: TaskStatus.completed })
      expect(tasks).toHaveLength(1)
      expect(tasks[0].taskId).toBe(task1.taskId)
    })

    it('returns all tasks when no filter is provided (regression)', () => {
      const bus = new InMemoryEventBus()
      const projection = new MonitoringProjection(bus)
      bus.emit(makeTaskCreatedEvent())
      bus.emit(makeTaskCreatedEvent())
      bus.emit(makeTaskCreatedEvent())
      expect(projection.listTasks()).toHaveLength(3)
    })
  })
})
