# Handoff

## What was completed this session

**Phase 1 — pi-delegate bug fixes (complete)**
Both root-cause bugs patched, 69 tests green, live headless verification done (prior session recorded in detail below).

**Phase 2 — Agent Orchestration Hub design (in progress)**
Three design documents written; implementation has not started.

---

## Completed Work

### pi-delegate bug fixes

| File | What changed |
|---|---|
| `packages/pi-delegate/src/parent/config.ts` | Added `runTimeoutMs: 600_000` to the default `config` object in `loadConfig()` |
| `packages/pi-delegate/src/parent/delegate-tool.ts` | In `executeParallel`'s `runOne` callback: renamed `_signal` → `signal`; passed it as 3rd arg to `executeSingle` |
| `packages/pi-delegate/test/conformance/parallel.test.ts` | Added `vi.mock` for `spawn.js`; `loadConfig defaults` describe block; `executeParallel signal forwarding` describe block |

**Test counts**: 66 → 69. `pnpm -F pi-delegate test`: 69/69 pass.
**Live verification**: Two headless runs on `openrouter/owl-alpha` (2m37s and 3m13s); no hang, no error.

**Note**: These changes are uncommitted (`git status` shows them as modified). Commit before continuing.

---

### Agent Orchestration Hub design documents

| File | What it contains |
|---|---|
| `docs/superpowers/specs/2026-06-23-agent-orchestration-hub-design.md` | Full DDD architecture: 6 bounded contexts, ubiquitous language, domain events, state/persistence strategy, open questions, next steps |
| `docs/superpowers/specs/2026-06-23-agent-orchestration-hub-mvp-grading.md` | Feature grading (Must have / Nice to have / Now now / Won't do) for every concept in all 6 bounded contexts; MVP summary user story |
| `docs/superpowers/specs/2026-06-23-agent-orchestration-hub-tech-stack.md` | Research + recommendations: mitt (event bus), nanoid (IDs), typebox (keep), vitest (keep), raw fs (persistence), no HTTP for MVP; CVE-checked, 2 new runtime deps |

These files are untracked — also need to be committed.

---

## Phase State

| Task | Status | Notes |
|---|---|---|
| Fix `anyOf`-at-root schema (delegate tool) | ✅ Done | Flat `Type.Object` schema; prior session |
| Investigate parallel subagent hang | ✅ Done | Two bugs identified and pinned; prior session |
| Fix Bug 1: add default `runTimeoutMs` | ✅ Done | `config.ts`; 600 000 ms default |
| Fix Bug 2: forward signal in `executeParallel` | ✅ Done | `delegate-tool.ts:332`; one rename + one arg |
| Verify fixes with tests + live run | ✅ Done | 69/69 pass; 2 live headless runs |
| Commit all pending changes | 🔜 Next (trivial) | Delegate fixes + all three design docs |
| Define project directory structure | 🔜 Next | Tech stack doc has packages, not directory layout |
| Write implementation plan (task breakdown) | 🔜 Next | Per bounded context; this is Step 5 in the design spec |
| Implement Agent Orchestration Hub package | ⬜ Not started | Blocked on implementation plan |

---

## Next Task

### Commit pending changes + write the implementation plan

**Source**: Design spec "Next Steps" §4–5; this is the last planning step before implementation.

**Goal**: Get all pending work committed, then produce the implementation plan document that breaks the Agent Orchestration Hub into concrete, sequenced coding tasks — one per bounded context. The plan is what the next session uses to start writing code.

---

#### Step 0: Commit pending changes

Run these two commits (in order):

```bash
# 1 — delegate bug fixes
git add packages/pi-delegate/src/parent/config.ts \
        packages/pi-delegate/src/parent/delegate-tool.ts \
        packages/pi-delegate/test/conformance/parallel.test.ts
git commit -m "fix(delegate): add default runTimeoutMs; forward signal in executeParallel"

# 2 — design docs (including updated design spec and new grading + tech-stack docs)
git add docs/superpowers/specs/ .agents/ handoff.md
git rm interrupted.md   # deleted in working tree
git commit -m "docs: add agent orchestration hub MVP grading and tech stack research"
```

---

#### Step 1: Define project directory structure

The tech-stack doc covers *what* packages to use but not *where files live*. Define the layout for `packages/agent-orchestration-hub/` before writing the implementation plan.

Proposed layout (confirm before writing the plan):

```
packages/agent-orchestration-hub/
  src/
    lib/                  ← domain library (no I/O)
      registry/           ← Registry Context
      dispatch/           ← Dispatch Context
      task/               ← Task Context
      execution/          ← Execution Context
      gating/             ← Gating Context
      events/             ← EventBus port interface + mitt adapter
      monitoring/         ← Monitoring Context (CQRS read side)
    server/               ← transport wrapper (stdio)
  test/
    unit/                 ← pure domain logic tests
    integration/          ← server wrapper tests
  package.json
  tsconfig.json
```

---

#### Step 2: Write the implementation plan

Create `docs/superpowers/specs/2026-06-23-agent-orchestration-hub-impl-plan.md`.

The plan must cover:

1. **Package scaffold** — `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/` skeleton
2. **Event Bus** — `EventBus` port interface; mitt adapter; domain event base type
3. **Registry Context** — `ServiceRegistry` aggregate, `Service` entity, `ServiceId`/`ServiceType`/`ServiceStatus` VOs, `ServiceRegistered`/`ServiceDeregistered`/`ServiceLost` events, heartbeat detection
4. **Task Context** — `Task` aggregate, `Subtask` entity, all value objects, all domain events, invariants
5. **Execution Context** — `Subagent` aggregate, `Assignment`, `Heartbeat`, all domain events
6. **Gating Context** — `Gate` aggregate, `Condition` entity, `GatePolicy` (all_of for MVP), pre/post condition wiring, all domain events
7. **Dispatch Context** — `DispatchRouter`, `RoutingRule` (regex → agent), `Prompt` VO, `PromptRouted` event
8. **Monitoring Context** — `TaskSnapshot`, `GetTaskStatus`, `ListTasks` (CQRS read side, no aggregates)
9. **Server wrapper (stdio)** — line-delimited JSON protocol, request routing to domain ops, serialization
10. **End-to-end test** — spin up server, register agent, dispatch prompt, assert event stream + final task status

Each task in the plan must include:
- Which files to create/modify (with paths)
- Key interfaces/types to define
- Which domain events to wire up
- Which tests to write (specific cases, not just "write tests")
- Definition of done (typecheck clean, N tests pass)

**Read before writing**:
1. `docs/superpowers/specs/2026-06-23-agent-orchestration-hub-design.md` — bounded contexts, invariants, domain events
2. `docs/superpowers/specs/2026-06-23-agent-orchestration-hub-mvp-grading.md` — what is Must Have vs deferred
3. `docs/superpowers/specs/2026-06-23-agent-orchestration-hub-tech-stack.md` — package choices (mitt, nanoid, typebox, vitest, raw fs)

**Key constraints for the implementation plan**:
- Domain library (`lib/`) must be I/O-free and not import from `server/`
- All cross-context communication goes through the `EventBus`; no direct aggregate-to-aggregate calls
- File-based persistence is Nice to Have for MVP — in-memory is fine for initial implementation
- HTTP transport is explicitly out of scope
- LLM router agent is Won't Do for MVP
- Gate policy: only `all_of` for MVP; `any_of` and `exactly_N` deferred
- Human approval gates: Won't Do

---

## Open Items

| # | Item | Status |
|---|---|---|
| 1 | stdio protocol format — JSON-RPC 2.0 vs line-delimited JSON? | Open — resolve before Step 9 (server wrapper) |
| 2 | Snapshot format — JSON vs YAML for state files? | Open — low priority; resolve before persistence task |
| 3 | `onUpdate` forwarding in `executeParallel` → `executeSingle` | Open — enhancement only, not blocking |
| 4 | `agent: "default"` INVALID_PARAMS error message clarification | Open — doc/UX improvement, not blocking |
