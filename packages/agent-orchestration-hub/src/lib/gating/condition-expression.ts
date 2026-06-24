import type { TaskId } from '../task/task-id.js'
import type { TaskStatus } from '../task/task-status.js'
import type { GateEvaluationContext } from './gate-evaluation-context.js'

export type ConditionExpression =
  | { kind: 'task_status'; taskId: TaskId; requiredStatus: TaskStatus }

export function evaluateCondition(
  expr: ConditionExpression,
  ctx: GateEvaluationContext,
): boolean {
  if (expr.kind === 'task_status') {
    const status = ctx.getTaskStatus(expr.taskId)
    return status === expr.requiredStatus
  }
  return false
}
