import type { EventBus } from '../events/event-bus.js'
import { createCondition } from './condition.js'
import type { Condition } from './condition.js'
import { evaluateCondition } from './condition-expression.js'
import type { ConditionExpression } from './condition-expression.js'
import type { GateEvaluationContext } from './gate-evaluation-context.js'
import type { GateClosed, GateEvaluationFailed, GateOpened } from './gate-events.js'
import type { GateId } from './gate-id.js'
import { GatePolicy } from './gate-policy.js'
import { GateState } from './gate-state.js'

export class Gate {
  readonly gateId: GateId
  private _state: GateState
  private readonly _conditions: Condition[]
  private readonly _policy: GatePolicy
  private readonly bus: EventBus

  private constructor(
    gateId: GateId,
    conditions: Condition[],
    policy: GatePolicy,
    bus: EventBus,
  ) {
    this.gateId = gateId
    this._conditions = conditions
    this._policy = policy
    this.bus = bus
    this._state = conditions.length === 0 ? GateState.open : GateState.closed
  }

  get state(): GateState {
    return this._state
  }

  get conditions(): readonly Condition[] {
    return this._conditions
  }

  static create(
    gateId: GateId,
    expressions: ConditionExpression[],
    policy: GatePolicy,
    bus: EventBus,
  ): Gate {
    const conditions = expressions.map(expr => createCondition(expr))
    return new Gate(gateId, conditions, policy, bus)
  }

  evaluate(ctx: GateEvaluationContext): void {
    try {
      let allSatisfied: boolean

      if (this._policy === GatePolicy.all_of) {
        allSatisfied = this._conditions.every(condition => {
          const result = evaluateCondition(condition.expression, ctx)
          condition.satisfied = result
          return result
        })
      } else {
        allSatisfied = false
      }

      const wasOpen = this._state === GateState.open
      const isEmpty = this._conditions.length === 0

      if (isEmpty || allSatisfied) {
        if (!wasOpen) {
          this._state = GateState.open
          const event: GateOpened = {
            type: 'gate.opened',
            occurredAt: new Date(),
            gateId: this.gateId,
          }
          this.bus.emit(event)
        }
      } else {
        if (wasOpen) {
          this._state = GateState.closed
          const event: GateClosed = {
            type: 'gate.closed',
            occurredAt: new Date(),
            gateId: this.gateId,
          }
          this.bus.emit(event)
        }
      }
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err)
      const event: GateEvaluationFailed = {
        type: 'gate.evaluation_failed',
        occurredAt: new Date(),
        gateId: this.gateId,
        reason,
      }
      this.bus.emit(event)
    }
  }

  isOpen(): boolean {
    return this._state === GateState.open
  }

  forceOpen(): void {
    if (this._state === GateState.open) return
    this._state = GateState.open
    const event: GateOpened = {
      type: 'gate.opened',
      occurredAt: new Date(),
      gateId: this.gateId,
    }
    this.bus.emit(event)
  }
}
