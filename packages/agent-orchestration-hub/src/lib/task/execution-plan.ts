export interface SubtaskSpec {
  readonly sequence: number
  readonly description: string
}

export interface ExecutionPlan {
  readonly subtasks: readonly SubtaskSpec[]
  readonly preConditionGateIds: readonly string[]
  readonly postConditionGateIds: readonly string[]
}
