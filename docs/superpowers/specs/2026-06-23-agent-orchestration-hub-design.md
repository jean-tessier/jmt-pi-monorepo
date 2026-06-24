# Agent Orchestration Hub — Design Spec

**Date**: 2026-06-23
**Status**: Draft

## Overview

A local-only, deterministic, token-free orchestration server for the Pi coding agent
ecosystem. Agents, humans, and services all connect to a single hub. The hub is built
**library-first** (pure deterministic logic, no I/O) with a thin transport wrapper for
server functionality.

The core design principle: **save tokens where you want, increase determinism as you see
fit.** LLM calls happen only where explicitly opted in (e.g., a router agent). Everything
else—dispatch, gating, task tracking, state transitions—is deterministic and free.

All documents for this project adhere to **Domain-Driven Design (DDD)** principles. This
spec establishes the bounded contexts, ubiquitous language, and architectural backbone.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Clients                            │
│  (TUI / Agent client / Service client / HTTP)        │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
              ┌─────────────────┐
              │  Server Wrapper  │  (transport: stdio / HTTP)
              └────────┬────────┘
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
   ┌──────────┐ ┌──────────┐ ┌──────────────┐
   │ Dispatch │ │  Task    │ │  Monitoring  │
   │ Context  │ │  Context │ │  Context     │
   └────┬─────┘ └────┬─────┘ └──────┬───────┘
        │            │               │
        └────────────┼───────────────┘
                     ▼
            ┌──────────────┐
            │  Domain Event │
            │     Bus       │
            └──────┬───────┘
                   │
        ┌──────────┼──────────┐
        ▼          ▼          ▼
  ┌─────────┐ ┌────────┐ ┌─────────┐
  │Registry │ │Execution│ │ Gating  │
  │Context  │ │Context  │ │ Context  │
  └─────────┘ └────────┘ └─────────┘
```

- **Domain Library** (`lib/`): All orchestration logic. No I/O, no LLM calls.
  Fully deterministic, fully testable.
- **Server Wrapper** (`server/`): Thin transport layer over the library. stdio for
  Pi integration; HTTP optional for future UIs. Handles serialization, client
  connections, and dispatch of requests to library functions.
- **Clients**: External and swappable. They speak the server's protocol but never
  import its internals.

---

## Bounded Contexts

### 1. Registry Context

**Ubiquitous Language**: *Service*, *Service Type*, *Capability*, *Registration*.

All external actors (agents, DBs, webhooks, UIs) are modeled uniformly as **services**.
Adding a new integration type is declarative—define a service type with its schema.

| Concept | Kind | Description |
|---------|------|-------------|
| `ServiceRegistry` | Aggregate Root | Tracks all registered services; enforces uniqueness by `serviceId`. |
| `Service` | Entity | Has `serviceId`, `type`, `capabilities`, `status`. |
| `ServiceId` | Value Object | Opaque service identifier. |
| `ServiceType` | Value Object | Enum: `agent`, `db`, `webhook`, `ui`. |
| `Capability` | Value Object | Declared ability (e.g., `"code_review"`, `"deploy"`). |
| `ServiceStatus` | Value Object | Enum: `active`, `disconnected`, `draining`. |

**Domain Events**:
- `ServiceRegistered` — a new service joined.
- `ServiceDeregistered` — a service gracefully left.
- `ServiceLost` — service became unresponsive (detected by heartbeat/timeout).

---

### 2. Dispatch Context

**Ubiquitous Language**: *Dispatch*, *Route*, *Prompt*, *Pattern*, *Routing Rule*.

Determines which agent handles a prompt. Supports two modes, configurable per pattern:

| Mode | Behavior | Token Cost |
|------|----------|------------|
| **Deterministic** | `RoutingRule` maps a prompt regex/pattern → target agent. | Free |
| **Agent-based** | Prompt goes to a *router agent*; it decides which specialized agent to dispatch. | Explicit opt-in |

| Concept | Kind | Description |
|---------|------|-------------|
| `DispatchRouter` | Aggregate Root | Holds routing rules and dispatches prompts. |
| `Prompt` | Value Object | The incoming request text. |
| `RoutingRule` | Value Object | `{ pattern: Regex, targetAgentId: ServiceId }`. |
| `AgentRoutingDecision` | Value Object | A router agent's choice of target agent. |

**Domain Events**:
- `PromptRouted` — prompt dispatched to a target agent (includes routing mode used).
- `RoutingFallback` — no rule matched and no router agent configured; prompt queued or rejected.

---

### 3. Task Context

**Ubiquitous Language**: *Task*, *Execution Plan*, *Subtask*, *Progress*, *Outcome*.

The heart of orchestration. A **task** is a well-defined execution plan composed of
ordered **subtasks**. Tasks are dispatched to subagents for execution. All state
transitions are deterministic.

| Concept | Kind | Description |
|---------|------|-------------|
| `Task` | Aggregate Root | Consistency boundary for a unit of execution. |
| `Subtask` | Entity | Identity within parent task (`sequence`, `status`, `result`). |
| `TaskId` | Value Object | Opaque task identifier. |
| `TaskStatus` | Value Object | Enum: `pending`, `dispatched`, `running`, `completed`, `failed`, `blocked`. |
| `ExecutionPlan` | Value Object | Full set of subtasks + dependencies + gate references. |
| `Progress` | Value Object | `{ completed: N, total: N }` ratio. |
| `SubtaskSequence` | Value Object | Monotonically increasing position within task. |

**Invariants**:
- A task cannot be dispatched unless its pre-conditions (gates) are satisfied.
- A task cannot be `completed` unless all required subtasks are `completed` (or explicitly skipped).
- Subtask sequence must be monotonically increasing.

**Domain Events**:
- `TaskCreated`
- `TaskDispatched`
- `TaskRunning`
- `TaskCompleted`
- `TaskFailed`
- `TaskBlocked`
- `SubtaskCompleted`
- `SubtaskFailed`

---

### 4. Execution Context

**Ubiquitous Language**: *Subagent*, *Assignment*, *Execution*, *Heartbeat*.

A **subagent** is the *executor* assigned to a task. It is not the task itself—it is
the worker that runs the plan. A subagent may execute multiple subtasks.

| Concept | Kind | Description |
|---------|------|-------------|
| `Subagent` | Aggregate Root | Represents a running worker bound to a task. |
| `SubagentId` | Value Object | Opaque subagent identifier. |
| `Assignment` | Value Object | `{ taskId, subagentId, assignedAt }`. |
| `ExecutionStatus` | Value Object | Enum: `idle`, `executing`, `stalled`, `completed`. |
| `Heartbeat` | Value Object | Timestamped signal from subagent. |

**Domain Events**:
- `SubagentAssigned`
- `SubagentStarted`
- `SubagentProgress` — includes subtask-level progress.
- `SubagentCompleted`
- `SubagentFailed`
- `SubagentTimeout` — heartbeat exceeded threshold.

---

### 5. Gating Context

**Ubiquitous Language**: *Gate*, *Pre-condition*, *Post-condition*, *Dependency*, *Condition*, *Policy*, *Signal*.

Gates are deterministic synchronization points. They evaluate composable conditions
against service state and task state. Tasks reference gates as pre-conditions
(before dispatch) and post-conditions (after completion).

| Concept | Kind | Description |
|---------|------|-------------|
| `Gate` | Aggregate Root | Named synchronization point with policy. |
| `Condition` | Entity | Single evaluable rule within a gate. |
| `GateId` | Value Object | Opaque gate identifier. |
| `ConditionExpression` | Value Object | Evaluable expression (e.g., `task:X.status == completed`, `db:Y.query(...)`). |
| `GatePolicy` | Value Object | Enum: `all_of`, `any_of`, `exactly_N`. |
| `DependencySpec` | Value Object | Set of task IDs that must complete. |
| `GateState` | Value Object | Enum: `open`, `closed`, `opening`, `failed`. |

**Composition**:
- Pre-condition: gate must be `open` before task dispatches.
- Post-condition: the `TaskCompleted` event (from the Task Context) is subscribed to by the gate, which evaluates and transitions to `open` if conditions are satisfied.
- Dependency: a gate subscribes to events from a set of tasks and evaluates once the `DependencySpec` is satisfied (per `GatePolicy`).

**Domain Events**:
- `GateOpened`
- `GateClosed`
- `GateEvaluationFailed`

---

### 6. Event Bus (Cross-Cutting)

All contexts communicate **only** through domain events. The event bus is the single
coupling mechanism:

- Contexts **publish** events.
- Contexts **subscribe** to events they care about.
- No context directly calls another context's aggregates.

This keeps each context independently testable and allows adding new subscribers
without modifying publishers.

---

### 7. Monitoring Context

**Ubiquitous Language**: *Snapshot*, *Query*, *Watch*, *Filter*, *Projection*.

Monitoring is the **CQRS read side**. It does not mutate domain state—it projects it.

| Concept | Kind | Description |
|---------|------|-------------|
| `TaskSnapshot` | Read Model | Current state, progress, assigned subagent, gate status. |
| `SubagentSnapshot` | Read Model | Current task, execution status, last heartbeat. |
| `SubtaskSnapshot` | Read Model | Status, sequence, result within parent task. |
| `EventFilter` | Value Object | Filter by type, time range, task/agent ID. |
| `TimeRange` | Value Object | Bounded window for history queries. |

**Operations**:
- `GetTaskStatus(taskId)` — single task snapshot.
- `ListTasks(filter)` — filtered task list.
- `ListSubagents()` — all active subagents.
- `WatchEvents(filter)` — subscribe to real-time event stream.
- `GetRecentHistory(taskId, limit)` — bounded event log for a task.

All monitoring queries read from the **current state snapshot** (fast) or the
**bounded event log** (recent history). Neither goes through the domain aggregates.

---

## State & Persistence

| Concern | Strategy |
|---------|----------|
| Current state | In-memory snapshot for fast reads. |
| History | Bounded event log. Configurable retention (default: last 1000 events or 24h). Auto-pruned. |
| Crash recovery | State serialized to disk. On restart, load snapshot + replay bounded log. |

**Repositories** (ports—interfaces only, implementations provided by the server):

| Repository | Aggregate |
|------------|-----------|
| `TaskRepository` | `Task` |
| `ServiceRepository` | `ServiceRegistry` |
| `GateRepository` | `Gate` |
| `EventStore` | Domain events (append + bounded read) |

Persistence implementation for MVP: file-based. Swappable for future alternatives.

---

## Client Categories

| Client Type | Examples | Interaction Pattern |
|-------------|----------|---------------------|
| **Agent** | Pi subagents | Dispatch tasks, report progress, query status. |
| **Human** | TUI, future web UI | Submit prompts, monitor progress, approve gates. |
| **Service** | DBs, CI pipelines, webhooks | Register as gate condition sources, emit events, provide data. |

All clients speak the same protocol. The server does not differentiate behavior
by client type—it only authenticates via service registration.

---

## Error Handling

| Scenario | Response |
|----------|----------|
| Service disconnects | Tasks assigned to it marked `blocked`; `ServiceLost` event emitted. |
| Gate timeout | Task marked `stale`; configurable retry policy or alert via event. |
| Crash | Reload from disk snapshot + replay bounded log. |
| No route matches prompt | `RoutingFallback` event emitted; prompt queued or rejected per config. |
| Subagent timeout (heartbeat) | `SubagentTimeout` event emitted; task marked `blocked`. |
| Gate evaluation fails | `GateEvaluationFailed` event; task remains gated. |

---

## Testing Strategy

| Layer | Approach |
|-------|----------|
| Domain logic | Pure unit tests. No I/O, no mocks needed for domain rules. |
| Event bus | Test event publication and subscription ordering. |
| Server wrapper | Integration tests: transport serialization, request routing. |
| End-to-end | Spin up server, register services, dispatch tasks, assert event stream and final state. |

---

## Open Questions

1. **Router agent interface** — What protocol does a router agent use to communicate
   its routing decision back to the hub? (Likely a structured output schema.)
2. **Prompt format** — Does the hub enforce a prompt schema, or is it free-text with
   optional metadata?
3. **Concurrency model** — Single-threaded event loop (Node.js default) vs.
   explicit task queue with parallelism controls?
4. **Human approval gates** — Should the hub support "pause and wait for human
   confirmation" as a built-in gate type, or is that handled externally?

---

## Next Steps

1. Resolve open questions above.
2. Define MVP feature set by grading: **must have**, **nice to have**, **now now**, **won't do**.
3. Create implementation plan with task breakdown per bounded context.
