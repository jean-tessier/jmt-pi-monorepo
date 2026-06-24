# Agent Orchestration Hub — Implementation Plan

**Date**: 2026-06-23
**Status**: Draft

## Overview

This plan breaks the Agent Orchestration Hub MVP into ten sequential steps. Each step is a self-contained vertical slice that leaves the codebase in a green, typechecked state. Steps 1–8 build the pure domain library (`src/lib/`) with no I/O; step 9 adds the stdio transport wrapper; step 10 closes the loop with an end-to-end test. All cross-context communication routes through the `EventBus` — no aggregate may call another context's aggregate directly. File-based persistence and HTTP transport are explicitly deferred. The only new runtime dependencies are `mitt` (event bus) and `nanoid` (ID generation); `typebox` and `vitest` are inherited from the monorepo.

---

## Step 1 — Package Scaffold

### Goal

Bootstrap the `packages/agent-orchestration-hub` workspace with `package.json`, TypeScript config, Vitest config, and the skeleton directory tree. The package should typecheck cleanly and run an empty test suite with zero failures before any domain code is written.

### Files to create

| Path | Description |
|---|---|
| `packages/agent-orchestration-hub/package.json` | Workspace package manifest: name `@my-pi/agent-orchestration-hub`, type `module`, scripts for `build`, `typecheck`, `test`, `test:watch`; runtime deps `mitt`, `nanoid`, `@sinclair/typebox`; dev dep `vitest`, `typescript` |
| `packages/agent-orchestration-hub/tsconfig.json` | Extends the root `tsconfig.json`; `strict: true`, `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`, `outDir: dist`; includes `src/**/*` and `test/**/*` |
| `packages/agent-orchestration-hub/vitest.config.ts` | Vitest config: `include: ['test/**/*.test.ts']`, pool `forks`, coverage via `v8` |
| `packages/agent-orchestration-hub/src/lib/events/index.ts` | Re-export barrel for the events sub-package (empty at this step) |
| `packages/agent-orchestration-hub/src/lib/registry/index.ts` | Re-export barrel (empty) |
| `packages/agent-orchestration-hub/src/lib/dispatch/index.ts` | Re-export barrel (empty) |
| `packages/agent-orchestration-hub/src/lib/task/index.ts` | Re-export barrel (empty) |
| `packages/agent-orchestration-hub/src/lib/execution/index.ts` | Re-export barrel (empty) |
| `packages/agent-orchestration-hub/src/lib/gating/index.ts` | Re-export barrel (empty) |
| `packages/agent-orchestration-hub/src/lib/monitoring/index.ts` | Re-export barrel (empty) |
| `packages/agent-orchestration-hub/src/lib/index.ts` | Root domain library barrel; re-exports all sub-packages |
| `packages/agent-orchestration-hub/src/server/index.ts` | Root server barrel (empty) |
| `packages/agent-orchestration-hub/test/unit/.gitkeep` | Placeholder so the directory is tracked |
| `packages/agent-orchestration-hub/test/integration/.gitkeep` | Placeholder |

### Key interfaces/types to define

None at this step — files are empty barrels.

### Domain events to wire up

None.

### Tests to write

`test/unit/scaffold.test.ts`
```
describe('scaffold', () => {
  it('imports the domain library barrel without throwing')
})
```

### Definition of done

`pnpm --filter @my-pi/agent-orchestration-hub typecheck` exits 0 and `pnpm --filter @my-pi/agent-orchestration-hub test` runs 1 passing test.

---

## Step 2 — Event Bus

### Goal

Define the `EventBus` port interface and the typed base type for all domain events. Implement a mitt-backed `MittEventBus` adapter. Every subsequent context emits and subscribes through this interface — the adapter is the only place that imports `mitt`.

### Files to create/modify

| Path | Description |
|---|---|
| `packages/agent-orchestration-hub/src/lib/events/domain-event.ts` | `DomainEvent` base type and `DomainEventType` string-literal union (grows as new events are added) |
| `packages/agent-orchestration-hub/src/lib/events/event-bus.ts` | `EventBus` port interface |
| `packages/agent-orchestration-hub/src/lib/events/mitt-event-bus.ts` | `MittEventBus` class: implements `EventBus`, wraps `mitt`; must NOT be imported by any `lib/` module other than `events/` |
| `packages/agent-orchestration-hub/src/lib/events/in-memory-event-bus.ts` | `InMemoryEventBus` class: implements `EventBus` using a plain array and synchronous dispatch; used in tests where mitt is not needed |
| `packages/agent-orchestration-hub/src/lib/events/index.ts` | Re-exports `DomainEvent`, `EventBus`, `MittEventBus`, `InMemoryEventBus` |

### Key interfaces/types to define

```typescript
// domain-event.ts
export interface DomainEvent {
  readonly type: string;
  readonly occurredAt: Date;
}

// event-bus.ts
export interface EventBus {
  emit(event: DomainEvent): void;
  on<E extends DomainEvent>(type: E['type'], handler: (event: E) => void): void;
  off<E extends DomainEvent>(type: E['type'], handler: (event: E) => void): void;
}
```

### Domain events to wire up

None yet — the bus is built but no events exist until Step 3.

### Tests to write

`test/unit/events/event-bus.test.ts`
```
describe('InMemoryEventBus', () => {
  it('delivers an emitted event to a registered handler')
  it('delivers the same event to multiple handlers registered on the same type')
  it('does not deliver events to handlers registered on a different type')
  it('does not deliver events after off() is called')
  it('delivers events in emission order when multiple events are emitted sequentially')
  it('does not throw when emit is called with no handlers registered')
})

describe('MittEventBus', () => {
  it('delivers an emitted event to a registered handler')
  it('does not deliver events after off() is called')
})
```

### Definition of done

`pnpm --filter @my-pi/agent-orchestration-hub typecheck` exits 0 and `pnpm --filter @my-pi/agent-orchestration-hub test` reports 8 passing tests total.

---

## Step 3 — Registry Context

### Goal

Implement the Registry bounded context: `ServiceRegistry` aggregate, `Service` entity, all value objects, heartbeat detection, and the three registry domain events. After this step, services can register, deregister, and be declared lost.

### Files to create/modify

| Path | Description |
|---|---|
| `packages/agent-orchestration-hub/src/lib/registry/service-id.ts` | `ServiceId` branded type; `createServiceId()` factory using nanoid |
| `packages/agent-orchestration-hub/src/lib/registry/service-type.ts` | `ServiceType` enum: `agent`, `db`, `webhook`, `ui` |
| `packages/agent-orchestration-hub/src/lib/registry/service-status.ts` | `ServiceStatus` enum: `active`, `disconnected`, `draining` |
| `packages/agent-orchestration-hub/src/lib/registry/service.ts` | `Service` entity interface: `serviceId`, `type`, `status`, `registeredAt`, `lastHeartbeatAt` |
| `packages/agent-orchestration-hub/src/lib/registry/registry-events.ts` | `ServiceRegistered`, `ServiceDeregistered`, `ServiceLost` event types (each extends `DomainEvent`) |
| `packages/agent-orchestration-hub/src/lib/registry/service-registry.ts` | `ServiceRegistry` class: aggregate root; `register()`, `deregister()`, `heartbeat()`, `checkForLostServices(nowMs)`, `getById()`, `listByType()` |
| `packages/agent-orchestration-hub/src/lib/registry/index.ts` | Re-exports all of the above |
| `packages/agent-orchestration-hub/src/lib/events/domain-event.ts` | Add `'service.registered' | 'service.deregistered' | 'service.lost'` to `DomainEventType` |

### Key interfaces/types to define

```typescript
// service-id.ts
declare const ServiceIdBrand: unique symbol;
export type ServiceId = string & { readonly [ServiceIdBrand]: void };
export function createServiceId(): ServiceId;

// service.ts
export interface Service {
  readonly serviceId: ServiceId;
  readonly type: ServiceType;
  status: ServiceStatus;
  readonly registeredAt: Date;
  lastHeartbeatAt: Date;
}

// registry-events.ts
export interface ServiceRegistered extends DomainEvent {
  readonly type: 'service.registered';
  readonly serviceId: ServiceId;
  readonly serviceType: ServiceType;
}
export interface ServiceDeregistered extends DomainEvent {
  readonly type: 'service.deregistered';
  readonly serviceId: ServiceId;
}
export interface ServiceLost extends DomainEvent {
  readonly type: 'service.lost';
  readonly serviceId: ServiceId;
  readonly lastHeartbeatAt: Date;
}

// service-registry.ts
export interface ServiceRegistryOptions {
  readonly heartbeatTimeoutMs: number; // default: 30_000
  readonly bus: EventBus;
}
export class ServiceRegistry {
  constructor(options: ServiceRegistryOptions);
  register(serviceId: ServiceId, type: ServiceType): Service;
  deregister(serviceId: ServiceId): void;
  heartbeat(serviceId: ServiceId): void;
  checkForLostServices(nowMs: number): void; // called by server on a timer
  getById(serviceId: ServiceId): Service | undefined;
  listByType(type: ServiceType): Service[];
  listAll(): Service[];
}
```

### Domain events to wire up

| Emitter | Event | Notes |
|---|---|---|
| `ServiceRegistry.register()` | `ServiceRegistered` | Emits immediately after adding to the registry map |
| `ServiceRegistry.deregister()` | `ServiceDeregistered` | Emits immediately; sets status to `disconnected` |
| `ServiceRegistry.checkForLostServices()` | `ServiceLost` | Emitted for each service whose `lastHeartbeatAt` exceeds `heartbeatTimeoutMs` |

No other context subscribes in this step — subscriptions are wired in later steps.

### Tests to write

`test/unit/registry/service-registry.test.ts`
```
describe('ServiceRegistry', () => {
  describe('register()', () => {
    it('adds a service with status active')
    it('emits ServiceRegistered with correct serviceId and type')
    it('throws if the same serviceId is registered twice')
  })
  describe('deregister()', () => {
    it('sets service status to disconnected')
    it('emits ServiceDeregistered')
    it('throws if serviceId is not found')
  })
  describe('heartbeat()', () => {
    it('updates lastHeartbeatAt on the service')
    it('throws if serviceId is not found')
  })
  describe('checkForLostServices()', () => {
    it('emits ServiceLost for each service whose heartbeat has expired')
    it('does not emit ServiceLost for services within the heartbeat window')
    it('sets the lost service status to disconnected')
    it('does not emit ServiceLost twice for the same already-disconnected service')
  })
  describe('getById()', () => {
    it('returns the service when registered')
    it('returns undefined when not registered')
  })
  describe('listByType()', () => {
    it('returns only services of the requested type')
    it('returns an empty array when no services of that type exist')
  })
})
```

`test/unit/registry/service-id.test.ts`
```
describe('createServiceId', () => {
  it('returns a non-empty string')
  it('returns unique values on successive calls')
})
```

### Definition of done

Typecheck clean; 24 tests pass in total (8 from Step 2 + 16 new).

---

## Step 4 — Task Context

### Goal

Implement the Task bounded context: `Task` aggregate, `Subtask` entity, all value objects, all domain events, and the task lifecycle invariants. This is the heart of the system.

### Files to create/modify

| Path | Description |
|---|---|
| `packages/agent-orchestration-hub/src/lib/task/task-id.ts` | `TaskId` branded type; `createTaskId()` factory |
| `packages/agent-orchestration-hub/src/lib/task/task-status.ts` | `TaskStatus` enum: `pending`, `dispatched`, `running`, `completed`, `failed`, `blocked` |
| `packages/agent-orchestration-hub/src/lib/task/subtask-sequence.ts` | `SubtaskSequence` branded type (positive integer); `createSubtaskSequence(n: number)` with validation |
| `packages/agent-orchestration-hub/src/lib/task/subtask.ts` | `Subtask` entity: `sequence`, `description`, `status` (`'pending' | 'running' | 'completed' | 'failed' | 'skipped'`), optional `result` string |
| `packages/agent-orchestration-hub/src/lib/task/execution-plan.ts` | `ExecutionPlan` value object: ordered list of `SubtaskSpec` (inputs for constructing subtasks); `preConditionGateIds`; `postConditionGateIds` |
| `packages/agent-orchestration-hub/src/lib/task/progress.ts` | `Progress` value object: `{ completed: number; total: number }` and `computeProgress(subtasks: Subtask[]): Progress` |
| `packages/agent-orchestration-hub/src/lib/task/task-events.ts` | All eight task domain events |
| `packages/agent-orchestration-hub/src/lib/task/task.ts` | `Task` aggregate class with full lifecycle methods and invariant enforcement |
| `packages/agent-orchestration-hub/src/lib/task/task-repository.ts` | `TaskRepository` port interface (in-memory implementation for MVP) |
| `packages/agent-orchestration-hub/src/lib/task/in-memory-task-repository.ts` | `InMemoryTaskRepository` implements `TaskRepository` |
| `packages/agent-orchestration-hub/src/lib/task/index.ts` | Re-exports all of the above |
| `packages/agent-orchestration-hub/src/lib/events/domain-event.ts` | Extend `DomainEventType` with 8 new task event types |

### Key interfaces/types to define

```typescript
// execution-plan.ts
export interface SubtaskSpec {
  readonly sequence: number;
  readonly description: string;
}
export interface ExecutionPlan {
  readonly subtasks: readonly SubtaskSpec[];
  readonly preConditionGateIds: readonly string[];  // GateId values
  readonly postConditionGateIds: readonly string[];
}

// task-events.ts
export interface TaskCreated extends DomainEvent {
  readonly type: 'task.created';
  readonly taskId: TaskId;
  readonly plan: ExecutionPlan;
}
export interface TaskDispatched extends DomainEvent {
  readonly type: 'task.dispatched';
  readonly taskId: TaskId;
  readonly targetServiceId: ServiceId;
}
export interface TaskRunning extends DomainEvent {
  readonly type: 'task.running';
  readonly taskId: TaskId;
}
export interface TaskCompleted extends DomainEvent {
  readonly type: 'task.completed';
  readonly taskId: TaskId;
}
export interface TaskFailed extends DomainEvent {
  readonly type: 'task.failed';
  readonly taskId: TaskId;
  readonly reason: string;
}
export interface TaskBlocked extends DomainEvent {
  readonly type: 'task.blocked';
  readonly taskId: TaskId;
  readonly reason: string;
}
export interface SubtaskCompleted extends DomainEvent {
  readonly type: 'subtask.completed';
  readonly taskId: TaskId;
  readonly sequence: SubtaskSequence;
  readonly result: string | undefined;
}
export interface SubtaskFailed extends DomainEvent {
  readonly type: 'subtask.failed';
  readonly taskId: TaskId;
  readonly sequence: SubtaskSequence;
  readonly reason: string;
}

// task.ts
export class Task {
  readonly taskId: TaskId;
  get status(): TaskStatus;
  get subtasks(): readonly Subtask[];
  get plan(): ExecutionPlan;

  // Factory — emits TaskCreated
  static create(plan: ExecutionPlan, bus: EventBus): Task;

  // Lifecycle — each enforces invariants and emits the matching event
  dispatch(targetServiceId: ServiceId): void;  // throws if not pending; throws if preConditionGateIds not empty (gates handled externally)
  start(): void;         // throws if not dispatched
  completeSubtask(sequence: SubtaskSequence, result?: string): void;  // throws if sequence not found or already completed
  failSubtask(sequence: SubtaskSequence, reason: string): void;
  complete(): void;      // throws if any required subtask is not completed/skipped
  fail(reason: string): void;
  block(reason: string): void;
}

// task-repository.ts
export interface TaskRepository {
  save(task: Task): void;
  getById(taskId: TaskId): Task | undefined;
  listAll(): Task[];
  listByStatus(status: TaskStatus): Task[];
}
```

### Domain events to wire up

| Emitter | Event | Notes |
|---|---|---|
| `Task.create()` | `TaskCreated` | Includes full execution plan |
| `Task.dispatch()` | `TaskDispatched` | Includes target service ID |
| `Task.start()` | `TaskRunning` | |
| `Task.completeSubtask()` | `SubtaskCompleted` | |
| `Task.failSubtask()` | `SubtaskFailed` | Also calls `task.fail()` for MVP (no partial failure recovery) |
| `Task.complete()` | `TaskCompleted` | Gating context subscribes in Step 6 |
| `Task.fail()` | `TaskFailed` | |
| `Task.block()` | `TaskBlocked` | |

### Tests to write

`test/unit/task/task.test.ts`
```
describe('Task', () => {
  describe('create()', () => {
    it('initialises with status pending')
    it('initialises subtasks from the execution plan in sequence order')
    it('emits TaskCreated with the full execution plan')
    it('throws if the execution plan has no subtasks')
    it('throws if two subtasks have the same sequence number')
  })
  describe('dispatch()', () => {
    it('transitions status to dispatched and emits TaskDispatched')
    it('throws when called on a non-pending task')
  })
  describe('start()', () => {
    it('transitions status to running and emits TaskRunning')
    it('throws when called on a non-dispatched task')
  })
  describe('completeSubtask()', () => {
    it('marks the subtask completed and emits SubtaskCompleted with result')
    it('throws if the sequence number does not exist')
    it('throws if the subtask is already completed')
  })
  describe('failSubtask()', () => {
    it('marks the subtask failed and emits SubtaskFailed')
    it('throws if the sequence number does not exist')
  })
  describe('complete()', () => {
    it('transitions to completed and emits TaskCompleted when all subtasks are completed')
    it('throws if any required subtask is not completed')
    it('throws when called on an already-completed task')
  })
  describe('fail()', () => {
    it('transitions to failed and emits TaskFailed with the reason')
    it('throws when called on a completed task')
  })
  describe('block()', () => {
    it('transitions to blocked and emits TaskBlocked with the reason')
  })
})
```

`test/unit/task/progress.test.ts`
```
describe('computeProgress', () => {
  it('returns 0/N when no subtasks are completed')
  it('returns N/N when all subtasks are completed')
  it('counts skipped subtasks as completed')
  it('does not count failed subtasks as completed')
})
```

`test/unit/task/execution-plan.test.ts`
```
describe('ExecutionPlan', () => {
  it('accepts an ordered list of subtask specs')
  it('accepts empty preConditionGateIds and postConditionGateIds')
})
```

### Definition of done

Typecheck clean; approximately 45 tests pass in total.

---

## Step 5 — Execution Context

### Goal

Implement the Execution bounded context: `Subagent` aggregate, `Assignment` value object, `Heartbeat` value object, heartbeat timeout detection, and all five execution domain events.

### Files to create/modify

| Path | Description |
|---|---|
| `packages/agent-orchestration-hub/src/lib/execution/subagent-id.ts` | `SubagentId` branded type; `createSubagentId()` factory |
| `packages/agent-orchestration-hub/src/lib/execution/execution-status.ts` | `ExecutionStatus` enum: `idle`, `executing`, `stalled`, `completed` |
| `packages/agent-orchestration-hub/src/lib/execution/assignment.ts` | `Assignment` value object: `{ taskId: TaskId; subagentId: SubagentId; assignedAt: Date }` |
| `packages/agent-orchestration-hub/src/lib/execution/heartbeat.ts` | `Heartbeat` value object: `{ subagentId: SubagentId; at: Date }` and `createHeartbeat(subagentId)` factory |
| `packages/agent-orchestration-hub/src/lib/execution/execution-events.ts` | `SubagentAssigned`, `SubagentStarted`, `SubagentCompleted`, `SubagentFailed`, `SubagentTimeout` event types |
| `packages/agent-orchestration-hub/src/lib/execution/subagent.ts` | `Subagent` aggregate class |
| `packages/agent-orchestration-hub/src/lib/execution/subagent-repository.ts` | `SubagentRepository` port interface |
| `packages/agent-orchestration-hub/src/lib/execution/in-memory-subagent-repository.ts` | In-memory implementation |
| `packages/agent-orchestration-hub/src/lib/execution/index.ts` | Re-exports all |
| `packages/agent-orchestration-hub/src/lib/events/domain-event.ts` | Add 5 execution event types to `DomainEventType` |

### Key interfaces/types to define

```typescript
// execution-events.ts
export interface SubagentAssigned extends DomainEvent {
  readonly type: 'subagent.assigned';
  readonly subagentId: SubagentId;
  readonly taskId: TaskId;
  readonly assignedAt: Date;
}
export interface SubagentStarted extends DomainEvent {
  readonly type: 'subagent.started';
  readonly subagentId: SubagentId;
  readonly taskId: TaskId;
}
export interface SubagentCompleted extends DomainEvent {
  readonly type: 'subagent.completed';
  readonly subagentId: SubagentId;
  readonly taskId: TaskId;
}
export interface SubagentFailed extends DomainEvent {
  readonly type: 'subagent.failed';
  readonly subagentId: SubagentId;
  readonly taskId: TaskId;
  readonly reason: string;
}
export interface SubagentTimeout extends DomainEvent {
  readonly type: 'subagent.timeout';
  readonly subagentId: SubagentId;
  readonly taskId: TaskId | undefined;
  readonly lastHeartbeatAt: Date;
}

// subagent.ts
export class Subagent {
  readonly subagentId: SubagentId;
  get status(): ExecutionStatus;
  get assignment(): Assignment | undefined;
  get lastHeartbeatAt(): Date;

  static create(subagentId: SubagentId, bus: EventBus): Subagent;

  assign(taskId: TaskId): void;     // throws if not idle; emits SubagentAssigned
  start(): void;                    // throws if not assigned; emits SubagentStarted
  heartbeat(): void;                // updates lastHeartbeatAt
  complete(): void;                 // emits SubagentCompleted; transitions to idle (ready for next task)
  fail(reason: string): void;       // emits SubagentFailed
  checkTimeout(nowMs: number, timeoutMs: number): void; // emits SubagentTimeout if threshold exceeded
}
```

### Domain events to wire up

| Emitter | Event | Subscriber (added in later steps) |
|---|---|---|
| `Subagent.assign()` | `SubagentAssigned` | Task Context (Step 4 events already defined; wiring in Step 9) |
| `Subagent.start()` | `SubagentStarted` | Monitoring Context (Step 8) |
| `Subagent.complete()` | `SubagentCompleted` | Task Context |
| `Subagent.fail()` | `SubagentFailed` | Task Context |
| `Subagent.checkTimeout()` | `SubagentTimeout` | Task Context (blocks the task) |

### Tests to write

`test/unit/execution/subagent.test.ts`
```
describe('Subagent', () => {
  describe('create()', () => {
    it('initialises with status idle')
    it('initialises with no assignment')
  })
  describe('assign()', () => {
    it('sets assignment and emits SubagentAssigned')
    it('throws if the subagent is not idle')
  })
  describe('start()', () => {
    it('transitions to executing and emits SubagentStarted')
    it('throws if no assignment exists')
  })
  describe('heartbeat()', () => {
    it('updates lastHeartbeatAt to now')
  })
  describe('complete()', () => {
    it('emits SubagentCompleted and transitions back to idle')
    it('clears the assignment after completion')
  })
  describe('fail()', () => {
    it('emits SubagentFailed with the reason')
  })
  describe('checkTimeout()', () => {
    it('emits SubagentTimeout when heartbeat has exceeded the threshold')
    it('does not emit SubagentTimeout when within the threshold')
    it('does not emit SubagentTimeout again if already in stalled status')
  })
})
```

### Definition of done

Typecheck clean; approximately 57 tests pass in total.

---

## Step 6 — Gating Context

### Goal

Implement the Gating bounded context: `Gate` aggregate, `Condition` entity, `GatePolicy` (only `all_of` for MVP), gate state transitions, pre/post condition wiring, and the three gate domain events. Gates subscribe to `TaskCompleted` events on the bus to evaluate post-conditions automatically.

### Files to create/modify

| Path | Description |
|---|---|
| `packages/agent-orchestration-hub/src/lib/gating/gate-id.ts` | `GateId` branded type; `createGateId()` factory |
| `packages/agent-orchestration-hub/src/lib/gating/gate-state.ts` | `GateState` enum: `open`, `closed`, `opening`, `failed` |
| `packages/agent-orchestration-hub/src/lib/gating/gate-policy.ts` | `GatePolicy` enum: `all_of` (only value for MVP; `any_of` and `exactly_n` reserved but not implemented) |
| `packages/agent-orchestration-hub/src/lib/gating/condition-expression.ts` | `ConditionExpression` value object; `TaskStatusCondition` (type-discriminated union); `evaluateCondition(expr, context)` pure function |
| `packages/agent-orchestration-hub/src/lib/gating/condition.ts` | `Condition` entity: `conditionId`, `expression: ConditionExpression`, `satisfied: boolean` |
| `packages/agent-orchestration-hub/src/lib/gating/dependency-spec.ts` | `DependencySpec` value object: `{ taskIds: TaskId[] }` |
| `packages/agent-orchestration-hub/src/lib/gating/gate-events.ts` | `GateOpened`, `GateClosed`, `GateEvaluationFailed` event types |
| `packages/agent-orchestration-hub/src/lib/gating/gate-evaluation-context.ts` | `GateEvaluationContext` interface: snapshot of state needed to evaluate conditions (task statuses by ID) |
| `packages/agent-orchestration-hub/src/lib/gating/gate.ts` | `Gate` aggregate class |
| `packages/agent-orchestration-hub/src/lib/gating/gate-repository.ts` | `GateRepository` port interface |
| `packages/agent-orchestration-hub/src/lib/gating/in-memory-gate-repository.ts` | In-memory implementation |
| `packages/agent-orchestration-hub/src/lib/gating/gate-service.ts` | `GateService`: subscribes to `task.completed` on the bus and triggers re-evaluation of gates that reference the completed task |
| `packages/agent-orchestration-hub/src/lib/gating/index.ts` | Re-exports all |
| `packages/agent-orchestration-hub/src/lib/events/domain-event.ts` | Add 3 gate event types to `DomainEventType` |

### Key interfaces/types to define

```typescript
// condition-expression.ts
export type ConditionExpression =
  | { kind: 'task_status'; taskId: TaskId; requiredStatus: TaskStatus };
// Future: | { kind: 'service_active'; serviceId: ServiceId }

export function evaluateCondition(
  expr: ConditionExpression,
  ctx: GateEvaluationContext
): boolean;

// gate-evaluation-context.ts
export interface GateEvaluationContext {
  getTaskStatus(taskId: TaskId): TaskStatus | undefined;
}

// gate-events.ts
export interface GateOpened extends DomainEvent {
  readonly type: 'gate.opened';
  readonly gateId: GateId;
}
export interface GateClosed extends DomainEvent {
  readonly type: 'gate.closed';
  readonly gateId: GateId;
}
export interface GateEvaluationFailed extends DomainEvent {
  readonly type: 'gate.evaluation_failed';
  readonly gateId: GateId;
  readonly reason: string;
}

// gate.ts
export class Gate {
  readonly gateId: GateId;
  get state(): GateState;
  get conditions(): readonly Condition[];

  static create(
    gateId: GateId,
    conditions: ConditionExpression[],
    policy: GatePolicy,
    bus: EventBus
  ): Gate;

  evaluate(ctx: GateEvaluationContext): void;
  // Evaluates all conditions per policy; transitions to open/closed; emits GateOpened or GateEvaluationFailed
  
  isOpen(): boolean;
}

// gate-service.ts
export class GateService {
  constructor(repo: GateRepository, bus: EventBus);
  // On construction, subscribes to 'task.completed' on the bus.
  // When TaskCompleted arrives, rebuilds GateEvaluationContext and calls gate.evaluate() on
  // all gates whose conditions reference that taskId.
  start(): void;
  stop(): void;
}
```

### Domain events to wire up

| Trigger | Emitter | Event | Who subscribes |
|---|---|---|---|
| `Gate.evaluate()` — all conditions satisfied | `Gate` | `GateOpened` | Dispatch Context (Step 7) gates awaiting open signal |
| `Gate.evaluate()` — not all satisfied (already open → close) | `Gate` | `GateClosed` | Monitoring |
| `Gate.evaluate()` — exception during evaluation | `Gate` | `GateEvaluationFailed` | Monitoring |
| `task.completed` arrives on bus | `GateService` | triggers `gate.evaluate()` on relevant gates | — |

### Tests to write

`test/unit/gating/condition-expression.test.ts`
```
describe('evaluateCondition', () => {
  it('returns true when task status matches the required status')
  it('returns false when task status does not match')
  it('returns false when the task is not found in the context')
})
```

`test/unit/gating/gate.test.ts`
```
describe('Gate', () => {
  describe('create()', () => {
    it('initialises with state closed when conditions array is non-empty')
    it('initialises with state open when conditions array is empty (trivially satisfied)')
  })
  describe('evaluate() with all_of policy', () => {
    it('transitions to open and emits GateOpened when all conditions are satisfied')
    it('remains closed and does not emit GateOpened when one condition is unsatisfied')
    it('transitions back to closed and emits GateClosed when a previously-open gate re-evaluates and fails')
    it('emits GateEvaluationFailed when evaluation throws')
  })
  describe('isOpen()', () => {
    it('returns true when state is open')
    it('returns false when state is closed, opening, or failed')
  })
})
```

`test/unit/gating/gate-service.test.ts`
```
describe('GateService', () => {
  it('evaluates gates referencing a task when task.completed is emitted on the bus')
  it('does not evaluate gates that do not reference the completed task')
  it('stops listening after stop() is called')
})
```

### Definition of done

Typecheck clean; approximately 75 tests pass in total.

---

## Step 7 — Dispatch Context

### Goal

Implement the Dispatch bounded context: `DispatchRouter` aggregate, `RoutingRule` value object (regex → target agent), `Prompt` value object, and `PromptRouted` event. The router checks each rule in registration order and dispatches to the first match. A `RoutingFallback` event is emitted when no rule matches.

### Files to create/modify

| Path | Description |
|---|---|
| `packages/agent-orchestration-hub/src/lib/dispatch/prompt.ts` | `Prompt` value object: `{ text: string; metadata?: Record<string, unknown> }` |
| `packages/agent-orchestration-hub/src/lib/dispatch/routing-rule.ts` | `RoutingRule` value object: `{ pattern: RegExp; targetAgentId: ServiceId; description?: string }` |
| `packages/agent-orchestration-hub/src/lib/dispatch/dispatch-events.ts` | `PromptRouted` and `RoutingFallback` event types |
| `packages/agent-orchestration-hub/src/lib/dispatch/dispatch-router.ts` | `DispatchRouter` class |
| `packages/agent-orchestration-hub/src/lib/dispatch/index.ts` | Re-exports all |
| `packages/agent-orchestration-hub/src/lib/events/domain-event.ts` | Add `'prompt.routed'` and `'routing.fallback'` to `DomainEventType` |

### Key interfaces/types to define

```typescript
// dispatch-events.ts
export interface PromptRouted extends DomainEvent {
  readonly type: 'prompt.routed';
  readonly prompt: Prompt;
  readonly targetAgentId: ServiceId;
  readonly matchedPattern: string; // RegExp.source of the matched rule
  readonly taskId: TaskId;         // the task created for this prompt
}
export interface RoutingFallback extends DomainEvent {
  readonly type: 'routing.fallback';
  readonly prompt: Prompt;
  readonly reason: 'no_rule_matched';
}

// dispatch-router.ts
export interface DispatchRouterOptions {
  readonly bus: EventBus;
  readonly taskRepository: TaskRepository;
}
export class DispatchRouter {
  constructor(options: DispatchRouterOptions);
  addRule(rule: RoutingRule): void;
  removeRule(pattern: string): void;
  dispatch(prompt: Prompt): TaskId | undefined;
  // Finds first matching rule; creates a Task with a single subtask (the prompt text);
  // emits PromptRouted or RoutingFallback
  listRules(): readonly RoutingRule[];
}
```

Note: `DispatchRouter.dispatch()` creates the `Task` object via `Task.create()` passing an `ExecutionPlan` with a single subtask. The `TaskId` from the created task is included in the `PromptRouted` event. If no rule matches, `RoutingFallback` is emitted and `undefined` is returned.

### Domain events to wire up

| Emitter | Event | Subscriber |
|---|---|---|
| `DispatchRouter.dispatch()` — rule matched | `PromptRouted` | Execution Context (assigns a subagent; wired in Step 9) |
| `DispatchRouter.dispatch()` — no match | `RoutingFallback` | Monitoring Context |

### Tests to write

`test/unit/dispatch/dispatch-router.test.ts`
```
describe('DispatchRouter', () => {
  describe('addRule()', () => {
    it('adds a rule to the routing table')
    it('rules are evaluated in registration order')
  })
  describe('removeRule()', () => {
    it('removes the rule with the matching pattern source')
    it('does nothing if the pattern is not found')
  })
  describe('dispatch()', () => {
    it('returns a TaskId and emits PromptRouted when a rule matches')
    it('includes the matched pattern source in the PromptRouted event')
    it('creates a Task for the matched prompt')
    it('returns undefined and emits RoutingFallback when no rule matches')
    it('matches on the first rule only when multiple rules could match')
    it('respects regex case sensitivity')
  })
})
```

`test/unit/dispatch/routing-rule.test.ts`
```
describe('RoutingRule', () => {
  it('stores the pattern as a RegExp')
  it('stores the targetAgentId')
})
```

### Definition of done

Typecheck clean; approximately 87 tests pass in total.

---

## Step 8 — Monitoring Context

### Goal

Implement the Monitoring bounded context as a pure CQRS read side. `MonitoringProjection` subscribes to domain events and maintains an in-memory read model of task snapshots. No aggregates are touched; no writes go through this context.

### Files to create/modify

| Path | Description |
|---|---|
| `packages/agent-orchestration-hub/src/lib/monitoring/task-snapshot.ts` | `TaskSnapshot` read model type |
| `packages/agent-orchestration-hub/src/lib/monitoring/subtask-snapshot.ts` | `SubtaskSnapshot` read model type |
| `packages/agent-orchestration-hub/src/lib/monitoring/event-filter.ts` | `TaskFilter` value object: `{ status?: TaskStatus; serviceId?: ServiceId }` |
| `packages/agent-orchestration-hub/src/lib/monitoring/monitoring-projection.ts` | `MonitoringProjection` class: subscribes to events, maintains snapshots, exposes query methods |
| `packages/agent-orchestration-hub/src/lib/monitoring/index.ts` | Re-exports all |

### Key interfaces/types to define

```typescript
// task-snapshot.ts
export interface TaskSnapshot {
  readonly taskId: TaskId;
  readonly status: TaskStatus;
  readonly plan: ExecutionPlan;
  readonly subtasks: readonly SubtaskSnapshot[];
  readonly progress: Progress;
  readonly assignedSubagentId: SubagentId | undefined;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// subtask-snapshot.ts
export interface SubtaskSnapshot {
  readonly sequence: SubtaskSequence;
  readonly description: string;
  readonly status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  readonly result: string | undefined;
}

// monitoring-projection.ts
export class MonitoringProjection {
  constructor(bus: EventBus);
  // Subscribes on construction to:
  //   task.created, task.dispatched, task.running, task.completed, task.failed, task.blocked,
  //   subtask.completed, subtask.failed, subagent.assigned

  getTaskStatus(taskId: TaskId): TaskSnapshot | undefined;
  listTasks(filter?: TaskFilter): readonly TaskSnapshot[];
}
```

The projection **does not** hold references to `Task` aggregates. It maintains its own `Map<TaskId, TaskSnapshot>` and updates it as events arrive. All query operations are synchronous reads from this map.

### Domain events to wire up (subscriptions)

| Event subscribed | Projection action |
|---|---|
| `task.created` | Insert new `TaskSnapshot` with status `pending` |
| `task.dispatched` | Update snapshot status to `dispatched` |
| `task.running` | Update snapshot status to `running` |
| `task.completed` | Update snapshot status to `completed` |
| `task.failed` | Update snapshot status to `failed` |
| `task.blocked` | Update snapshot status to `blocked` |
| `subtask.completed` | Update subtask entry in snapshot; recompute progress |
| `subtask.failed` | Update subtask entry in snapshot |
| `subagent.assigned` | Set `assignedSubagentId` on the matching snapshot |

### Tests to write

`test/unit/monitoring/monitoring-projection.test.ts`
```
describe('MonitoringProjection', () => {
  describe('getTaskStatus()', () => {
    it('returns undefined for an unknown taskId')
    it('returns a snapshot with status pending after TaskCreated')
    it('updates snapshot status to dispatched after TaskDispatched')
    it('updates snapshot status to running after TaskRunning')
    it('updates snapshot status to completed after TaskCompleted')
    it('updates snapshot status to failed after TaskFailed')
    it('updates snapshot status to blocked after TaskBlocked')
    it('updates subtask status in the snapshot after SubtaskCompleted')
    it('updates subtask status in the snapshot after SubtaskFailed')
    it('sets assignedSubagentId after SubagentAssigned')
    it('recomputes progress when subtasks are completed')
  })
  describe('listTasks()', () => {
    it('returns all snapshots when no filter is provided')
    it('filters by status when TaskFilter.status is set')
    it('returns an empty array when no tasks match the filter')
  })
})
```

### Definition of done

Typecheck clean; approximately 100 tests pass in total.

---

## Step 9 — Server Wrapper (stdio)

### Goal

Add the thin transport layer in `src/server/`. The server reads line-delimited JSON from stdin, routes requests to domain operations, and writes line-delimited JSON responses to stdout. No domain logic lives here — the server is only a translation layer between the wire format and the domain library.

### Files to create/modify

| Path | Description |
|---|---|
| `packages/agent-orchestration-hub/src/server/protocol.ts` | Request and response type definitions (typed union of all valid message shapes) |
| `packages/agent-orchestration-hub/src/server/hub.ts` | `Hub` class: owns all domain objects (registry, router, task/subagent/gate repos, monitoring projection, bus); wires cross-context subscriptions |
| `packages/agent-orchestration-hub/src/server/request-handler.ts` | `RequestHandler`: maps a parsed request to the correct domain operation and returns a response |
| `packages/agent-orchestration-hub/src/server/stdio-transport.ts` | `StdioTransport`: reads stdin line by line using `node:readline`, parses JSON, calls `RequestHandler`, writes JSON response to stdout |
| `packages/agent-orchestration-hub/src/server/heartbeat-ticker.ts` | `HeartbeatTicker`: sets up a `setInterval` that calls `registry.checkForLostServices()` and `subagent.checkTimeout()` on the configured interval |
| `packages/agent-orchestration-hub/src/server/index.ts` | Re-exports `Hub` and `StdioTransport`; provides `startServer()` convenience function |
| `packages/agent-orchestration-hub/src/main.ts` | Entry point: calls `startServer()` with default config |

### Protocol message format (line-delimited JSON)

```typescript
// protocol.ts

// ---- Requests (client → server) ----
export type Request =
  | { id: string; method: 'register_service'; params: { serviceType: string } }
  | { id: string; method: 'deregister_service'; params: { serviceId: string } }
  | { id: string; method: 'heartbeat'; params: { serviceId: string } }
  | { id: string; method: 'add_routing_rule'; params: { pattern: string; targetAgentId: string } }
  | { id: string; method: 'dispatch_prompt'; params: { text: string; metadata?: Record<string, unknown> } }
  | { id: string; method: 'get_task_status'; params: { taskId: string } }
  | { id: string; method: 'list_tasks'; params: { status?: string } }
  | { id: string; method: 'report_subtask_completed'; params: { taskId: string; sequence: number; result?: string } }
  | { id: string; method: 'report_subtask_failed'; params: { taskId: string; sequence: number; reason: string } }
  | { id: string; method: 'open_gate'; params: { gateId: string } };  // manual override for MVP

// ---- Responses (server → client) ----
export type Response =
  | { id: string; result: unknown }
  | { id: string; error: { code: number; message: string } };
```

### Cross-context subscriptions wired in `Hub`

The `Hub` constructor wires all cross-context event subscriptions that were deferred in previous steps:

| Event | Subscriber action |
|---|---|
| `service.lost` | Look up tasks assigned to that service; call `task.block('service lost')` on each |
| `subagent.timeout` | Call `task.block('subagent timeout')` on the associated task |
| `subagent.completed` | Call `task.complete()` if all subtasks are done |
| `subagent.failed` | Call `task.fail(reason)` |
| `gate.opened` | Find all pending tasks whose `preConditionGateIds` are all now open; call `task.dispatch()` on each |

### Tests to write

`test/integration/server/request-handler.test.ts`
```
describe('RequestHandler', () => {
  describe('register_service', () => {
    it('returns the new serviceId in the result')
    it('returns an error when service type is invalid')
  })
  describe('dispatch_prompt', () => {
    it('returns a taskId when a routing rule matches the prompt')
    it('returns an error result when no routing rule matches')
  })
  describe('get_task_status', () => {
    it('returns the task snapshot when the task exists')
    it('returns an error when the taskId is not found')
  })
  describe('list_tasks', () => {
    it('returns all tasks when no status filter is provided')
    it('returns only matching tasks when a status filter is provided')
  })
  describe('report_subtask_completed', () => {
    it('transitions the subtask to completed and returns ok')
    it('returns an error when the taskId is not found')
  })
  describe('heartbeat', () => {
    it('updates lastHeartbeatAt and returns ok')
    it('returns an error when the serviceId is not found')
  })
})
```

`test/integration/server/hub.test.ts`
```
describe('Hub cross-context wiring', () => {
  it('blocks a task when the assigned service is declared lost')
  it('dispatches a pending gated task when its pre-condition gate opens')
  it('opens post-condition gates when a task completes')
  it('blocks a task when its assigned subagent times out')
})
```

### Definition of done

Typecheck clean; approximately 115 tests pass in total. `src/main.ts` can be invoked via `node dist/main.js` and responds to `{"id":"1","method":"list_tasks","params":{}}` on stdin with a valid JSON response on stdout.

---

## Step 10 — End-to-End Test

### Goal

Write a single end-to-end test that spins up the full server process in a child process, drives it through the primary happy path via stdin/stdout, asserts the complete event sequence and final task status, then shuts down cleanly.

### Files to create/modify

| Path | Description |
|---|---|
| `test/integration/e2e/happy-path.test.ts` | End-to-end test: spawn server, exercise the full orchestration flow, assert outputs |
| `packages/agent-orchestration-hub/src/server/event-stream-transport.ts` | Optional: adds a server-side event push so the test can receive domain events (can be implemented as a secondary stdout channel with a `data:` prefix, or deferred in favor of polling `get_task_status`) |

### Test scenario

`test/integration/e2e/happy-path.test.ts`
```
describe('End-to-end: full orchestration happy path', () => {
  it('completes the full lifecycle: register → route → task lifecycle → gate open', async () => {
    // 1. Spawn the server as a child process
    // 2. Send register_service { serviceType: 'agent' } → assert result contains serviceId
    // 3. Send add_routing_rule { pattern: '^test:', targetAgentId: <serviceId> }
    // 4. Send dispatch_prompt { text: 'test: do something' } → assert result contains taskId
    // 5. Send get_task_status { taskId } → assert status is 'dispatched'
    // 6. Send report_subtask_completed { taskId, sequence: 1 } → assert ok
    // 7. Send get_task_status { taskId } → assert status is 'completed'
    // 8. Send get_task_status for a non-existent taskId → assert error response
    // 9. Kill the server process; assert it exits cleanly (exit code 0)
  })

  it('blocks a task when its registered service is declared lost', async () => {
    // 1. Spawn server with a very short heartbeatTimeoutMs (e.g. 100ms)
    // 2. Register an agent service
    // 3. Add a routing rule and dispatch a prompt → get taskId
    // 4. Wait longer than the heartbeat timeout without sending a heartbeat
    // 5. Poll get_task_status until status is 'blocked' (or timeout the test)
    // 6. Assert status is 'blocked'
  })

  it('emits RoutingFallback when no routing rule matches', async () => {
    // 1. Spawn server (no routing rules added)
    // 2. dispatch_prompt { text: 'unmatched prompt' }
    // 3. Assert the response contains an error or null taskId indicating no match
  })
})
```

### Implementation notes

- Use `node:child_process.spawn` to start `node dist/main.js` (build the package first in the test setup with `beforeAll`).
- Use `node:readline` in the test to parse line-delimited JSON responses from the child's stdout.
- Use a helper `sendRequest(child, request): Promise<Response>` that writes the serialized request and returns a promise that resolves when the response with the matching `id` arrives.
- Set a 10-second `vitest` test timeout for I/O-bound tests.
- Use `afterEach` to `child.kill('SIGTERM')` and await the `'close'` event to avoid zombie processes.

### Definition of done

`pnpm --filter @my-pi/agent-orchestration-hub test` reports all tests passing (approximately 120 total). `pnpm --filter @my-pi/agent-orchestration-hub typecheck` exits 0. The e2e test exercises every bounded context and asserts both the happy path and two failure modes (no route match, service lost).

---

## Summary: Step-by-Step Checklist

| Step | Deliverable | Tests | Cumulative Count |
|---|---|---|---|
| 1 | Package scaffold | 1 | 1 |
| 2 | Event Bus | 8 | ~9 |
| 3 | Registry Context | 16 | ~25 |
| 4 | Task Context | 20 | ~45 |
| 5 | Execution Context | 12 | ~57 |
| 6 | Gating Context | 18 | ~75 |
| 7 | Dispatch Context | 12 | ~87 |
| 8 | Monitoring Context | 13 | ~100 |
| 9 | Server wrapper (stdio) | 15 | ~115 |
| 10 | End-to-end test | 3 | ~118 |

Each step ends with `typecheck clean + all tests green`. No step requires changes to previously green tests (additive only), enforcing the invariant that the codebase is always in a shippable state at the boundary of every step.
