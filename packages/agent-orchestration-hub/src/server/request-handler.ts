import { createServiceId } from '../lib/registry/service-id.js'
import type { ServiceId } from '../lib/registry/service-id.js'
import { ServiceType } from '../lib/registry/service-type.js'
import type { GateId } from '../lib/gating/gate-id.js'
import type { TaskId } from '../lib/task/task-id.js'
import { TaskStatus } from '../lib/task/task-status.js'
import { createSubtaskSequence } from '../lib/task/subtask-sequence.js'
import type { Request, Response } from './protocol.js'
import type { Hub } from './hub.js'

export class RequestHandler {
  constructor(private readonly hub: Hub) {}

  handle(request: Request): Response {
    try {
      switch (request.method) {
        case 'register_service': {
          const serviceTypeValue = Object.values(ServiceType).find(
            (v) => v === request.params.serviceType,
          )
          if (!serviceTypeValue) {
            return {
              id: request.id,
              error: {
                code: -32602,
                message: `Invalid serviceType: ${request.params.serviceType}`,
              },
            }
          }
          const serviceId = createServiceId()
          this.hub.registry.register(serviceId, serviceTypeValue)
          return { id: request.id, result: { serviceId } }
        }

        case 'deregister_service': {
          this.hub.registry.deregister(request.params.serviceId as ServiceId)
          return { id: request.id, result: { ok: true } }
        }

        case 'heartbeat': {
          this.hub.registry.heartbeat(request.params.serviceId as ServiceId)
          return { id: request.id, result: { ok: true } }
        }

        case 'add_routing_rule': {
          const pattern = new RegExp(request.params.pattern)
          const targetAgentId = request.params.targetAgentId as ServiceId
          this.hub.router.addRule({ pattern, targetAgentId })
          return { id: request.id, result: { ok: true } }
        }

        case 'dispatch_prompt': {
          const prompt = {
            text: request.params.text,
            metadata: request.params.metadata ?? {},
          }
          const taskId = this.hub.router.dispatch(prompt)
          if (taskId === undefined) {
            return { id: request.id, result: null }
          }
          return { id: request.id, result: { taskId } }
        }

        case 'get_task_status': {
          const snapshot = this.hub.monitoring.getTaskStatus(
            request.params.taskId as TaskId,
          )
          if (!snapshot) {
            return {
              id: request.id,
              error: { code: -32602, message: `Task not found: ${request.params.taskId}` },
            }
          }
          return { id: request.id, result: snapshot }
        }

        case 'list_tasks': {
          const hasStatus = request.params.status !== undefined
          const hasServiceId = request.params.serviceId !== undefined
          if (hasStatus || hasServiceId) {
            const filter: { status?: TaskStatus; serviceId?: ServiceId } = {}
            if (hasStatus) filter.status = request.params.status as TaskStatus
            if (hasServiceId) filter.serviceId = request.params.serviceId as ServiceId
            const tasks = this.hub.monitoring.listTasks(filter)
            return { id: request.id, result: tasks }
          }
          const tasks = this.hub.monitoring.listTasks()
          return { id: request.id, result: tasks }
        }

        case 'report_subtask_completed': {
          const task = this.hub.taskRepo.getById(request.params.taskId as TaskId)
          if (!task) {
            return {
              id: request.id,
              error: {
                code: -32602,
                message: `Task not found: ${request.params.taskId}`,
              },
            }
          }
          const sequence = createSubtaskSequence(request.params.sequence)
          task.completeSubtask(sequence, request.params.result)
          const allDone = task.subtasks.every(
            (s) => s.status === 'completed' || s.status === 'skipped',
          )
          if (allDone) task.complete()
          return { id: request.id, result: { ok: true } }
        }

        case 'report_subtask_failed': {
          const task = this.hub.taskRepo.getById(request.params.taskId as TaskId)
          if (!task) {
            return {
              id: request.id,
              error: {
                code: -32602,
                message: `Task not found: ${request.params.taskId}`,
              },
            }
          }
          const sequence = createSubtaskSequence(request.params.sequence)
          task.failSubtask(sequence, request.params.reason)
          return { id: request.id, result: { ok: true } }
        }

        case 'open_gate': {
          const gate = this.hub.gateRepo.getById(request.params.gateId as GateId)
          if (!gate) {
            return {
              id: request.id,
              error: {
                code: -32602,
                message: `Gate not found: ${request.params.gateId}`,
              },
            }
          }
          gate.forceOpen()
          return { id: request.id, result: { ok: true } }
        }

        default: {
          // exhaustive check — TypeScript narrows `request` to `never` here
          const _exhaustive: never = request
          void _exhaustive
          return {
            id: (request as Request).id,
            error: { code: -32601, message: 'Method not found' },
          }
        }
      }
    } catch (err) {
      return {
        id: request.id,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : String(err),
        },
      }
    }
  }
}
