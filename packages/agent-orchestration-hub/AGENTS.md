# AGENTS.md — agent-orchestration-hub

> Scoped guidance for AI agents working in `packages/agent-orchestration-hub/`. The root `AGENTS.md` applies here too; this file adds package-specific rules.

---

## Module layout

```
src/
  lib/              ← pure domain logic; NO I/O, NO server concerns
    events/         ← DomainEvent, EventBus, MittEventBus, InMemoryEventBus
    registry/       ← ServiceRegistry aggregate, Service, ServiceId, registry events
    dispatch/       ← (Step 4+) Dispatcher context
    task/           ← (Step 5+) Task context
    execution/      ← (Step 6+) Execution context
    gating/         ← (Step 7+) Gating context
    monitoring/     ← (Step 8+) Monitoring context
    index.ts        ← root barrel; re-exports all 7 contexts
  server/           ← stdio I/O layer (Step 9+); must not be imported by lib/
test/
  unit/             ← vitest unit tests; mirrors src/lib/ structure
  integration/      ← integration tests (future)
```

**`src/lib/` must never import from `src/server/`.** The lib layer is pure domain logic; the server layer is the I/O adapter that wraps it. Any violation of this boundary reverses the dependency and makes the domain untestable in isolation.

---

## NodeNext module resolution

This package uses `"module": "NodeNext"` + `"moduleResolution": "NodeNext"` in `tsconfig.json`. This is intentional (it will run as a standalone Node.js stdio server). Consequence: **all intra-package imports must use `.js` extensions**, even though the source files are `.ts`:

```ts
// correct
import { EventBus } from './event-bus.js'
import { InMemoryEventBus } from '../events/index.js'

// wrong — NodeNext will fail to resolve
import { EventBus } from './event-bus'
import { InMemoryEventBus } from '../events/index'
```

The barrel files (`index.ts`) re-export with `.js` extensions for the same reason.

---

## mitt import workaround

mitt lacks `"type": "module"` in its `package.json`, so TypeScript 5.x with NodeNext treats its `.d.ts` as CJS and resolves `import mitt from 'mitt'` to the module namespace (not callable). The fix in `mitt-event-bus.ts` uses a type cast:

```ts
import _mittFactory from 'mitt'
type MittFactory = <E extends Record<string, unknown>>() => Emitter<E>
const createMitt = _mittFactory as unknown as MittFactory
```

**Do not simplify or remove this cast.** It is the only way to call `mitt()` under NodeNext without TypeScript errors. The comment in the file explains why. The `esModuleInterop: true` in `tsconfig.json` is related but alone insufficient.

---

## EventBus rules

- **`MittEventBus`** is the production adapter. It is the **only** file in `src/lib/` allowed to import `mitt`.
- **`InMemoryEventBus`** is the test adapter. It must import **nothing** outside `./domain-event.js` and `./event-bus.js`. Use it in **all unit tests** — never use `MittEventBus` in tests.
- Handlers are stored internally as `(e: DomainEvent) => void`. The single cast at `Set.add`/`Set.delete` is intentional. Do not add more casts elsewhere.

---

## Domain context conventions

### ServiceRegistry (Step 3+)

- `ServiceRegistry` takes an `EventBus` via constructor — never import `MittEventBus` or `InMemoryEventBus` from registry code (dependency inversion).
- `checkForLostServices(nowMs: number)` accepts a numeric millisecond timestamp, **not** `Date.now()`. This lets tests control time without faking globals.
- `createServiceId()` uses `nanoid` (already in `dependencies`). Do **not** use `crypto.randomUUID()`.
- `checkForLostServices` must not emit `ServiceLost` for a service already in `disconnected` status — guards against duplicate events.

### Time control in tests

Never call `Date.now()` directly inside domain logic that needs to be time-controlled in tests. Pass `nowMs` as a parameter instead, as established in `checkForLostServices`.

---

## Testing

Run: `pnpm --filter @my-pi/agent-orchestration-hub test`  
Typecheck: `pnpm --filter @my-pi/agent-orchestration-hub typecheck`

Always use `InMemoryEventBus` in tests. Tests go in `test/unit/<context>/` mirroring the `src/lib/<context>/` structure.

When writing event-assertion tests, check `handler` calls via `vi.fn()` — don't use the event bus's internal state directly.

---

## Implementation status

Steps 1–2 complete (scaffold + Event Bus). Steps 3–10 not yet started. See `handoff.md` and `docs/superpowers/specs/2026-06-23-agent-orchestration-hub-impl-plan.md` for the build sequence.
