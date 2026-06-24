# Handoff

## What was completed this session

**Step 2 — Event Bus** — `DomainEvent` base interface, `EventBus` port, `MittEventBus` (mitt-backed production adapter), `InMemoryEventBus` (synchronous test adapter) are all implemented. Events barrel updated. 8 tests pass; total package test count is 9.

---

## Completed Work

### Files created/modified

| File | What it contains |
|---|---|
| `packages/agent-orchestration-hub/src/lib/events/domain-event.ts` | `DomainEvent` interface: `readonly type: string`, `readonly occurredAt: Date` |
| `packages/agent-orchestration-hub/src/lib/events/event-bus.ts` | `EventBus` port: `emit(event)`, `on<E>(type, handler)`, `off<E>(type, handler)` |
| `packages/agent-orchestration-hub/src/lib/events/in-memory-event-bus.ts` | `InMemoryEventBus`: `Map<string, Set<handler>>`; synchronous dispatch; no runtime deps beyond `DomainEvent`/`EventBus` |
| `packages/agent-orchestration-hub/src/lib/events/mitt-event-bus.ts` | `MittEventBus`: only file in `lib/` that imports `mitt`; wraps `Emitter<Record<string, DomainEvent>>` |
| `packages/agent-orchestration-hub/src/lib/events/index.ts` | Re-exports `DomainEvent`, `EventBus`, `InMemoryEventBus`, `MittEventBus` |
| `packages/agent-orchestration-hub/test/unit/events/event-bus.test.ts` | 8 tests: 6 for `InMemoryEventBus`, 2 for `MittEventBus` |
| `packages/agent-orchestration-hub/tsconfig.json` | Added `"esModuleInterop": true` (see below) |

### Key design decisions

- **mitt NodeNext interop workaround** — mitt lacks `"type": "module"` so TypeScript 5.9 under NodeNext treats its `.d.ts` as CJS, making `import mitt from 'mitt'` resolve to the module namespace (not callable). Fixed with `import _mittFactory from 'mitt'` + `const createMitt = _mittFactory as unknown as MittFactory`. Added `esModuleInterop: true` to the package tsconfig; this alone was not sufficient but is kept for correctness.
- **`InMemoryEventBus` imports only `DomainEvent` and `EventBus`** — no runtime dep; safe to use in all tests.
- **Handler cast in `on`/`off`** — public API is generic `(event: E) => void`; internal map stores `(event: DomainEvent) => void`. Single cast at the `Set.add`/`Set.delete` call site is the only unsafe spot.

### Test counts

| File | Tests |
|---|---|
| `test/unit/scaffold.test.ts` | 1 |
| `test/unit/events/event-bus.test.ts` | 8 |
| **Total** | **9** |

`pnpm --filter @my-pi/agent-orchestration-hub typecheck` → exit 0  
`pnpm --filter @my-pi/agent-orchestration-hub test` → 9 passed

---

## Phase State

| Task | Status | Notes |
|---|---|---|
| Fix `anyOf`-at-root schema (delegate tool) | ✅ Done (prior session) | Flat `Type.Object` schema |
| Investigate parallel subagent hang | ✅ Done (prior session) | Two bugs identified |
| Fix Bug 1: add default `runTimeoutMs` | ✅ Done (prior session) | `config.ts`; 600 000 ms |
| Fix Bug 2: forward signal in `executeParallel` | ✅ Done (prior session) | `delegate-tool.ts`; rename + arg |
| Verify fixes with tests + live run | ✅ Done (prior session) | 69/69 pass; 2 live headless runs |
| Commit delegate fixes + design docs | ✅ Done (prior session) | `fce5be0` + `0d7848b` |
| Write implementation plan | ✅ Done (prior session) | 1,080-line doc; all 10 steps covered |
| Implement Step 1 — Package Scaffold | ✅ Done (prior session) | typecheck 0; 1/1 test passing |
| Implement Step 2 — Event Bus | ✅ Done this session | typecheck 0; 9/9 tests passing |
| Implement Step 3 — Registry Context | 🔜 Next | Unblocked |
| Implement Steps 4–10 | ⬜ Not started | Follow plan sequentially |

---

## Next Task

### Step 3 — Registry Context

**Source**: `docs/superpowers/specs/2026-06-23-agent-orchestration-hub-impl-plan.md` § "Step 3 — Registry Context"

**Goal**: Implement the Registry bounded context. This means: `ServiceId` branded type (nanoid factory), `ServiceType` and `ServiceStatus` enums, `Service` entity, three domain event interfaces (`ServiceRegistered`, `ServiceDeregistered`, `ServiceLost`), and the `ServiceRegistry` aggregate that emits those events via the `EventBus`. After this step services can register, heartbeat, deregister, and be declared lost.

---

#### Files to create/modify

| Path | What it contains |
|---|---|
| `packages/agent-orchestration-hub/src/lib/registry/service-id.ts` | `ServiceId` branded type; `createServiceId()` factory using `nanoid` |
| `packages/agent-orchestration-hub/src/lib/registry/service-type.ts` | `ServiceType` enum: `agent`, `db`, `webhook`, `ui` |
| `packages/agent-orchestration-hub/src/lib/registry/service-status.ts` | `ServiceStatus` enum: `active`, `disconnected`, `draining` |
| `packages/agent-orchestration-hub/src/lib/registry/service.ts` | `Service` entity interface: `serviceId`, `type`, `status`, `registeredAt`, `lastHeartbeatAt` |
| `packages/agent-orchestration-hub/src/lib/registry/registry-events.ts` | `ServiceRegistered`, `ServiceDeregistered`, `ServiceLost` — each extends `DomainEvent` |
| `packages/agent-orchestration-hub/src/lib/registry/service-registry.ts` | `ServiceRegistry` class (aggregate root); `ServiceRegistryOptions` interface |
| `packages/agent-orchestration-hub/src/lib/registry/index.ts` | Re-exports all of the above (replaces empty barrel) |
| `packages/agent-orchestration-hub/src/lib/events/domain-event.ts` | Add `DomainEventType` union `'service.registered' \| 'service.deregistered' \| 'service.lost'` |
| `packages/agent-orchestration-hub/test/unit/registry/service-registry.test.ts` | 14 tests across all `ServiceRegistry` methods |
| `packages/agent-orchestration-hub/test/unit/registry/service-id.test.ts` | 2 tests for `createServiceId` |

#### Read before coding

1. **`docs/superpowers/specs/2026-06-23-agent-orchestration-hub-impl-plan.md` § "Step 3"** — canonical type sketches, full test list, definition of done
2. **`packages/agent-orchestration-hub/src/lib/events/domain-event.ts`** — this is what you're extending with `DomainEventType`
3. **`packages/agent-orchestration-hub/src/lib/events/event-bus.ts`** — `EventBus` interface `ServiceRegistry` depends on
4. **`packages/agent-orchestration-hub/src/lib/registry/index.ts`** — currently empty barrel you're filling

#### Key constraints

- `ServiceRegistry` must accept `EventBus` via constructor injection — never import `MittEventBus` or `InMemoryEventBus` directly from registry code
- All intra-package imports need `.js` extensions (NodeNext module resolution)
- `createServiceId()` must use `nanoid` (already in `dependencies`) — not `crypto.randomUUID()`
- `checkForLostServices(nowMs)` takes a numeric timestamp arg (not `Date.now()`) so tests can control time deterministically
- `register()` must throw if the same `serviceId` is already in the map (not silently overwrite)
- `deregister()` and `heartbeat()` must throw if `serviceId` not found
- `checkForLostServices` must NOT emit `ServiceLost` for a service that is already `disconnected` (guards against duplicate events)

#### Suggested data shapes

```ts
// service-id.ts
declare const ServiceIdBrand: unique symbol
export type ServiceId = string & { readonly [ServiceIdBrand]: void }
export function createServiceId(): ServiceId

// service-type.ts
export enum ServiceType { agent = 'agent', db = 'db', webhook = 'webhook', ui = 'ui' }

// service-status.ts
export enum ServiceStatus { active = 'active', disconnected = 'disconnected', draining = 'draining' }

// service.ts
export interface Service {
  readonly serviceId: ServiceId
  readonly type: ServiceType
  status: ServiceStatus
  readonly registeredAt: Date
  lastHeartbeatAt: Date
}

// registry-events.ts
export interface ServiceRegistered extends DomainEvent {
  readonly type: 'service.registered'
  readonly serviceId: ServiceId
  readonly serviceType: ServiceType
}
export interface ServiceDeregistered extends DomainEvent {
  readonly type: 'service.deregistered'
  readonly serviceId: ServiceId
}
export interface ServiceLost extends DomainEvent {
  readonly type: 'service.lost'
  readonly serviceId: ServiceId
  readonly lastHeartbeatAt: Date
}

// service-registry.ts
export interface ServiceRegistryOptions {
  readonly heartbeatTimeoutMs: number  // default: 30_000
  readonly bus: EventBus
}
export class ServiceRegistry {
  constructor(options: ServiceRegistryOptions)
  register(serviceId: ServiceId, type: ServiceType): Service
  deregister(serviceId: ServiceId): void
  heartbeat(serviceId: ServiceId): void
  checkForLostServices(nowMs: number): void
  getById(serviceId: ServiceId): Service | undefined
  listByType(type: ServiceType): Service[]
  listAll(): Service[]
}
```

#### Tests to write

`test/unit/registry/service-registry.test.ts` — 14 tests:
```ts
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

Use `InMemoryEventBus` in all tests — it's synchronous and has no runtime deps.

`test/unit/registry/service-id.test.ts` — 2 tests:
```ts
describe('createServiceId', () => {
  it('returns a non-empty string')
  it('returns unique values on successive calls')
})
```

#### Definition of done

- `pnpm --filter @my-pi/agent-orchestration-hub typecheck` exits 0
- `pnpm --filter @my-pi/agent-orchestration-hub test` reports **25 passing tests** (9 existing + 16 new)
- No `any` on public `ServiceRegistry` method signatures
- `ServiceRegistry` imports `EventBus` interface only — not `InMemoryEventBus` or `MittEventBus`

#### What this task does NOT include

- Any subscribers to registry events — those come in later steps (Dispatch, Task contexts)
- Persistence or snapshot of registry state — deferred
- `draining` status transitions — `ServiceStatus.draining` exists but `ServiceRegistry` does not set it in Step 3
- Anything in `src/lib/dispatch/`, `src/lib/task/`, etc.

---

## Open Items

| # | Item | Status |
|---|---|---|
| 1 | stdio protocol format — JSON-RPC 2.0 vs line-delimited JSON? | Open — resolve before Step 9 (server wrapper) |
| 2 | Snapshot format — JSON vs YAML for state files? | Open — low priority; resolve before any persistence task |
| 3 | `onUpdate` forwarding in `executeParallel` → `executeSingle` | Open — delegate enhancement only, not blocking hub work |
| 4 | `agent: "default"` INVALID_PARAMS error message clarification | Open — doc/UX improvement, not blocking |
