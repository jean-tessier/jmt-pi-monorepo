# pi-delegate — Resolution Report

Generated: 2026-06-25

Author: T4.1 (Wave-4 integration & full verification)

This report maps every MASTER-REVIEW finding to its resolution status with
verifiable evidence (source location and/or conformance test). It is the final
deliverable closing out the RESOLUTION-PLAN waves.

## Summary

- **Tests: 302/302 passing** (17 conformance files) — was 290 before integration.
  All 6 XFAIL (`it.fails`) markers removed and converted to live, passing
  regression assertions; +12 net tests from the merged Wave-2 suites
  (`spawn-pool.test.ts`, the B2 short-circuit test) and converted XFAILs.
- **Typecheck: GREEN** (`tsc --noEmit`, package-local `tsconfig.json`, zero errors).
- **Never-throw contract: verified end-to-end** — timeout, missing binary, bad
  env, abort (single + parallel), and `concurrency:0` all return labeled
  `[BLOCKED:…]` strings; nothing throws.
- **Open decisions (4):** all four resolved and recorded in
  `reviews/OPEN-DECISIONS.md`; SPEC propagation owned by T4.2.
  1. F1/C5 Config precedence layers → **Narrow SPEC**
  2. F2/D11 Tools list normalization → **Downgrade MUST → SHOULD**
  3. E2 Distribution model → **Document TS-source-via-jiti as intentional**
  4. A1 Timeout contract shape → **Resolve with `timedOut` flag**

## Integration overview

Three worktrees were merged onto `main` and their coordination points reconciled:

| Worktree | Task | Brought |
|---|---|---|
| `agent-adbf6b726cba7ef98` | T2.1 | spawn.ts, delegate-tool.ts (A1–A4 logic), result.ts |
| `agent-ad4a9bf538329bede` | T2.2 | parallel.ts, spawn-pool.ts (canonical), spawn-pool.test.ts, parallel.test additions |
| `agent-aae18c64eb757dd07` | T3.2 | register.ts, delegate-tool.ts (registerDelegateTool extraction), delegate-provider/index.ts, extensions.test.ts |

**Key reconciliations:**

- **spawn-pool.ts:** adopted T2.2's class-based API (`Semaphore` /
  `configureSpawnPool` / `withSpawnSlot`); T2.1's `acquireSpawnSlot`/`inFlightCount`
  variant was dropped. The slot is acquired **exactly once per child**: single
  mode wraps the `executeSingle` call in `delegate-tool.ts` `execute()`; parallel
  mode wraps each `runOne` in `parallel.ts`. `spawnRun` no longer self-acquires
  (doing so would double-acquire in parallel mode and deadlock the pool when the
  cap is small).
- **delegate-tool.ts:** combined T2.1's never-throw / exit-mapping logic WITH
  T3.2's `registerDelegateTool` extraction; added `minimum: 1` to the
  `concurrency` schema (the T2.2 coordination point).
- **Tests:** rewrote `spawn.test.ts`'s spawn-pool test to T2.2's API; updated the
  `executeParallel` signal-forwarding test to T2.2's live-signal shape and added
  the B2 pre-aborted short-circuit test; removed all 6 `it.fails` markers.

## Findings

### Theme A — Never-throw contract (CRITICAL)

| ID | Status | Evidence |
|---|---|---|
| A1 | RESOLVED | `spawn.ts` `spawnRun` RESOLVES `{output:'', exitCode:-1, timedOut:true}` on timeout (never rejects); `delegate-tool.ts` executeSingle maps `runResult.timedOut → formatBlockedResult('TIMEOUT', …)`. Test: `spawn.test.ts` "maps a timed-out run to [BLOCKED:TIMEOUT] (A1)". |
| A2 | RESOLVED | `executeSingle` is wrapped in a top-level try/catch (the never-throw backstop); `JSON.parse(PI_DELEGATE_AGENTS)` and `createTempRunFiles` now run inside the guard. Tests: `spawn.test.ts` "returns a labeled blocked string on malformed PI_DELEGATE_AGENTS env (A2)"; e2e verify: bad-env → `[BLOCKED:ERROR] … not valid JSON`. |
| A3 | RESOLVED | `mapExitCode(runResult.exitCode)` gate added; a non-ok exit → `formatBlockedResult('ERROR', 'child exited with code N: <stderr summary>')`. Test: `spawn.test.ts` "maps a non-zero exit code to [BLOCKED:ERROR] (A3)". |
| A4/X6 | RESOLVED | `SPAWN_FAILED` added to `result.ts` `ErrorCode`; a missing binary / spawn error is caught in executeSingle and mapped to `[BLOCKED:SPAWN_FAILED]`. Test: `spawn.test.ts` "maps a missing binary to [BLOCKED:SPAWN_FAILED] without throwing (A2/A4)". |

### Theme B — Concurrency & cancellation (HIGH)

| ID | Status | Evidence |
|---|---|---|
| B1 | RESOLVED | `parallel.ts` composes parent + failFast signals via `AbortSignal.any([options.signal, failFastController.signal])`; parent signal forwarded as-is when failFast is off. Tests: `parallel.test.ts` "composes parent signal with failFast so parent cancel reaches runOne", "forwards the parent signal unchanged when failFast is off", and the B1 sibling-abort suite. |
| B2 | RESOLVED | `parallel.ts` worker checks `runSignal?.aborted` BEFORE calling runOne and records a cheap blocked result ("cancelled before start") instead of spawning a child to kill. Test: `parallel.test.ts` "short-circuits a pre-aborted parent signal without spawning a child (B2)" (asserts `spawnRun` NOT called). |
| B3 | RESOLVED | `parallel.ts` clamps `effectiveConcurrency = Math.max(1, Math.min(safe, ceiling))` with NaN/non-finite treated as default 5; schema now carries `concurrency: Type.Number({ minimum: 1 })`. Tests: `parallel.test.ts` clamp suite (concurrency 0 / negative / NaN). |
| B4/C4 | RESOLVED | Process-wide cap enforced by the shared `spawn-pool.ts` semaphore (`configureSpawnPool` + `withSpawnSlot`), acquired once per child; the bogus per-call `maxInFlightChildren` term was removed from `parallel.ts`. Tests: `spawn-pool.test.ts` "enforces a GLOBAL cap across independent concurrent callers (B4/C4)" and `parallel.test.ts` "bounds combined in-flight children across two concurrent runParallel calls". |

### Theme C — Child isolation & trust boundary (MEDIUM)

| ID | Status | Evidence |
|---|---|---|
| C1/C7 | RESOLVED | `spawn.ts` spawns the child in an isolated `work/` subdir (mode `0o700`) under `tempFiles.dir` when no explicit `childCwd` is set, falling back to `os.tmpdir()` if that fails — never the dir holding `prompt.md`/`output.json`/`schema.json`. cwd-isolation covered by `extensions.test.ts`. |
| C2/X4 | RESOLVED | `registerDelegateTool(pi)` extracted into `delegate-tool.ts` and re-exported by the neutral `register.ts`; `delegate-provider/index.ts` imports `registerDelegateTool` from `../parent/register.js` (not `parentActivate`), so children get the tool only — no `/delegate` command, no `before_agent_start` hook, no parent-entry import. Tests: `extensions.test.ts` (3 updated). |

### Theme D — Spawn-contract fidelity (LOW)

| ID | Status | Evidence |
|---|---|---|
| D1 | RESOLVED | `spawn.ts` `buildSpawnArgs` emits flags in the contract order (`-e <provider>` then `<task>` last); no stray flag before `-e`. Test: `spawn.test.ts` argv-order assertions ("passes the task string as the LAST positional element", etc.). |
| D2/X5 | RESOLVED | `--output-file` removed from `buildSpawnArgs`; structured output is passed via the `PI_OUTPUT_FILE` env var. Test: `spawn.test.ts` "does NOT emit --output-file even when outputFile is set (D2/X5)" + `PI_OUTPUT_FILE` env assertions. AGENTS.md spawn-flag block updated. |

### Theme E — Packaging & shippability (HIGH)

| ID | Status | Evidence |
|---|---|---|
| E1 | RESOLVED (Wave 1, T1.4) | `package.json` peer/dep versions aligned (`pi ~0.79`, `typebox ~1.1` matching bundled `1.1.38`). Verified by install resolution + `schema.test.ts` jiti-alias test (typebox v1.1 `./compile` path). |
| E2/X7 | RESOLVED (Wave 1, T1.1/T1.4) + decision | `LICENSE` + `CHANGELOG.md` present; TS-source-via-jiti distribution documented (see Open Decision E2). |
| E3/X8 | RESOLVED (Wave 1, T1.2) | `install.mjs` imports `rm` from `node:fs/promises`; stale-`node_modules` cleanup path runs without `TypeError`. |
| E4/X9 | RESOLVED (Wave 1/Phase 0) | Package-local `tsconfig.json` scopes `src/**` + `test/**`; `parallel-work` worktree removed (Phase 0). `schema.test.ts` jiti type errors fixed. **Typecheck GREEN** (verified at integration). |

### Theme F — Resolution / config layering (MEDIUM)

| ID | Status | Evidence |
|---|---|---|
| F1/C5 | DECISION → NARROW SPEC (deferred code) | Config governs only `maxDepth`/`runTimeoutMs`/`piBinaryPath`/`sandboxCommand`/`childCwd`/`maxInFlightChildren` (confirmed in `config.ts`). Model/tools/prompt config layers deferred post-0.1.0. SPEC §8 narrowing owned by T4.2. See Open Decisions. |
| F2/D11 | DECISION → DOWNGRADE MUST→SHOULD (deferred code) | `resolve.ts` does not trim/dedup the tools list; treated as caller responsibility for 0.1.0. SPEC §8.2 downgrade owned by T4.2. See Open Decisions. |

### Theme G — Test coverage gaps (CRITICAL → MEDIUM)

| ID | Status | Evidence |
|---|---|---|
| G1 | RESOLVED (T3.1) | `buildSpawnArgs` exercised with the REAL builder — argv order + full env map (`spawn.test.ts` argv/env suites; catches D1). |
| G2 | RESOLVED (T3.1) | `spawnRun` stream-parse / timeout / abort covered via the executeSingle never-throw suite (spawn boundary mocked per AGENTS.md). |
| G3 | RESOLVED (Wave 1, T1.6) | `config.test.ts` (27 tests): env overrides, malformed numbers, invalid-JSON→defaults, path precedence. |
| G4 | RESOLVED (Wave 1, T1.6) | `agents.test.ts` (25 tests): discovery, scope precedence, frontmatter, name-regex. |
| G5 | RESOLVED (Wave 1, T1.6) | `resolve.test.ts` (32 tests): `resolveParams` + `checkToolCeiling` precedence. |
| G6 | RESOLVED (Wave 1, T1.7) | `tempfiles.test.ts` (25 tests): modes `0o700`/`0o600` + cleanup. |
| G7 | RESOLVED (Wave 1, T1.6) | `guards-boundary.test.ts` (15 tests): lineage cap (Check 3), boundary cases, first-failure ordering. |
| G8 | RESOLVED (T3.1) | `executeSingle` TIMEOUT / exit-mapping / SCHEMA_INVALID / ceiling-block paths covered in `spawn.test.ts`. |
| G9 | RESOLVED (Wave 1, T1.7) | `cancel-registry.test.ts` (11), `command.test.ts` (14), `doctor.test.ts` (21). |
| G10 | RESOLVED (Wave 1, T1.7) | `pure-fns.test.ts` (24): `mapExitCode` / `wrapWithSandbox`. |
| G11 | RESOLVED (T3.1) | `parallel.test.ts` "runParallel error result string format (G11)" — real agent name preserved, never the literal "unknown". |

### Theme H — Documentation drift (CRITICAL → INFO)

| ID | Status | Evidence |
|---|---|---|
| H (X3/D4–D12 mechanical drift) | RESOLVED (Wave 1, T1.5) | `README.md`/`QUICK-START.md`/`AGENTS.md` reconciled: `pi doctor`→`/delegate doctor`; `maxConcurrency` removed/redefined; install via `settings.json` not `pi.yaml`; real block-message text; cycle colon-form; `DELEGATE_TOOL_PARAMS`/`PARALLEL_TASK_ITEM` symbol names; `additionalProperties:false` scope (only `DELEGATE_TOOL_PARAMS`); `systemPrompt`-is-body; joined-string return shape. |
| H (spawn-flag block, D1/D2) | RESOLVED (T4.1) | `AGENTS.md` spawn-flag block updated to drop `[--output-file <path>]` and note `PI_OUTPUT_FILE` env. |
| H (SPEC-tied lines) | OWNED BY T4.2 | SPEC/IMPLEMENTATION-PLAN lines tied to A1/D2/maxConcurrency/cwd-isolation/config-layer decisions are T4.2's scope (runs last to reflect shipped behavior). |

### Theme I — Minor correctness / polish (INFO)

| ID | Status | Evidence |
|---|---|---|
| I1 | DEFERRED | Default-agent-name `"default"` spurious cross-call cycle blocks + aborted-run-as-empty-success. INFO polish, acceptable for 0.1.0; no contract violation. |
| I2 | DEFERRED | `PI_DELEGATE_MAX_DEPTH` dual role (env override + inherited ceiling) — correct today, documentation note deferred to T4.2/post-0.1.0. |
| I3/D16 | RESOLVED (Wave 1, T1.5) | `StringEnum`-from-`@earendil-works/pi-ai` note in AGENTS.md clarified as a transitive (not directly declared) dependency. |

### Cross-validated findings (X1–X9)

| ID | Status | Maps to |
|---|---|---|
| X1 | RESOLVED | Theme A (A1/A2) — single-task throw/timeout paths now return labeled strings. |
| X2 | RESOLVED | Theme G (G1/G2) — `buildSpawnArgs` real-builder tests; mock shape corrected. |
| X3 | RESOLVED | Theme H — user-facing doc drift fixed (T1.5). |
| X4 | RESOLVED | C2 — provider single-purpose refactor (T3.2). |
| X5 | RESOLVED | D2 — `--output-file` removed. |
| X6 | RESOLVED | A4 — `SPAWN_FAILED` emitted. |
| X7 | RESOLVED | E2 — LICENSE/CHANGELOG + distribution documented. |
| X8 | RESOLVED | E3 — `install.mjs` `fs.rm` fixed. |
| X9 | RESOLVED | E4 — typecheck GREEN; worktree removed. |

## Open Decisions

| Decision | Choice | Rationale |
|---|---|---|
| F1/C5 — Config precedence layers | **Narrow SPEC** | Model/tools/prompt config layers are new feature work (merge semantics, per-agent overrides, env interaction). The safety-critical subset (depth/timeouts/binary/sandbox/cwd) is implemented and correct; broader layers deferred post-0.1.0. SPEC §8 narrowed by T4.2. |
| F2/D11 — Tools list normalization | **Downgrade MUST → SHOULD** | Trim/dedup is low-risk caller responsibility with no filed bug; downgrading defers the work without breaking any contract a real caller depends on. SPEC §8.2 downgraded by T4.2. |
| E2 — Distribution model | **Document TS-source-via-jiti as intentional** | Trades a build step for simplicity at the cost of a runtime `jiti` dependency — appropriate for 0.1.0. Documented in README (T1.4); SPEC §1/§2 reconciled by T4.2 if needed. |
| A1 — Timeout contract shape | **`spawnRun` resolves with `timedOut` flag** | Keeps `spawnRun` consistent with the never-throw invariant; `executeSingle` maps `timedOut → [BLOCKED:TIMEOUT]`. Implemented in T2.1; SPEC spawn/timeout section confirmed by T4.2. |

(Full decision records: `reviews/OPEN-DECISIONS.md`.)

## Deferred

| Finding | Reason |
|---|---|
| I1 | Low/INFO — default-agent-name cycle-block nicety and aborted-run marker; acceptable for 0.1.0, no contract violation. |
| I2 | Low/INFO — `PI_DELEGATE_MAX_DEPTH` dual-role documentation note; correct today, documentation deferred. |
| F1/C5 (code) | Config model/tools/prompt layers deferred post-0.1.0 per the Narrow-SPEC decision (SPEC narrowed instead). |
| F2/D11 (code) | Tools trim/dedup deferred per the Downgrade decision (SPEC MUST → SHOULD; caller responsibility). |

## Verification commands

```
pnpm --filter pi-delegate test       # 302 passed (17 files), 0 it.fails markers
pnpm --filter pi-delegate typecheck  # GREEN (tsc --noEmit, exit 0)
```

Never-throw contract spot-checked end-to-end (no mocks) against the integrated
`delegate` tool: timeout, missing binary, bad env, abort (single + parallel),
and `concurrency:0` each returned a labeled `[BLOCKED:…]` / `from agent "…"`
string; no call threw.
