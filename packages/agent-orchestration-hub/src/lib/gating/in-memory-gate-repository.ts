import type { Gate } from './gate.js'
import type { GateId } from './gate-id.js'
import type { GateRepository } from './gate-repository.js'

export class InMemoryGateRepository implements GateRepository {
  private readonly gates = new Map<GateId, Gate>()

  save(gate: Gate): void {
    this.gates.set(gate.gateId, gate)
  }

  getById(gateId: GateId): Gate | undefined {
    return this.gates.get(gateId)
  }

  listAll(): Gate[] {
    return Array.from(this.gates.values())
  }
}
