import type { Gate } from './gate.js'
import type { GateId } from './gate-id.js'

export interface GateRepository {
  save(gate: Gate): void
  getById(gateId: GateId): Gate | undefined
  listAll(): Gate[]
}
