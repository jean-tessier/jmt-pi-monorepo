import { describe, it, expect, vi } from 'vitest'
import type { DomainEvent } from '../../../src/lib/events/domain-event.js'
import { InMemoryEventBus } from '../../../src/lib/events/in-memory-event-bus.js'
import { MittEventBus } from '../../../src/lib/events/mitt-event-bus.js'

interface TestEvent extends DomainEvent {
  readonly type: 'test.happened'
  readonly payload: string
}

const makeEvent = (payload: string): TestEvent => ({
  type: 'test.happened',
  payload,
  occurredAt: new Date(),
})

describe('InMemoryEventBus', () => {
  it('delivers an emitted event to a registered handler', () => {
    const bus = new InMemoryEventBus()
    const handler = vi.fn()
    bus.on<TestEvent>('test.happened', handler)
    const evt = makeEvent('hello')
    bus.emit(evt)
    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith(evt)
  })

  it('delivers the same event to multiple handlers registered on the same type', () => {
    const bus = new InMemoryEventBus()
    const h1 = vi.fn()
    const h2 = vi.fn()
    bus.on<TestEvent>('test.happened', h1)
    bus.on<TestEvent>('test.happened', h2)
    const evt = makeEvent('multi')
    bus.emit(evt)
    expect(h1).toHaveBeenCalledWith(evt)
    expect(h2).toHaveBeenCalledWith(evt)
  })

  it('does not deliver events to handlers registered on a different type', () => {
    const bus = new InMemoryEventBus()
    const handler = vi.fn()
    bus.on<TestEvent>('other.type' as TestEvent['type'], handler)
    bus.emit(makeEvent('ignored'))
    expect(handler).not.toHaveBeenCalled()
  })

  it('does not deliver events after off() is called', () => {
    const bus = new InMemoryEventBus()
    const handler = vi.fn()
    bus.on<TestEvent>('test.happened', handler)
    bus.off<TestEvent>('test.happened', handler)
    bus.emit(makeEvent('removed'))
    expect(handler).not.toHaveBeenCalled()
  })

  it('delivers events in emission order when multiple events are emitted sequentially', () => {
    const bus = new InMemoryEventBus()
    const received: string[] = []
    bus.on<TestEvent>('test.happened', (e) => received.push(e.payload))
    bus.emit(makeEvent('first'))
    bus.emit(makeEvent('second'))
    bus.emit(makeEvent('third'))
    expect(received).toEqual(['first', 'second', 'third'])
  })

  it('does not throw when emit is called with no handlers registered', () => {
    const bus = new InMemoryEventBus()
    expect(() => bus.emit(makeEvent('no-handlers'))).not.toThrow()
  })
})

describe('MittEventBus', () => {
  it('delivers an emitted event to a registered handler', () => {
    const bus = new MittEventBus()
    const handler = vi.fn()
    bus.on<TestEvent>('test.happened', handler)
    const evt = makeEvent('mitt-hello')
    bus.emit(evt)
    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith(evt)
  })

  it('does not deliver events after off() is called', () => {
    const bus = new MittEventBus()
    const handler = vi.fn()
    bus.on<TestEvent>('test.happened', handler)
    bus.off<TestEvent>('test.happened', handler)
    bus.emit(makeEvent('mitt-removed'))
    expect(handler).not.toHaveBeenCalled()
  })
})
