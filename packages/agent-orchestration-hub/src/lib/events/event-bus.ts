import type { DomainEvent } from './domain-event.js'

export interface EventBus {
  emit(event: DomainEvent): void
  on<E extends DomainEvent>(type: E['type'], handler: (event: E) => void): void
  off<E extends DomainEvent>(type: E['type'], handler: (event: E) => void): void
}
