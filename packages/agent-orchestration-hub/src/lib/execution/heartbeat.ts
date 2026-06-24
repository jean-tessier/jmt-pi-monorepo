import type { SubagentId } from './subagent-id.js'

export interface Heartbeat {
  readonly subagentId: SubagentId
  readonly at: Date
}

export function createHeartbeat(subagentId: SubagentId): Heartbeat {
  return { subagentId, at: new Date() }
}
