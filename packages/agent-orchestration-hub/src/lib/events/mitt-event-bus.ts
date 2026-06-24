import _mittFactory from 'mitt'
import type { Emitter } from 'mitt'
import type { DomainEvent } from './domain-event.js'
import type { EventBus } from './event-bus.js'

// mitt lacks "type":"module" so NodeNext TypeScript treats its .d.ts as CJS,
// making the default import resolve to the module namespace. Cast to the real type.
type MittFactory = <E extends Record<string, unknown>>() => Emitter<E>
const createMitt = _mittFactory as unknown as MittFactory

export class MittEventBus implements EventBus {
  private readonly emitter = createMitt<Record<string, DomainEvent>>()

  emit(event: DomainEvent): void {
    this.emitter.emit(event.type, event)
  }

  on<E extends DomainEvent>(type: E['type'], handler: (event: E) => void): void {
    this.emitter.on(type, handler as (event: DomainEvent) => void)
  }

  off<E extends DomainEvent>(type: E['type'], handler: (event: E) => void): void {
    this.emitter.off(type, handler as (event: DomainEvent) => void)
  }
}
