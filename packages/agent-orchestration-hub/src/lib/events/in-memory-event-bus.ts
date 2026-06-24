import type { DomainEvent } from './domain-event.js'
import type { EventBus } from './event-bus.js'

export class InMemoryEventBus implements EventBus {
  private readonly handlers = new Map<string, Set<(e: DomainEvent) => void>>()

  emit(event: DomainEvent): void {
    const set = this.handlers.get(event.type)
    if (set) {
      for (const handler of set) {
        handler(event)
      }
    }
  }

  on<E extends DomainEvent>(type: E['type'], handler: (event: E) => void): void {
    let set = this.handlers.get(type)
    if (!set) {
      set = new Set()
      this.handlers.set(type, set)
    }
    set.add(handler as (e: DomainEvent) => void)
  }

  off<E extends DomainEvent>(type: E['type'], handler: (event: E) => void): void {
    this.handlers.get(type)?.delete(handler as (e: DomainEvent) => void)
  }
}
