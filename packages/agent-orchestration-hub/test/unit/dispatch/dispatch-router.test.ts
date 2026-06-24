import { describe, it, expect, vi } from 'vitest'
import { InMemoryEventBus } from '../../../src/lib/events/in-memory-event-bus.js'
import { InMemoryTaskRepository } from '../../../src/lib/task/in-memory-task-repository.js'
import { createServiceId } from '../../../src/lib/registry/service-id.js'
import { DispatchRouter } from '../../../src/lib/dispatch/dispatch-router.js'
import type { PromptRouted, RoutingFallback } from '../../../src/lib/dispatch/dispatch-events.js'
import type { Prompt } from '../../../src/lib/dispatch/prompt.js'
import type { RoutingRule } from '../../../src/lib/dispatch/routing-rule.js'

function makeRouter() {
  const bus = new InMemoryEventBus()
  const taskRepository = new InMemoryTaskRepository()
  const router = new DispatchRouter({ bus, taskRepository })
  return { router, bus, taskRepository }
}

function makeRule(pattern: RegExp, description?: string): RoutingRule {
  return {
    pattern,
    targetAgentId: createServiceId(),
    description,
  }
}

function makePrompt(text: string): Prompt {
  return { text }
}

describe('DispatchRouter', () => {
  describe('addRule()', () => {
    it('adds a rule to the routing table', () => {
      const { router } = makeRouter()
      const rule = makeRule(/hello/)
      router.addRule(rule)
      expect(router.listRules()).toHaveLength(1)
      expect(router.listRules()[0]).toBe(rule)
    })

    it('rules are evaluated in registration order', () => {
      const { router, bus } = makeRouter()
      const rule1 = makeRule(/hello/)
      const rule2 = makeRule(/world/)
      router.addRule(rule1)
      router.addRule(rule2)

      const handler = vi.fn()
      bus.on<PromptRouted>('prompt.routed', handler)

      router.dispatch(makePrompt('hello world'))

      expect(handler).toHaveBeenCalledOnce()
      const event = handler.mock.calls[0][0] as PromptRouted
      expect(event.matchedPattern).toBe(rule1.pattern.source)
    })
  })

  describe('removeRule()', () => {
    it('removes the rule with the matching pattern source', () => {
      const { router } = makeRouter()
      const rule = makeRule(/hello/)
      router.addRule(rule)
      expect(router.listRules()).toHaveLength(1)
      router.removeRule('hello')
      expect(router.listRules()).toHaveLength(0)
    })

    it('does nothing if the pattern is not found', () => {
      const { router } = makeRouter()
      const rule = makeRule(/hello/)
      router.addRule(rule)
      router.removeRule('nonexistent')
      expect(router.listRules()).toHaveLength(1)
    })
  })

  describe('dispatch()', () => {
    it('returns a TaskId and emits PromptRouted when a rule matches', () => {
      const { router, bus } = makeRouter()
      const rule = makeRule(/greet/)
      router.addRule(rule)

      const handler = vi.fn()
      bus.on<PromptRouted>('prompt.routed', handler)

      const prompt = makePrompt('greet the user')
      const taskId = router.dispatch(prompt)

      expect(taskId).toBeDefined()
      expect(handler).toHaveBeenCalledOnce()
      const event = handler.mock.calls[0][0] as PromptRouted
      expect(event.type).toBe('prompt.routed')
      expect(event.taskId).toBe(taskId)
      expect(event.prompt).toBe(prompt)
      expect(event.targetAgentId).toBe(rule.targetAgentId)
    })

    it('includes the matched pattern source in the PromptRouted event', () => {
      const { router, bus } = makeRouter()
      const rule = makeRule(/fetch data/)
      router.addRule(rule)

      const handler = vi.fn()
      bus.on<PromptRouted>('prompt.routed', handler)

      router.dispatch(makePrompt('fetch data from API'))

      const event = handler.mock.calls[0][0] as PromptRouted
      expect(event.matchedPattern).toBe('fetch data')
    })

    it('creates a Task for the matched prompt', () => {
      const { router, taskRepository } = makeRouter()
      const rule = makeRule(/analyze/)
      router.addRule(rule)

      const prompt = makePrompt('analyze this document')
      const taskId = router.dispatch(prompt)

      expect(taskId).toBeDefined()
      const task = taskRepository.getById(taskId!)
      expect(task).toBeDefined()
      expect(task!.subtasks).toHaveLength(1)
      expect(task!.subtasks[0].description).toBe(prompt.text)
    })

    it('returns undefined and emits RoutingFallback when no rule matches', () => {
      const { router, bus } = makeRouter()
      router.addRule(makeRule(/hello/))

      const handler = vi.fn()
      bus.on<RoutingFallback>('routing.fallback', handler)

      const prompt = makePrompt('unmatched prompt text')
      const taskId = router.dispatch(prompt)

      expect(taskId).toBeUndefined()
      expect(handler).toHaveBeenCalledOnce()
      const event = handler.mock.calls[0][0] as RoutingFallback
      expect(event.type).toBe('routing.fallback')
      expect(event.prompt).toBe(prompt)
      expect(event.reason).toBe('no_rule_matched')
    })

    it('matches on the first rule only when multiple rules could match', () => {
      const { router, bus } = makeRouter()
      const broadRule = makeRule(/.*/)
      const specificRule = makeRule(/specific/)
      router.addRule(broadRule)
      router.addRule(specificRule)

      const handler = vi.fn()
      bus.on<PromptRouted>('prompt.routed', handler)

      router.dispatch(makePrompt('specific text'))

      expect(handler).toHaveBeenCalledOnce()
      const event = handler.mock.calls[0][0] as PromptRouted
      expect(event.matchedPattern).toBe(broadRule.pattern.source)
    })

    it('respects regex case sensitivity', () => {
      const { router, bus } = makeRouter()
      router.addRule(makeRule(/Hello/))

      const fallbackHandler = vi.fn()
      const routedHandler = vi.fn()
      bus.on<RoutingFallback>('routing.fallback', fallbackHandler)
      bus.on<PromptRouted>('prompt.routed', routedHandler)

      router.dispatch(makePrompt('hello world'))

      expect(fallbackHandler).toHaveBeenCalledOnce()
      expect(routedHandler).not.toHaveBeenCalled()
    })
  })
})
