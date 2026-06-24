import { describe, it, expect, afterEach } from 'vitest'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const SERVER_PATH = resolve(__dirname, '../../dist/src/main.js')

type Request = { id: string; method: string; params: Record<string, unknown> }
type Response = { id: string; result?: unknown; error?: { code: number; message: string } }

function spawnServer(): ChildProcessWithoutNullStreams {
  return spawn('node', [SERVER_PATH], { stdio: ['pipe', 'pipe', 'pipe'] })
}

async function sendRequest(child: ChildProcessWithoutNullStreams, req: Request): Promise<Response> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: child.stdout })
    const timer = setTimeout(() => {
      rl.close()
      reject(new Error(`Timeout waiting for response to ${req.method}`))
    }, 2000)
    rl.once('line', (line) => {
      clearTimeout(timer)
      rl.close()
      resolve(JSON.parse(line) as Response)
    })
    child.stdin.write(JSON.stringify(req) + '\n')
  })
}

async function closeServer(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (!child.killed) {
    child.stdin.end()
    child.kill()
    await new Promise<void>((resolve) => child.on('close', () => resolve()))
  }
}

let child: ChildProcessWithoutNullStreams

afterEach(async () => {
  if (child) {
    await closeServer(child)
  }
})

describe('Server E2E', () => {
  it('responds to list_tasks with an empty array on startup', async () => {
    child = spawnServer()
    const response = await sendRequest(child, { id: '1', method: 'list_tasks', params: {} })
    expect(response.id).toBe('1')
    expect(response.result).toEqual([])
  }, 10_000)

  it('register → add_routing_rule → dispatch_prompt → get_task_status returns dispatched', async () => {
    child = spawnServer()

    // 1. register_service
    const regResponse = await sendRequest(child, {
      id: '1',
      method: 'register_service',
      params: { serviceType: 'agent' },
    })
    expect(regResponse.error).toBeUndefined()
    const serviceId = (regResponse.result as { serviceId: string }).serviceId
    expect(typeof serviceId).toBe('string')

    // 2. add_routing_rule
    const routeResponse = await sendRequest(child, {
      id: '2',
      method: 'add_routing_rule',
      params: { pattern: '^test:', targetAgentId: serviceId },
    })
    expect(routeResponse.error).toBeUndefined()
    expect((routeResponse.result as { ok: boolean }).ok).toBe(true)

    // 3. dispatch_prompt
    const dispatchResponse = await sendRequest(child, {
      id: '3',
      method: 'dispatch_prompt',
      params: { text: 'test: hello world' },
    })
    expect(dispatchResponse.error).toBeUndefined()
    const taskId = (dispatchResponse.result as { taskId: string }).taskId
    expect(typeof taskId).toBe('string')

    // 4. get_task_status
    const statusResponse = await sendRequest(child, {
      id: '4',
      method: 'get_task_status',
      params: { taskId },
    })
    expect(statusResponse.error).toBeUndefined()
    const snapshot = statusResponse.result as { status: string }
    expect(snapshot.status).toBe('dispatched')
  }, 10_000)

  it('report_subtask_completed auto-completes single-subtask task', async () => {
    child = spawnServer()

    // register + route + dispatch
    const regResponse = await sendRequest(child, {
      id: '1',
      method: 'register_service',
      params: { serviceType: 'agent' },
    })
    const serviceId = (regResponse.result as { serviceId: string }).serviceId

    await sendRequest(child, {
      id: '2',
      method: 'add_routing_rule',
      params: { pattern: '^complete:', targetAgentId: serviceId },
    })

    const dispatchResponse = await sendRequest(child, {
      id: '3',
      method: 'dispatch_prompt',
      params: { text: 'complete: do something' },
    })
    const taskId = (dispatchResponse.result as { taskId: string }).taskId

    // report subtask 1 completed
    const completeResponse = await sendRequest(child, {
      id: '4',
      method: 'report_subtask_completed',
      params: { taskId, sequence: 1 },
    })
    expect(completeResponse.error).toBeUndefined()
    expect((completeResponse.result as { ok: boolean }).ok).toBe(true)

    // task should now be completed
    const statusResponse = await sendRequest(child, {
      id: '5',
      method: 'get_task_status',
      params: { taskId },
    })
    expect(statusResponse.error).toBeUndefined()
    const snapshot = statusResponse.result as { status: string }
    expect(snapshot.status).toBe('completed')
  }, 10_000)

  it('invalid JSON line returns parse error response', async () => {
    child = spawnServer()

    const response = await new Promise<Response>((resolve, reject) => {
      const rl = createInterface({ input: child.stdout })
      const timer = setTimeout(() => {
        rl.close()
        reject(new Error('Timeout waiting for parse error response'))
      }, 2000)
      rl.once('line', (line) => {
        clearTimeout(timer)
        rl.close()
        resolve(JSON.parse(line) as Response)
      })
      child.stdin.write('not valid json\n')
    })

    expect(response.error).toBeDefined()
    expect(response.error?.code).toBe(-32700)
  }, 10_000)

  it('unknown method returns -32601 method-not-found error', async () => {
    child = spawnServer()
    const response = await sendRequest(child, {
      id: '1',
      method: 'bogus_method',
      params: {},
    })
    expect(response.error).toBeDefined()
    expect(response.error?.code).toBe(-32601)
  }, 10_000)
})
