import { nanoid } from 'nanoid'
import type { ConditionExpression } from './condition-expression.js'

export interface Condition {
  readonly conditionId: string
  readonly expression: ConditionExpression
  satisfied: boolean
}

export function createCondition(expression: ConditionExpression): Condition {
  return {
    conditionId: nanoid(),
    expression,
    satisfied: false,
  }
}
