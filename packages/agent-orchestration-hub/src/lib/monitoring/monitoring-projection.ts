import type { EventBus } from '../events/event-bus.js'
import type { SubagentId } from '../execution/subagent-id.js'
import type { SubagentAssigned } from '../execution/execution-events.js'
import type { ExecutionPlan } from '../task/execution-plan.js'
import type { Progress } from '../task/progress.js'
import type { TaskId } from '../task/task-id.js'
import {
  TaskStatus,
} from '../task/task-status.js'
import type {
  SubtaskCompleted,
  SubtaskFailed,
  TaskBlocked,
  TaskCompleted,
  TaskCreated,
  TaskDispatched,
  TaskFailed,
  TaskRunning,
} from '../task/task-events.js'
import { createSubtaskSequence } from '../task/subtask-sequence.js'
import type { SubtaskSequence } from '../task/subtask-sequence.js'
import type { ServiceId } from '../registry/service-id.js'
import type { TaskFilter } from './event-filter.js'
import type { TaskSnapshot } from './task-snapshot.js'

interface MutableSubtaskSnapshot {
  sequence: SubtaskSequence
  description: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  result: string | undefined
}

interface MutableTaskSnapshot {
  taskId: TaskId
  status: TaskStatus
  plan: ExecutionPlan
  subtasks: MutableSubtaskSnapshot[]
  progress: Progress
  assignedSubagentId: SubagentId | undefined
  createdAt: Date
  updatedAt: Date
}

function computeProgressFromSnapshots(subtasks: MutableSubtaskSnapshot[]): Progress {
  return {
    total: subtasks.length,
    completed: subtasks.filter(s => s.status === 'completed' || s.status === 'skipped').length,
  }
}

export class MonitoringProjection {
  private readonly snapshots = new Map<TaskId, MutableTaskSnapshot>()
  private readonly _serviceTaskIndex = new Map<ServiceId, Set<TaskId>>()

  constructor(bus: EventBus) {
    this.handleTaskCreated = this.handleTaskCreated.bind(this)
    this.handleTaskDispatched = this.handleTaskDispatched.bind(this)
    this.handleTaskRunning = this.handleTaskRunning.bind(this)
    this.handleTaskCompleted = this.handleTaskCompleted.bind(this)
    this.handleTaskFailed = this.handleTaskFailed.bind(this)
    this.handleTaskBlocked = this.handleTaskBlocked.bind(this)
    this.handleSubtaskCompleted = this.handleSubtaskCompleted.bind(this)
    this.handleSubtaskFailed = this.handleSubtaskFailed.bind(this)
    this.handleSubagentAssigned = this.handleSubagentAssigned.bind(this)

    bus.on<TaskCreated>('task.created', this.handleTaskCreated)
    bus.on<TaskDispatched>('task.dispatched', this.handleTaskDispatched)
    bus.on<TaskRunning>('task.running', this.handleTaskRunning)
    bus.on<TaskCompleted>('task.completed', this.handleTaskCompleted)
    bus.on<TaskFailed>('task.failed', this.handleTaskFailed)
    bus.on<TaskBlocked>('task.blocked', this.handleTaskBlocked)
    bus.on<SubtaskCompleted>('subtask.completed', this.handleSubtaskCompleted)
    bus.on<SubtaskFailed>('subtask.failed', this.handleSubtaskFailed)
    bus.on<SubagentAssigned>('subagent.assigned', this.handleSubagentAssigned)
  }

  getTaskStatus(taskId: TaskId): TaskSnapshot | undefined {
    const snapshot = this.snapshots.get(taskId)
    return snapshot as TaskSnapshot | undefined
  }

  listTasks(filter?: TaskFilter): readonly TaskSnapshot[] {
    let all = Array.from(this.snapshots.values()) as TaskSnapshot[]
    if (filter?.serviceId !== undefined) {
      const ids = this._serviceTaskIndex.get(filter.serviceId) ?? new Set<TaskId>()
      all = all.filter(s => ids.has(s.taskId))
    }
    if (filter?.status !== undefined) {
      all = all.filter(s => s.status === filter.status)
    }
    return all
  }

  private handleTaskCreated(event: TaskCreated): void {
    const subtasks: MutableSubtaskSnapshot[] = event.plan.subtasks.map(spec => ({
      sequence: createSubtaskSequence(spec.sequence),
      description: spec.description,
      status: 'pending',
      result: undefined,
    }))
    const snapshot: MutableTaskSnapshot = {
      taskId: event.taskId,
      status: TaskStatus.pending,
      plan: event.plan,
      subtasks,
      progress: computeProgressFromSnapshots(subtasks),
      assignedSubagentId: undefined,
      createdAt: event.occurredAt,
      updatedAt: event.occurredAt,
    }
    this.snapshots.set(event.taskId, snapshot)
  }

  private handleTaskDispatched(event: TaskDispatched): void {
    const snapshot = this.snapshots.get(event.taskId)
    if (snapshot) {
      snapshot.status = TaskStatus.dispatched
      snapshot.updatedAt = event.occurredAt
    }
    const set = this._serviceTaskIndex.get(event.targetServiceId) ?? new Set<TaskId>()
    set.add(event.taskId)
    this._serviceTaskIndex.set(event.targetServiceId, set)
  }

  private handleTaskRunning(event: TaskRunning): void {
    const snapshot = this.snapshots.get(event.taskId)
    if (snapshot) {
      snapshot.status = TaskStatus.running
      snapshot.updatedAt = event.occurredAt
    }
  }

  private handleTaskCompleted(event: TaskCompleted): void {
    const snapshot = this.snapshots.get(event.taskId)
    if (snapshot) {
      snapshot.status = TaskStatus.completed
      snapshot.updatedAt = event.occurredAt
    }
  }

  private handleTaskFailed(event: TaskFailed): void {
    const snapshot = this.snapshots.get(event.taskId)
    if (snapshot) {
      snapshot.status = TaskStatus.failed
      snapshot.updatedAt = event.occurredAt
    }
  }

  private handleTaskBlocked(event: TaskBlocked): void {
    const snapshot = this.snapshots.get(event.taskId)
    if (snapshot) {
      snapshot.status = TaskStatus.blocked
      snapshot.updatedAt = event.occurredAt
    }
  }

  private handleSubtaskCompleted(event: SubtaskCompleted): void {
    const snapshot = this.snapshots.get(event.taskId)
    if (snapshot) {
      const subtask = snapshot.subtasks.find(s => s.sequence === event.sequence)
      if (subtask) {
        subtask.status = 'completed'
        subtask.result = event.result
      }
      snapshot.progress = computeProgressFromSnapshots(snapshot.subtasks)
      snapshot.updatedAt = event.occurredAt
    }
  }

  private handleSubtaskFailed(event: SubtaskFailed): void {
    const snapshot = this.snapshots.get(event.taskId)
    if (snapshot) {
      const subtask = snapshot.subtasks.find(s => s.sequence === event.sequence)
      if (subtask) {
        subtask.status = 'failed'
      }
      snapshot.progress = computeProgressFromSnapshots(snapshot.subtasks)
      snapshot.updatedAt = event.occurredAt
    }
  }

  private handleSubagentAssigned(event: SubagentAssigned): void {
    const snapshot = this.snapshots.get(event.taskId)
    if (snapshot) {
      snapshot.assignedSubagentId = event.subagentId
      snapshot.updatedAt = event.occurredAt
    }
  }
}
