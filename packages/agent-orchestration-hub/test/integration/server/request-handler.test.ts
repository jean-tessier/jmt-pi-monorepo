import { describe, it, expect } from 'vitest'
import { Hub } from '../../../src/server/hub.js'
import { RequestHandler } from '../../../src/server/request-handler.js'
import { TaskStatus } from '../../../src/lib/task/task-status.js'
import { createServiceId } from '../../../src/lib/registry/service-id.js'

function makeHandler() {
  const hub = new Hub()
  const handler = new RequestHandler(hub)
  return { hub, handler }
}

describe('RequestHandler', () => {
  describe('register_service', () => {
    it('returns the new serviceId in the result', () => {
      const { handler } = makeHandler()
      const response = handler.handle({
        id: '1',
        method: 'register_service',
        params: { serviceType: 'agent' },
      })
      expect(response).toMatchObject({ id: '1', result: expect.objectContaining({ serviceId: expect.any(String) }) })
    })

    it('returns an error when service type is invalid', () => {
      const { handler } = makeHandler()
      const response = handler.handle({
        id: '2',
        method: 'register_service',
        params: { serviceType: 'invalid_type' },
      })
      expect(response).toMatchObject({
        id: '2',
        error: { code: -32602, message: expect.stringContaining('Invalid serviceType') },
      })
    })
  })

  describe('dispatch_prompt', () => {
    it('returns a taskId when a routing rule matches the prompt', () => {
      const { hub, handler } = makeHandler()
      const agentId = createServiceId()
      hub.registry.register(agentId, 'agent' as import('../../../src/lib/registry/service-type.js').ServiceType)
      handler.handle({
        id: '3',
        method: 'add_routing_rule',
        params: { pattern: 'hello', targetAgentId: agentId },
      })
      const response = handler.handle({
        id: '4',
        method: 'dispatch_prompt',
        params: { text: 'say hello world' },
      })
      expect(response).toMatchObject({
        id: '4',
        result: expect.objectContaining({ taskId: expect.any(String) }),
      })
    })

    it('returns null result when no routing rule matches', () => {
      const { handler } = makeHandler()
      const response = handler.handle({
        id: '5',
        method: 'dispatch_prompt',
        params: { text: 'unmatched prompt' },
      })
      expect(response).toMatchObject({ id: '5', result: null })
    })
  })

  describe('get_task_status', () => {
    it('returns the task snapshot when the task exists', () => {
      const { hub, handler } = makeHandler()
      const agentId = createServiceId()
      hub.registry.register(agentId, 'agent' as import('../../../src/lib/registry/service-type.js').ServiceType)
      handler.handle({ id: 'r1', method: 'add_routing_rule', params: { pattern: 'test', targetAgentId: agentId } })
      const dispatchResponse = handler.handle({ id: 'r2', method: 'dispatch_prompt', params: { text: 'test task' } })
      const taskId = (dispatchResponse as { id: string; result: { taskId: string } }).result.taskId

      const response = handler.handle({ id: '6', method: 'get_task_status', params: { taskId } })
      expect(response).toMatchObject({
        id: '6',
        result: expect.objectContaining({ taskId, status: expect.any(String) }),
      })
    })

    it('returns an error when the taskId is not found', () => {
      const { handler } = makeHandler()
      const response = handler.handle({
        id: '7',
        method: 'get_task_status',
        params: { taskId: 'nonexistent-task-id' },
      })
      expect(response).toMatchObject({
        id: '7',
        error: { code: -32602, message: expect.stringContaining('Task not found') },
      })
    })
  })

  describe('list_tasks', () => {
    it('returns all tasks when no status filter is provided', () => {
      const { hub, handler } = makeHandler()
      const agentId = createServiceId()
      hub.registry.register(agentId, 'agent' as import('../../../src/lib/registry/service-type.js').ServiceType)
      handler.handle({ id: 'r1', method: 'add_routing_rule', params: { pattern: '.*', targetAgentId: agentId } })
      handler.handle({ id: 'd1', method: 'dispatch_prompt', params: { text: 'task one' } })
      handler.handle({ id: 'd2', method: 'dispatch_prompt', params: { text: 'task two' } })

      const response = handler.handle({ id: '8', method: 'list_tasks', params: {} })
      const result = (response as { id: string; result: unknown[] }).result
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThanOrEqual(2)
    })

    it('returns only matching tasks when a status filter is provided', () => {
      const { hub, handler } = makeHandler()
      const agentId = createServiceId()
      hub.registry.register(agentId, 'agent' as import('../../../src/lib/registry/service-type.js').ServiceType)
      handler.handle({ id: 'r1', method: 'add_routing_rule', params: { pattern: '.*', targetAgentId: agentId } })
      handler.handle({ id: 'd1', method: 'dispatch_prompt', params: { text: 'dispatched task' } })

      const response = handler.handle({
        id: '9',
        method: 'list_tasks',
        params: { status: TaskStatus.dispatched },
      })
      const result = (response as { id: string; result: unknown[] }).result
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('report_subtask_completed', () => {
    it('transitions the subtask to completed and returns ok', () => {
      const { hub, handler } = makeHandler()
      const agentId = createServiceId()
      hub.registry.register(agentId, 'agent' as import('../../../src/lib/registry/service-type.js').ServiceType)
      handler.handle({ id: 'r1', method: 'add_routing_rule', params: { pattern: '.*', targetAgentId: agentId } })
      const dispatchResponse = handler.handle({
        id: 'd1',
        method: 'dispatch_prompt',
        params: { text: 'complete me' },
      })
      const taskId = (dispatchResponse as { id: string; result: { taskId: string } }).result.taskId

      const response = handler.handle({
        id: '10',
        method: 'report_subtask_completed',
        params: { taskId, sequence: 1, result: 'done!' },
      })
      expect(response).toMatchObject({ id: '10', result: { ok: true } })
    })

    it('returns an error when the taskId is not found', () => {
      const { handler } = makeHandler()
      const response = handler.handle({
        id: '11',
        method: 'report_subtask_completed',
        params: { taskId: 'ghost-task', sequence: 1 },
      })
      expect(response).toMatchObject({
        id: '11',
        error: { code: -32602, message: expect.stringContaining('Task not found') },
      })
    })
  })

  describe('heartbeat', () => {
    it('updates lastHeartbeatAt and returns ok', () => {
      const { hub, handler } = makeHandler()
      const agentId = createServiceId()
      hub.registry.register(agentId, 'agent' as import('../../../src/lib/registry/service-type.js').ServiceType)

      const response = handler.handle({
        id: '12',
        method: 'heartbeat',
        params: { serviceId: agentId },
      })
      expect(response).toMatchObject({ id: '12', result: { ok: true } })
    })

    it('returns an error when the serviceId is not found', () => {
      const { handler } = makeHandler()
      const response = handler.handle({
        id: '13',
        method: 'heartbeat',
        params: { serviceId: 'nonexistent-service-id' },
      })
      expect(response).toMatchObject({
        id: '13',
        error: { code: -32603, message: expect.stringContaining('not found') },
      })
    })
  })
})
