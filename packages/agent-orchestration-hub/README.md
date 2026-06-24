# agent-orchestration-hub

> Pi extension: coordinate multi-agent workflows via typed domain events.

**Status: work in progress — not yet usable.**

`agent-orchestration-hub` is a Node.js stdio server that acts as an orchestration hub between Pi agents. Agents register with the hub, submit tasks, and receive results through a typed domain event bus. The hub manages task lifecycle, dispatch, execution gating, and monitoring across concurrent agent workflows.

Design spec: [`docs/superpowers/specs/2026-06-23-agent-orchestration-hub-design.md`](../../docs/superpowers/specs/2026-06-23-agent-orchestration-hub-design.md)

## Domain contexts

| Context | Description |
|---------|-------------|
| **Events** | Core `DomainEvent` type and `EventBus` abstraction; `MittEventBus` and `InMemoryEventBus` implementations. |
| **Registry** | Tracks which agents are currently registered and their declared capabilities. |
| **Dispatch** | Routes incoming tasks to the appropriate registered agent based on capability matching. |
| **Task** | Models the lifecycle of a unit of work from submission through completion or failure. |
| **Execution** | Manages the actual invocation of an agent and captures its output. |
| **Gating** | Enforces concurrency limits, depth guards, and other admission controls before execution. |
| **Monitoring** | Observes task and event activity; surfaces health, throughput, and error metrics. |

## Implementation progress

- Step 1 — package scaffold: complete
- Step 2 — Event Bus (`DomainEvent`, `EventBus`, `MittEventBus`, `InMemoryEventBus`): complete
- Steps 3–10: not yet started

## Development

Type-check:

```bash
pnpm --filter @my-pi/agent-orchestration-hub typecheck
```

Run tests:

```bash
pnpm --filter @my-pi/agent-orchestration-hub test
```
