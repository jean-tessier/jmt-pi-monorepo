import type { ExecutionStatus } from './execution-status.js'
import type { SubagentRepository } from './subagent-repository.js'
import type { Subagent } from './subagent.js'
import type { SubagentId } from './subagent-id.js'

export class InMemorySubagentRepository implements SubagentRepository {
  private readonly subagents = new Map<SubagentId, Subagent>()

  save(subagent: Subagent): void {
    this.subagents.set(subagent.subagentId, subagent)
  }

  getById(subagentId: SubagentId): Subagent | undefined {
    return this.subagents.get(subagentId)
  }

  listAll(): Subagent[] {
    return Array.from(this.subagents.values())
  }

  listByStatus(status: ExecutionStatus): Subagent[] {
    return Array.from(this.subagents.values()).filter(s => s.status === status)
  }
}
