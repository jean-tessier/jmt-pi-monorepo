export type Request =
  | { id: string; method: 'register_service'; params: { serviceType: string } }
  | { id: string; method: 'deregister_service'; params: { serviceId: string } }
  | { id: string; method: 'heartbeat'; params: { serviceId: string } }
  | { id: string; method: 'add_routing_rule'; params: { pattern: string; targetAgentId: string } }
  | { id: string; method: 'dispatch_prompt'; params: { text: string; metadata?: Record<string, unknown> } }
  | { id: string; method: 'get_task_status'; params: { taskId: string } }
  | { id: string; method: 'list_tasks'; params: { status?: string } }
  | { id: string; method: 'report_subtask_completed'; params: { taskId: string; sequence: number; result?: string } }
  | { id: string; method: 'report_subtask_failed'; params: { taskId: string; sequence: number; reason: string } }
  | { id: string; method: 'open_gate'; params: { gateId: string } }

export type Response =
  | { id: string; result: unknown }
  | { id: string; error: { code: number; message: string } }
