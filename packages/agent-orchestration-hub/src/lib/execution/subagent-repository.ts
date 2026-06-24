import type { ExecutionStatus } from './execution-status.js'
import type { Subagent } from './subagent.js'
import type { SubagentId } from './subagent-id.js'

export interface SubagentRepository {
  save(subagent: Subagent): void
  getById(subagentId: SubagentId): Subagent | undefined
  listAll(): Subagent[]
  listByStatus(status: ExecutionStatus): Subagent[]
}
