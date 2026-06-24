import type { EventBus } from '../events/event-bus.js'
import type { TaskRepository } from '../task/task-repository.js'
import type { TaskId } from '../task/task-id.js'
import { Task } from '../task/task.js'
import type { ExecutionPlan } from '../task/execution-plan.js'
import type { Prompt } from './prompt.js'
import type { RoutingRule } from './routing-rule.js'
import type { PromptRouted, RoutingFallback } from './dispatch-events.js'

export interface DispatchRouterOptions {
  readonly bus: EventBus
  readonly taskRepository: TaskRepository
}

export class DispatchRouter {
  private readonly bus: EventBus
  private readonly taskRepository: TaskRepository
  private readonly _rules: RoutingRule[] = []

  constructor(options: DispatchRouterOptions) {
    this.bus = options.bus
    this.taskRepository = options.taskRepository
  }

  addRule(rule: RoutingRule): void {
    this._rules.push(rule)
  }

  removeRule(patternSource: string): void {
    const index = this._rules.findIndex(r => r.pattern.source === patternSource)
    if (index !== -1) {
      this._rules.splice(index, 1)
    }
  }

  dispatch(prompt: Prompt): TaskId | undefined {
    for (const rule of this._rules) {
      if (rule.pattern.test(prompt.text)) {
        const plan: ExecutionPlan = {
          subtasks: [{ sequence: 1, description: prompt.text }],
          preConditionGateIds: [],
          postConditionGateIds: [],
        }
        const task = Task.create(plan, this.bus)
        this.taskRepository.save(task)
        const event: PromptRouted = {
          type: 'prompt.routed',
          occurredAt: new Date(),
          prompt,
          targetAgentId: rule.targetAgentId,
          matchedPattern: rule.pattern.source,
          taskId: task.taskId,
        }
        this.bus.emit(event)
        return task.taskId
      }
    }

    const event: RoutingFallback = {
      type: 'routing.fallback',
      occurredAt: new Date(),
      prompt,
      reason: 'no_rule_matched',
    }
    this.bus.emit(event)
    return undefined
  }

  listRules(): readonly RoutingRule[] {
    return this._rules
  }
}
