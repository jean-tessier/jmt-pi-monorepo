# pi-delegate — Master Code Review

> Reconciled synthesis of four independent Opus reviews (Functionality, Tests/Gap-analysis, Documentation, Completeness) of `packages/pi-delegate` @ v0.1.0.
> Each angle was reviewed in parallel without sight of the others; findings that ≥2 reviewers reached independently are marked **cross-validated** and carry high confidence.

---

## 1. Executive summary

`pi-delegate` is a **substantially-complete, well-structured MVP**. The headline safety model is genuinely implemented (8-check preflight in the documented order, depth/cycle/lineage guards, capability-gating-by-provider-absence, per-child token, tool ceiling, structured output, agent discovery, config/env precedence, sandbox + timeout hooks, `/delegate` command + doctor), and **71/71 conformance tests pass**.

It is **not cleanly shippable as written.** Four reviewers converged on the same structural weaknesses:

1. **The central "never throw — return labeled strings" contract is broken on realistic failure paths.** A real run timeout, a missing `pi` binary, a bad `PI_DELEGATE_AGENTS` env, a temp-file failure, or a child spawn error all *throw* out of the single-task `execute()` instead of returning `[BLOCKED:…]`. The timeout handler is literally unreachable dead code.
2. **The test suite mocks away the riskiest code** (`spawn.ts` is 100% mocked, and the mock's shape doesn't even match the real function), which is *why* bug #1 survived — and the mock contract (resolve) directly contradicts the implementation (reject).
3. **User-facing docs actively mislead on first contact** (`pi doctor` doesn't exist; `maxConcurrency` is rejected by the schema; install via `pi.yaml` contradicts what `install.mjs` actually writes).
4. **Packaging is internally contradictory** (exact `pi: "0.79.8"` peer vs `0.79.9` installed; `typebox ^1.3.0` declared vs `1.1.38` bundled-and-imported; `license: MIT` with no LICENSE file).

**Estimated effort to "truly done": ~1 focused engineer-day** of code + tests + docs, well-suited to parallel subagent execution (see `RESOLUTION-PLAN.md`).

### Severity tally (reconciled)

| Severity | Count | Themes |
|---|---|---|
| CRITICAL | 3 | never-throw contract; spawn untested; user-facing doc drift |
| HIGH | 5 | packaging/version coherence; concurrency/cancellation correctness; core test gaps (config, agents, resolve, guards-boundary, tempfiles) |
| MEDIUM | 7 | child-cwd isolation; non-zero-exit = success; provider not single-purpose; config precedence layers; doc message-text drift; medium test gaps |
| LOW/INFO | many | flag order, dead flag, typecheck wiring, install.mjs `fs.rm`, taxonomy code, default-agent cycles, CHANGELOG, etc. |

---

## 2. Build / test / typecheck status (observed)

- **`pnpm --filter pi-delegate test` → PASS.** 7 files, 71 tests green (~0.9s).
- **`pnpm --filter pi-delegate typecheck` → FAILS** for **two** reconciled reasons (cross-validated by Functionality + Completeness):
  1. The package has **no local `tsconfig.json`**, so `tsc --noEmit` resolves to the repo-root config (no `include`/`exclude`) and sweeps the entire tree — including the sibling `parallel-work/` git worktree that has no `node_modules` (~30 spurious `TS2307`).
  2. There are **genuine type errors in `test/conformance/schema.test.ts`** (jiti `moduleCache` / arg-count API misuse, ~4 errors).
  - **`src/**` itself typechecks clean.** Fix requires *both* a package-local tsconfig **and** fixing the schema test types.

---

## 3. Cross-validated findings (highest confidence)

These were reached independently by multiple reviewers:

| ID | Finding | Reviewers | Master sev |
|---|---|---|---|
| X1 | Single-task error/timeout paths **throw** instead of returning `[BLOCKED:…]`; timeout branch is unreachable dead code | Functionality (F1,F2) + Tests (G2 explains why hidden) | **CRITICAL** |
| X2 | `spawn.ts` (buildSpawnArgs + spawnRun) is 100% mocked; mock returns `[]` while real returns `{argv,env}`; this hid the live `--output-file` flag-order bug | Tests (G1,G2) + Functionality (F7) | **CRITICAL** |
| X3 | User-facing doc drift: `pi doctor` (→ `/delegate doctor`), `maxConcurrency` param (rejected by schema), `pi.yaml` install (→ `settings.json`), `{index,output,status}[]` return (→ joined string) | Docs (D1,D2,D3,D10) + Completeness (C6) | **CRITICAL** |
| X4 | `delegate-provider` imports `../parent/delegate-tool.js`, violating the "no cross-side imports" invariant and re-running full parent activation in children | Functionality (F6) + Docs (D7) + Completeness (C9) | **MEDIUM** |
| X5 | `--output-file` is emitted but is **not a real pi flag** (ignored; structured output works via `PI_OUTPUT_FILE` env) — dead/spec-noncompliant | Functionality (F9) + Completeness (C3) | **LOW** |
| X6 | `SPAWN_FAILED` is in SPEC but never emitted; parallel spawn failures surface as non-taxonomy `[BLOCKED:ERROR]`; single-mode binary failure throws | Docs (D8) + Completeness (C10) | **MEDIUM** |
| X7 | `license: "MIT"` but no LICENSE file; ships raw `.ts` with no build/dist | Docs (D14) + Completeness (C2) | **HIGH** |
| X8 | `install.mjs` calls `fs.rm` not present in its default `fs` object → `TypeError` on real runs (swallowed by try/catch) | Docs (D13) + Completeness (C8) | **LOW** |
| X9 | `pnpm typecheck` is red (worktree sweep + real schema.test.ts errors) | Functionality (F8) + Completeness (INFO) | **LOW** |

---

## 4. Findings by theme

### Theme A — "Never throw" contract violations  · **CRITICAL**

The README/AGENTS/SPEC guarantee every outcome is **returned** as a labeled string. The single-task path violates this on multiple realistic inputs.

- **A1 [CRITICAL] Timeout is unreachable dead code.** `spawn.ts:445-448` *rejects* `{timedOut:true}` on timeout, but `executeSingle` (`delegate-tool.ts:257-272`) consumes it as a *resolved* `runResult.timedOut` with no `try/catch` around the `await`. A real timeout throws a non-Error object out of `execute()`. In parallel mode it's caught and stringified to `[BLOCKED:ERROR] … [object Object]` (wrong code, useless message). *Hidden because every test mocks `spawnRun` to resolve `{timedOut:false}`.* (F1) — **Fix:** make `spawnRun` *resolve* `{output,exitCode,timedOut:true}` **or** wrap the `await` in try/catch; align the test mock; add a real timeout test.
- **A2 [CRITICAL/HIGH] Single-task error paths throw.** `JSON.parse(PI_DELEGATE_AGENTS)` (`delegate-tool.ts:152`, before the try), `createTempRunFiles` (`:212`, before the try — and its dir then leaks because cleanup is in the later `finally`), `resolvePiBinary` (`:229`, throws `'pi binary not found in PATH'`), and child `spawn` errors (`spawn.ts:430-436` `reject(err)`) all escape because `execute()` has no top-level try/catch. Parallel mode is safe (it wraps `runOne`). (F2) — **Fix:** wrap `executeSingle`/`execute()` body; map to `formatBlockedResult('ERROR'|'SPAWN_FAILED', …)`; move the env parse + temp-file creation inside the guard.
- **A3 [MEDIUM] Non-zero child exit treated as success.** `executeSingle` only special-cases `exitCode === 0` (for the schema read); otherwise it returns `formatOkResult(...)` regardless of exit code. `mapExitCode` (`spawn.ts:224-228`) is exported but never called. A crashed child returns `from agent "…": (no output)` as if successful. (F10) — **Fix:** call `mapExitCode`; non-ok → `[BLOCKED:ERROR]` with stderr summary.
- **A4 [MEDIUM] `SPAWN_FAILED` taxonomy gap (X6).** Map thrown binary/spawn failures to `SPAWN_FAILED` (add to `result.ts` `ErrorCode`); reconcile with SPEC §3.1/§4.4 (or downgrade SPEC).

### Theme B — Concurrency & cancellation correctness  · **HIGH**

`parallel.ts` cluster — cancellation forwarding is partially broken and inputs are unvalidated.

- **B1 [MEDIUM] `failFast` discards the parent's AbortSignal.** `parallel.ts:74-78`: when `failFast` is true, `runSignal = failFastController.signal` and `options.signal` (the parent/tool signal) is never passed to `runOne`. Parent cancel cannot reach children whenever `failFast` is on — violating invariant #4. (F4) — **Fix:** compose both (`AbortSignal.any([parent, failFast])`) or link them.
- **B2 [MEDIUM] Pool ignores abort between tasks.** `worker()` (`parallel.ts:38-43`) never checks `runSignal.aborted`, so after a cancel/failFast it keeps pulling queued tasks; each then spawns a child (`spawn.ts:305`) only to immediately kill it. Wasted spawns + temp-dir churn + slow abort. (F5) — **Fix:** break the loop on `aborted`; short-circuit `executeSingle` to a blocked result if already aborted before `resolvePiBinary`/spawn.
- **B3 [MEDIUM] Unvalidated `concurrency` (0/negative/NaN) deadlocks.** `delegate-tool.ts:327` passes `params.concurrency` raw; `effectiveConcurrency = Math.min(c ?? 5, 10, Infinity)`; with `0` the worker loop starts **zero** workers, `results` stays `undefined[]`, and `.map(r => r.output)` throws. Schema (`delegate-tool.ts:55`) has no `minimum`. (F3) — **Fix:** clamp `Math.max(1, …)` for positive integers, default otherwise; add `minimum: 1`.
- **B4 [MEDIUM] `maxInFlightChildren` is not the process-wide cap it claims to be (X-cross C4).** `parallel.ts:64-68` folds it into a single call's `Math.min`. SPEC §9 requires a **global** cap across concurrently-issued `delegate` calls; no module-level semaphore exists, so several parallel `delegate` calls can far exceed it — the exact resource-exhaustion case the cap exists to prevent. (C4) — **Fix:** module-level async semaphore acquired around every `spawnRun`.

### Theme C — Child isolation & trust boundary  · **MEDIUM**

- **C1 [MEDIUM] Default child cwd is the temp dir holding `prompt.md`/`schema.json`/`output.json`.** `spawn.ts:302` uses `childCwd ?? tempFiles.dir`. SPEC §3.5/§10 require temp files **outside** the child's cwd so a `read`/`write`/`bash`-capable child can't read the prompt or clobber `output.json`. With the default, the child sits in that very directory — defeating the isolation guarantee. (C7) — **Fix:** spawn children in a separate empty work dir distinct from the I/O file dir.
- **C2 [MEDIUM] Provider not single-purpose / cross-import (X4).** `delegate-provider/index.ts:9` imports the parent entry and runs full `parentActivate(pi)` in every authorized child — re-registering the `/delegate` command + `before_agent_start` hook inside children. Couples child to parent; risks cycles; contradicts AGENTS.md §invariant and SPEC §3.4. — **Fix:** extract a tool-only `registerDelegateTool(pi)` into a neutral module imported by both sides.

### Theme D — Spawn-contract fidelity  · **LOW**

- **D1 [LOW] Flag order deviates from the contract.** `spawn.ts:157-174` emits `--output-file` *before* `--no-extensions`/`-e`; AGENTS.md/SPEC specify it *after* `-e`, just before `<task>`. Harmless today (pi is order-independent) but breaks the documented/conformance contract and would have been caught by a `buildSpawnArgs` test. (F7)
- **D2 [LOW] `--output-file` is dead (X5).** Remove it; rely on `PI_OUTPUT_FILE` env. (F9/C3)

### Theme E — Packaging & shippability  · **HIGH**

- **E1 [HIGH] Version contradictions (C1).** Peer `pi: "0.79.8"` (exact) vs installed `0.79.9` (masked by `peerDependenciesMeta.optional`); dep `typebox: "^1.3.0"` while pi bundles `1.1.38` and the runtime import is `typebox/compile` (the 1.1 path). A fresh `npm install` (install.mjs:58) may pull 1.3 with a different API. The AGENTS-referenced `@earendil-works/pi-ai` (`StringEnum`) is only transitive (not a declared dep). — **Fix:** align peer to `~0.79`/`0.79.9`; pin `typebox` to pi's bundled `~1.1` (or move to peer); reconcile with jiti resolution per `schema.test.ts`.
- **E2 [HIGH] No LICENSE despite `license: MIT`; ships raw `.ts`, no build/dist/.npmignore/CHANGELOG (X7).** `exports` points at TS source (fine for pi's jiti loader, atypical for npm). — **Fix:** add LICENSE (+ CHANGELOG); explicitly document the TS-source-via-jiti distribution decision.
- **E3 [LOW] `install.mjs` `fs.rm` bug (X8).** Add `rm` to the default fs object so the documented stale-`node_modules` cleanup actually runs.
- **E4 [LOW] `typecheck` is red (X9).** Add a package-local `tsconfig.json` (`include: ["src/**/*.ts","test/**/*.ts"]`, exclude `parallel-work`/`node_modules`) **and** fix the `schema.test.ts` type errors.

### Theme F — Resolution / config layering  · **MEDIUM**

- **F1 [MEDIUM] Model/tools/prompt precedence lacks the project/user config layers SPEC §8 requires.** `resolve.ts` does per-call > agent-def > built-in only; `config.ts` never reads model/tools/prompt defaults. Operators can't set org-wide defaults as documented. (C5) — **Fix:** implement the config layers **or** narrow SPEC §8 to state config governs only depth/timeouts/binary/sandbox/cwd. *(decision required)*
- **F2 [LOW] `tools` normalization (trim/dedup) specced (SPEC §8.2) but not implemented** (`resolve.ts:44-51`). (D11) — implement or downgrade the SPEC MUST.

### Theme G — Test coverage gaps  · **CRITICAL → MEDIUM**

Coverage tool unavailable (`@vitest/coverage-v8` not installed); mapping is manual. **0%-covered modules:** `spawn.ts` (mocked away), `agents.ts`, `cancel-registry.ts`, `command.ts`, `doctor.ts`, `tempfiles.ts`, and most of `resolve.ts`/`config.ts`.

| ID | Gap | Sev |
|---|---|---|
| G1 | **`buildSpawnArgs`** real argv order + full env map untested; mock shape wrong (X2) | CRITICAL |
| G2 | **`spawnRun`** stdout JSON stream parser + timeout + abort (~170 lines) untested (X2) | CRITICAL |
| G3 | **`config.ts`** env overrides, malformed numbers, invalid-JSON→defaults, path precedence untested (governs the depth safety limit) | CRITICAL/HIGH |
| G4 | **`agents.ts`** discovery/scope-precedence/frontmatter/name-regex 0% tested (largest untested module) | HIGH |
| G5 | **`resolveParams` + `checkToolCeiling`** precedence engine untested (the tool/prompt trust engine) | HIGH |
| G6 | **`tempfiles.ts`** modes `0o700`/`0o600` + cleanup-on-abort untested (security property) | HIGH |
| G7 | **Preflight Check 3 (lineage cap)** never tested; no boundary tests (`depth==max` vs `max-1`; cap `49` vs `50`); first-failure ordering only spot-checked | HIGH |
| G8 | **`executeSingle`** structured-output validate / TIMEOUT / ceiling-block paths untested | MEDIUM |
| G9 | **`cancel-registry` / `command` / `doctor`** 0% tested | MEDIUM |
| G10 | **`mapExitCode` / `wrapWithSandbox`** pure fns untested (`mapExitCode` has a dead `===2` branch) | MEDIUM |
| G11 | Parallel error-result string format (`[BLOCKED:ERROR] … "unknown"`) untested | LOW |

**Test-quality issues (separate):** `buildSpawnArgs` mock returns wrong type; the `failFast` test asserts nothing meaningful (`okCount>=0`); the `SCHEMA_INVALID: uncompilable` test is conditional (`if (result.blocked)`) and may assert zero expectations; `parallel.test.ts` reconstructs `DELEGATE_TOOL_PARAMS` by hand instead of importing it (tests a stale copy); `createMockAPI` is duplicated ~50 lines across files.

### Theme H — Documentation drift  · **CRITICAL (user-facing) → INFO**

The **doc/code drift table** (24 rows verified by the Docs reviewer) found **12 mismatches** and 12 exact matches. Highest-impact:

| Sev | Drift | Doc → Code |
|---|---|---|
| CRITICAL | `maxConcurrency` settable param | README L11/137/270 → not in schema; `additionalProperties:false` rejects it |
| CRITICAL | `pi doctor` verify step | README L41, QUICK-START L47/333 → only `/delegate doctor` (`command.ts:54`) |
| HIGH | install via `~/.config/pi/pi.yaml` + `src/...index.ts` paths | README L29-35 → `install.mjs` writes `settings.json` (JSON) + package-dir path |
| HIGH | depth-block message `Depth 3 exceeds maxDepth (3); cannot delegate` (+ inconsistent example) | QUICK-START L265/285 → `Delegation depth N reached maxDepth M` (`guards.ts:46`) |
| HIGH | cycle message `[root→loop-test]` | QUICK-START L321 → colon-separated, no `root` (`guards.ts:65`) |
| HIGH | symbols `SINGLE_TASK_PARAMS` / `PARALLEL_TASK_PARAMS` | README L263 → `DELEGATE_TOOL_PARAMS` / `PARALLEL_TASK_ITEM` |
| MEDIUM | `additionalProperties:false` on **both** param schemas | README L264 / AGENTS L102 → only on `DELEGATE_TOOL_PARAMS` |
| MEDIUM | `systemPrompt` is a frontmatter key | QUICK-START L105 → it's the Markdown **body** (`agents.ts:207`) |
| LOW | tool returns `{index,output,status}[]` | README L11/272 → joined labeled string (`delegate-tool.ts:354`) |
| LOW | `/delegate doctor` "lists agents" | QUICK-START L110/333 → doctor reports binary/config/providers/timeout only |
| INFO | IMPLEMENTATION-PLAN references `src/parent/stream.ts` | doesn't exist (logic in `spawn.ts`); SUPERSEDED banner already disclaims |

**Best-in-class:** `docs/SPEC.md` is a faithful normative contract; `docs/DESIGN.md` accurate; AGENTS.md (package) is strong contributor guidance (one self-contradiction: the cross-import invariant, X4).

### Theme I — Minor correctness / polish  · **INFO**

- **I1** Default agent name `"default"` causes spurious cross-call cycle blocks (`default`→`default` flagged `CYCLE_DETECTED`); aborted runs resolve as empty successes rather than a cancelled marker. (F11)
- **I2** `PI_DELEGATE_MAX_DEPTH` plays a dual role (env override **and** inherited ceiling) — correct today but undocumented and fragile to refactor. (C11)
- **I3** `StringEnum`-from-`@earendil-works/pi-ai` guidance points at a non-declared dependency. (D16)

---

## 5. What is correct and well-built (verified, do not regress)

- Preflight: exactly 8 checks in the documented order; first-failure-wins (`guards.ts:35-95`).
- Depth `>=` semantics, default `maxDepth=2`, `resolveMaxDepth` min-clamp (`resolve.ts:80-86`).
- Cycle detection + lineage cap 50 + sanitization (`:`/`/`/`..`→`_`) (`lineage.ts`).
- Env threading to children — all 8 `PI_DELEGATE_*` / `PI_OUTPUT_*` vars (`spawn.ts:177-199`).
- Capability gating by provider absence; per-child token `randomBytes(32).hex`; SO provider always loaded (`spawn.ts:96-98`, `delegate-tool.ts:94-107`).
- Temp-file modes `0o700`/`0o600` + finally-cleanup (`tempfiles.ts`).
- Result labeling formats (`result.ts:17-27`); untrusted-output prefix.
- Agent discovery user+project scope, project-shadows-user, name regex (`agents.ts`).
- Config defaults + env precedence for depth/timeout/binary/cwd (`config.ts:70-132`).
- `sandboxCommand`, `childCwd`, `runTimeoutMs`, `piBinaryPath` are all genuinely wired.
- 71 conformance tests pass and use the correct (spawn-boundary) mock layer for *consumers*.

**Correctly deferred / out of scope for 0.1.0** (do not treat as gaps): embedded backend, `maxOutputLines`, `fallbackModels`/`thinking`/`canDelegate` frontmatter, configurable `lineagePathCap` — all marked reserved in SPEC.

---

## 6. Prioritized fix order (feeds the resolution plan)

1. **CRITICAL** — Theme A (never-throw: A1 timeout, A2 error paths, A3 exit mapping, A4 SPAWN_FAILED).
2. **CRITICAL** — Theme H high-impact docs (`pi doctor`, `maxConcurrency`, install flow).
3. **HIGH** — Theme E packaging (versions, LICENSE, tsconfig+schema.test fix); Theme B concurrency/cancellation; Theme G G1–G3 (the tests that would have caught Theme A).
4. **HIGH/MEDIUM** — Theme G G4–G7 (agents/resolve/tempfiles/guards-boundary); Theme C isolation + provider; Theme F config layers (decision).
5. **MEDIUM/LOW** — remaining doc message-text fixes, Theme D flag fidelity, G8–G11, install.mjs, polish (I1–I3).
