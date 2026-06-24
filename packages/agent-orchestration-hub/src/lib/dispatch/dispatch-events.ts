import type { DomainEvent } from '../events/domain-event.js'
import type { ServiceId } from '../registry/service-id.js'
import type { TaskId } from '../task/task-id.js'
import type { Prompt } from './prompt.js'

export interface PromptRouted extends DomainEvent {
  readonly type: 'prompt.routed'
  readonly prompt: Prompt
  readonly targetAgentId: ServiceId
  readonly matchedPattern: string
  readonly taskId: TaskId
}

export interface RoutingFallback extends DomainEvent {
  readonly type: 'routing.fallback'
  readonly prompt: Prompt
  readonly reason: 'no_rule_matched'
}
