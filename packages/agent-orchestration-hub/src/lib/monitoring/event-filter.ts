import type { ServiceId } from '../registry/service-id.js'
import type { TaskStatus } from '../task/task-status.js'

export interface TaskFilter {
  readonly status?: TaskStatus
  readonly serviceId?: ServiceId
}
