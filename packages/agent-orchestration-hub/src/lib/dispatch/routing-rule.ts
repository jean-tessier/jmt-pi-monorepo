import type { ServiceId } from '../registry/service-id.js'

export interface RoutingRule {
  readonly pattern: RegExp
  readonly targetAgentId: ServiceId
  readonly description?: string
}
