# Agent Orchestration Hub — MVP Feature Grading

**Date**: 2026-06-23
**Status**: Analysis

## Grading Criteria

| Grade        | Meaning                                                        |
| ------------ | ------------------------------------------------------------- |
| **Must have** | MVP without this fails — the system cannot function.         |
| **Nice to have** | Can ship without it in v1; adds polish or completeness.    |
| **Now now**  | Important but needs to come after MVP (v1.5–v2).              |
| **Won't do**  | Explicitly out of scope for the foreseeable future.           |

## Key Constraints (Reminders)

- **Local-only, deterministic, token-free** orchestration server.
- **Library-first**: pure deterministic logic, no I/O in domain layer.
- Wraps the existing `pi-delegate` package into a coordination layer.
- LLM calls only for router agent (explicit opt-in).
- The thinnest slice that demonstrates the architecture.

---

## 1. Registry Context

| Feature / Concept       | Grade        | Rationale                                                                                     |
| ----------------------- | ------------ | --------------------------------------------------------------------------------------------- |
| `ServiceRegistry`       | Must have    | Core discovery mechanism — nothing can dispatch without knowing what agents/services exist.   |
| `Service` entity        | Must have    | Must be able to represent an actor in the system.                                             |
| `ServiceId`             | Must have    | Needed to reference services in routing rules, assignments, and events.                        |
| `ServiceType`           | Must have    | Distinguishes agents from other service types — required for routing decisions.                |
| `Capability`            | Nice to have | Useful for advanced routing but MVP can dispatch by ID alone.                                 |
| `ServiceStatus`         | Must have    | Must track `active` vs `disconnected` to handle failures.                                     |
| `ServiceRegistered` evt | Must have    | Other contexts (Dispatch, Execution) need to react to new services joining.                    |
| `ServiceDeregistered`   | Must have    | Graceful shutdown / cleanup of assignments.                                                    |
| `ServiceLost`           | Must have    | Failure detection — without this, blocked tasks would never be identified.                     |
| Heartbeat mechanism     | Must have    | Required to detect `ServiceLost`.                                                             |

**MVP scope**: Services can register, deregister, heartbeat, and be queried by type/ID. Capability-based filtering is deferred.

---

## 2. Dispatch Context

| Feature / Concept          | Grade        | Rationale                                                                                  |
| -------------------------- | ------------ | ------------------------------------------------------------------------------------------ |
| `DispatchRouter`           | Must have    | The entry point for all incoming prompts — without this, nothing reaches an agent.         |
| `Prompt` value object      | Must have    | Must accept incoming requests.                                                             |
| `RoutingRule`              | Must have    | Deterministic routing is the zero-token default and the primary MVP mode.                   |
| Regex/pattern matching     | Must have    | Core mechanism for deterministic routing.                                                   |
| `AgentRoutingDecision`     | Won't do     | Requires a router agent (LLM call). Explicitly deferred — token cost, non-deterministic.    |
| Router agent (LLM-based)   | Won't do     | Explicit opt-in, requires LLM integration. Out of scope for MVP.                            |
| `PromptRouted` event       | Must have    | Task context needs to know a prompt was dispatched.                                        |
| `RoutingFallback` event    | Nice to have | Useful for observability but MVP can default to a simple reject/queue without event.       |
| Per-pattern mode config    | Nice to have | Not needed when only deterministic routing exists.                                        |

**MVP scope**: Deterministic routing only. A prompt comes in, matches a regex pattern, and is dispatched to the target agent. No LLM router.

---

## 3. Task Context

| Feature / Concept       | Grade        | Rationale                                                                                     |
| ----------------------- | ------------ | --------------------------------------------------------------------------------------------- |
| `Task` aggregate        | Must have    | The central concept — without tasks, there is nothing to orchestrate.                         |
| `Subtask` entity         | Must have    | Tasks must decompose into steps; this is the unit of execution.                               |
| `TaskId`                | Must have    | Needed to reference tasks from any context.                                                   |
| `TaskStatus`            | Must have    | Must track lifecycle: pending → dispatched → running → completed/failed/blocked.              |
| `ExecutionPlan`         | Must have    | Defines what a task is — the ordered subtasks and their structure.                            |
| `Progress`              | Nice to have | Convenient for monitoring but can be computed from subtask states.                            |
| `SubtaskSequence`       | Must have    | Ordering is fundamental to execution semantics.                                               |
| Task invariants         | Must have    | Cannot complete a task with incomplete subtasks; cannot dispatch with unsatisfied gates.      |
| `TaskCreated` event     | Must have    | Gates and monitoring need to react to new tasks.                                              |
| `TaskDispatched` event  | Must have    | Execution context needs to know a task is ready for pickup.                                   |
| `TaskRunning` event     | Nice to have | Observability enhancement; can be inferred from SubagentStarted.                              |
| `TaskCompleted` event   | Must have    | Gates subscribe to this — it's the primary trigger for post-condition evaluation.            |
| `TaskFailed` event      | Must have    | Gates and monitoring need to react to failures.                                               |
| `TaskBlocked` event     | Must have    | Critical for failure handling when services go down.                                         |
| `SubtaskCompleted` event | Must have    | Drives progress tracking and gate evaluation.                                                 |
| `SubtaskFailed` event    | Must have    | Drives task failure propagation.                                                              |

**MVP scope**: Full task lifecycle with subtasks, invariants, and all domain events. This is the heart of the system and must be complete.

---

## 4. Execution Context

| Feature / Concept          | Grade        | Rationale                                                                                  |
| -------------------------- | ------------ | ------------------------------------------------------------------------------------------ |
| `Subagent` aggregate        | Must have    | Must represent a running worker to track its state and assignments.                         |
| `SubagentId`               | Must have    | Needed to reference subagents from tasks and events.                                        |
| `Assignment`               | Must have    | Links a subagent to a task — without this, no work can be done.                             |
| `ExecutionStatus`          | Must have    | Must track idle → executing → completed/stalled.                                            |
| `Heartbeat`                | Must have    | Required for timeout detection.                                                             |
| `SubagentAssigned` event    | Must have    | Task context needs to know its task was picked up.                                          |
| `SubagentStarted` event     | Must have    | Monitoring and task status need to transition.                                              |
| `SubagentProgress` event   | Nice to have | Useful for real-time monitoring but can be derived from subtask events.                     |
| `SubagentCompleted` event   | Must have    | Triggers task completion evaluation.                                                        |
| `SubagentFailed` event     | Must have    | Triggers task failure and potential retry.                                                  |
| `SubagentTimeout` event    | Must have    | Critical failure path — heartbeat exceeded threshold.                                       |

**MVP scope**: Full subagent lifecycle with heartbeat-based timeout detection. Progress event is a nice-to-have.

---

## 5. Gating Context

| Feature / Concept          | Grade        | Rationale                                                                                  |
| -------------------------- | ------------ | ------------------------------------------------------------------------------------------ |
| `Gate` aggregate           | Must have    | Synchronization is a core value proposition — "increase determinism as you see fit."         |
| `Condition` entity         | Must have    | Gates must evaluate something — conditions are the building blocks.                         |
| `GateId`                   | Must have    | Needed to reference gates from tasks and events.                                            |
| `ConditionExpression`      | Must have    | Must be able to evaluate expressions like `task:X.status == completed`.                    |
| `GatePolicy` (`all_of`)    | Must have    | Minimum viable policy — all conditions must pass.                                          |
| `GatePolicy` (`any_of`)    | Nice to have | Useful but not required for MVP.                                                           |
| `GatePolicy` (`exactly_N`) | Now now     | Advanced composition — defer to post-MVP.                                                  |
| `DependencySpec`           | Must have    | Gates must know which tasks to wait on.                                                    |
| `GateState`                | Must have    | Must track open/closed/opening/failed.                                                      |
| Pre-condition gates        | Must have    | Cannot dispatch a task until gates are open — core invariant.                               |
| Post-condition gates       | Must have    | Tasks opening gates on completion — closes the loop.                                        |
| `GateOpened` event         | Must have    | Triggers task dispatch for gated tasks.                                                     |
| `GateClosed` event         | Nice to have | Observability; can be inferred from state.                                                 |
| `GateEvaluationFailed`     | Must have    | Must surface evaluation errors without crashing.                                             |
| Human approval gates       | Won't do     | Explicitly deferred — handled externally in MVP.                                            |
| Gate timeout               | Now now     | Important for liveness but can be handled by heartbeat + SubagentTimeout in MVP.           |

**MVP scope**: Pre/post condition gates with `all_of` policy and task-status-based conditions. The gate lifecycle is complete. Advanced policies and human approval are deferred.

---

## 6. Event Bus (Cross-Cutting)

| Feature / Concept          | Grade        | Rationale                                                                                  |
| -------------------------- | ------------ | ------------------------------------------------------------------------------------------ |
| Publish/subscribe          | Must have    | The single coupling mechanism — all contexts communicate only through events.               |
| In-process event bus       | Must have    | MVP is local-only; no need for distributed messaging.                                       |
| Event ordering guarantee   | Must have    | Critical for correct state transitions (e.g., gate opens before task dispatches).            |
| Distributed event bus      | Won't do     | Out of scope — local-only constraint.                                                       |
| Event replay               | Nice to have | Useful for crash recovery but MVP can restart from clean state.                             |
| Dead-letter handling       | Now now     | Important for production robustness but not needed for MVP.                                |

**MVP scope**: In-process pub/sub with ordering guarantees. Everything else is deferred.

---

## 7. Monitoring Context

| Feature / Concept          | Grade        | Rationale                                                                                  |
| -------------------------- | ------------ | ------------------------------------------------------------------------------------------ |
| `TaskSnapshot`             | Must have    | Humans and clients need to query task status — this is the primary read model.              |
| `SubagentSnapshot`          | Nice to have | Useful for dashboard but can be derived from task + subagent state.                        |
| `SubtaskSnapshot`           | Nice to have | Same as above — derivable from task state.                                                 |
| `GetTaskStatus(taskId)`    | Must have    | Minimum viable query — a client must be able to ask "how is my task doing?"                 |
| `ListTasks(filter)`        | Must have    | Must be able to see all tasks and filter by status.                                        |
| `ListSubagents()`          | Nice to have | Observability; not required for core functionality.                                        |
| `WatchEvents(filter)`      | Now now     | Real-time streaming is important for UX but not required for MVP.                          |
| `GetRecentHistory`         | Now now     | Useful for debugging but not required for MVP.                                             |
| `EventFilter`              | Nice to have | Only needed once WatchEvents or advanced listing is built.                                  |
| `TimeRange`                | Now now     | Only needed for history queries.                                                           |

**MVP scope**: Query task status and list tasks. That's it — the thinnest useful read side.

---

## Infrastructure / Cross-Cutting Concerns

| Feature / Concept               | Grade        | Rationale                                                                                  |
| ------------------------------- | ------------ | ------------------------------------------------------------------------------------------ |
| File-based persistence          | Nice to have | MVP can run purely in-memory; persistence is a nice-to-have for crash recovery.       |
| Crash recovery (snapshot+replay)| Now now     | Important for production but not needed for initial demo.                                  |
| Server wrapper (stdio)          | Must have    | Must be reachable — stdio is the Pi integration path.                                      |
| Server wrapper (HTTP)           | Nice to have | Useful for future UIs but not required for MVP.                                             |
| Client protocol (JSON-based)    | Must have    | Clients need a structured way to communicate with the server.                              |
| Service authentication          | Won't do     | Local-only, token-free — no auth needed.                                                   |
| Concurrency: single-threaded    | Must have    | Node.js default; sufficient for MVP determinism.                                            |
| Concurrency: parallel queue     | Now now     | Post-MVP optimization.                                                                     |

---

## Summary: What the MVP Enables

### The Thinnest Viable Slice

A user can:

1. **Register agents** (services) with the hub via stdio.
2. **Submit a prompt** that matches a routing rule and gets dispatched to a registered agent.
3. **Track the task** as it moves through its lifecycle: pending → dispatched → running → completed/failed/blocked.
4. **Define gates** that prevent task dispatch until pre-conditions are met (e.g., another task completed), and that open automatically when post-conditions are satisfied.
5. **Detect failures** — if a service disconnects, its tasks are marked blocked; if a subagent times out, the task is marked failed.
6. **Query task status** — ask the hub "what's happening with my task?" and get a snapshot.

### What the MVP Does NOT Include

- LLM-based routing (router agent)
- Capability-based service discovery
- Human approval gates
- Real-time event streaming / watch
- HTTP transport
- Persistent storage / crash recovery
- Advanced gate policies (`any_of`, `exactly_N`)
- Subagent progress reporting
- Distributed operation

### The MVP User Story

> *"I register my Pi subagent with the hub. I send a prompt that matches a routing rule. The hub creates a task, checks that its pre-conditions are met, dispatches it to my agent, and tracks completion. When done, any post-condition gates open, triggering downstream tasks. I can query the task status at any time."*

This demonstrates the full architecture: Registry → Dispatch → Task → Execution → Gating → Event Bus → Monitoring. Every bounded context is represented with its minimum viable surface area.
