# pi-delegate — Suggestion Resolution Plan

> Derived from `MASTER-REVIEW.md`. Designed for **parallel subagent execution**.
> **Model tiering:** **Opus** = very-high-complexity / cross-cutting correctness or concurrency reasoning · **Sonnet** = moderate-to-high complexity or large-context (multi-file refactors, fixture-heavy test suites, doc reconciliation) · **Haiku** = simple, mechanical, single-file, low-ambiguity tasks.
> **Conflict rule:** packages in the same wave own **disjoint file sets** so they can run truly in parallel (optionally each in its own git worktree). Where two packages must touch the same file, a dependency edge is declared and they run in different waves.

---

## 0. Orchestration model

```
Phase 0 ── remove the parallel-work worktree (prerequisite gate; blocks all waves)
Wave 1  ── independent quick wins + tests for already-correct modules (max fan-out)
Wave 2  ── core correctness fixes (Opus), partitioned by file
Wave 3  ── dependent refactors + tests asserting Wave-2 behavior
Wave 4  ── integration, full verify, doc/spec finalization (single Opus integrator)
```

- **Waves 1 & 2 launch simultaneously** (they own disjoint files: Wave 1 = docs/packaging/new-test-files for untouched modules; Wave 2 = `src/` correctness). Wave 1's *code* tasks (T1.x) and Wave 2 are file-disjoint.
- **Run each Wave-2/Wave-3 code package in its own worktree** (`isolation: worktree`) if executing concurrently, so parallel `src/` edits never collide; the Wave-4 integrator merges.
- **Tests that assert *corrected* behavior wait for their code package** (declared deps). Tests for *already-correct* modules run in Wave 1 immediately.
- Each package's prompt should include the relevant `MASTER-REVIEW.md` section + the invariants from `AGENTS.md`, and end with: run `pnpm --filter pi-delegate test` + `typecheck`; do not regress the 71 passing tests; return a unified diff + a short report.

---

## Phase 0 — Remove the `parallel-work` worktree  · **prerequisite gate**

**Why first:** the repo contains a second, divergent copy of `pi-delegate` under `parallel-work/packages/pi-delegate`. It actively causes confusion and noise — it is what makes `pnpm --filter pi-delegate typecheck` sweep a tree with no `node_modules` (Theme E / X9), and it produces duplicate search/grep hits that mislead reviewers and subagents. Removing it **before** any wave gives every downstream package a single, unambiguous source tree to work in. This phase must complete and be verified before Wave 1/2 launch.

**Verified preconditions (as of this plan):**
- `git worktree list` shows `parallel-work` as a registered worktree on branch `parallel-work` @ `0718609`.
- The worktree is **clean** — `git -C parallel-work status --short` returns nothing (no uncommitted work to lose).
- It is **gitignored** and has **0 files tracked** in the main repo, so removal touches nothing under version control in `main`.
- The branch `parallel-work` has exactly **1 commit not on `main`** (`0718609 chore: update gitignore`), and that commit is a **divergent older snapshot** (mostly deletions vs `main`; e.g. it lacks the `agent-orchestration-hub` package). It contains **no newer work that `main` is missing.**

### **T0.1 — Remove the worktree** · **Haiku**
*Simple, mechanical, single git operation; preconditions already verified.*

- **Action (use the worktree command, never a blind `rm -rf`):**
  ```bash
  git worktree remove parallel-work        # clean worktree → safe; add --force only if it reports the tree is dirty
  git worktree list                        # confirm parallel-work is gone
  git worktree prune                       # tidy stale metadata
  ```
- **Reversibility:** removing the worktree is reversible — the branch still exists, so it can be re-created with `git worktree add parallel-work parallel-work`.
- **DoD:** `parallel-work/` no longer exists; `git worktree list` shows only the main worktree; a fresh `pnpm --filter pi-delegate typecheck` no longer reports any `../../parallel-work/...` errors.

### **T0.2 — (Optional, confirm-gated) Delete the orphaned branch** · **Haiku**
- After T0.1 the branch `parallel-work` still exists and is unreferenced. Deleting it removes the last pointer to commit `0718609`.
- **This is the only semi-destructive step** (the commit becomes eligible for GC). Because `0718609` is not on `main`, **require explicit human confirmation before running:**
  ```bash
  git branch -D parallel-work
  ```
- **Skip this** (leave the branch) if there is any doubt; the worktree removal alone resolves the confusion. Recovery window: `git reflog` / unreachable-object GC grace period if reconsidered.

> **Cross-reference:** once Phase 0 lands, **T1.3** no longer needs the `parallel-work` exclude in `tsconfig.json` — but it should still add the package-local `tsconfig.json` (scoping `src/**` + `test/**`) and fix the `schema.test.ts` type errors, since those are independent of the worktree.

---

## Wave 1 — Independent, max parallelism (launch after Phase 0)

All packages here own disjoint files and have **no dependencies**. Launch all at once.

| ID | Pkg | Model | Files owned (exclusive) | Findings | Definition of done |
|---|---|---|---|---|---|
| **T1.1** | LICENSE + CHANGELOG | **Haiku** | `LICENSE` (new), `CHANGELOG.md` (new) | E2 / X7, D15 | MIT LICENSE text with correct holder/year; `CHANGELOG.md` with a `0.1.0` section. |
| **T1.2** | install.mjs fix | **Haiku** | `install.mjs` | E3 / X8 (D13/C8) | Add `rm` to the default `fs` object (import `rm` from `node:fs/promises`); verify the stale-`node_modules` cleanup path runs without `TypeError`. |
| **T1.3** | tsconfig + schema.test types | **Sonnet** | `tsconfig.json` (new), `test/conformance/schema.test.ts` | E4 / X9 (F8 + INFO) | Package-local tsconfig scoping `src/**` + `test/**`, excluding `parallel-work`/`node_modules`; fix the jiti `moduleCache`/arg-count type errors so `pnpm --filter pi-delegate typecheck` is **green**. |
| **T1.4** | package.json version coherence | **Sonnet** | `package.json` | E1 / C1 | Align peer `pi` to `~0.79`/`0.79.9`; set `typebox` to pi's bundled `~1.1` (or move to peer); document the TS-source-via-jiti distribution decision (comment or README note hook). Verify install still resolves. *(Confirm bundled typebox version against `node_modules` first.)* |
| **T1.5** | Docs reconciliation (mechanical drift) | **Sonnet** | `README.md`, `QUICK-START.md`, `AGENTS.md` | Theme H: X3, D4, D5, D6, D9, D10, D12, D7(doc-side), D16; B-table for maxConcurrency | Large-context multi-file pass. Fix all **mechanical** doc/code mismatches: `pi doctor`→`/delegate doctor`; remove/redefine `maxConcurrency`; install via `settings.json` not `pi.yaml`; real block-message text + consistent numbers; cycle colon-form; rename `SINGLE_TASK_PARAMS`/`PARALLEL_TASK_PARAMS`→real symbols; fix `additionalProperties` scope claim; `systemPrompt`-is-body; joined-string return shape; drop "doctor lists agents". **Leave SPEC decisions to Wave 4** (T4.2). |
| **T1.6** | Tests: already-correct modules (fixture-heavy) | **Sonnet** | `test/conformance/agents.test.ts`(new), `config.test.ts`(new), `guards-boundary.test.ts`(new), `resolve.test.ts`(extend) | G3, G4, G5, G7 | Add suites for `agents.ts` (discovery/scope-precedence/frontmatter/name-regex), `config.ts` (env overrides, malformed numbers, invalid-JSON→defaults, path precedence), guards **boundary + lineage-cap (Check 3) + first-failure ordering**, and `resolveParams`/`checkToolCeiling` precedence. These assert **existing** behavior → no Wave-2 dependency. |
| **T1.7** | Tests: simple units + pure fns + quality fixes | **Haiku** | `test/conformance/cancel-registry.test.ts`(new), `command.test.ts`(new), `doctor.test.ts`(new), `tempfiles.test.ts`(new), `pure-fns.test.ts`(new) | G6, G9, G10; quality nits | Unit tests for `cancel-registry`, `command`, `doctor`, `tempfiles` (modes `0o700`/`0o600` + cleanup), `mapExitCode`/`wrapWithSandbox`. Also fix the conditional `SCHEMA_INVALID` test and import `DELEGATE_TOOL_PARAMS` instead of the hand-copied schema. *(tempfiles mode test asserts current correct behavior; cwd-isolation test deferred to T3.2.)* |

> **Why Sonnet for T1.5/T1.6 and not Haiku:** large multi-file context and many interdependent edits; **Haiku for T1.1/T1.2/T1.7** because they are single-file, mechanical, low-ambiguity.

---

## Wave 2 — Core correctness (Opus), file-partitioned (launch with Wave 1)

Two **Opus** packages own disjoint `src/` files so they parallelize cleanly. These are the highest-complexity, contract-defining changes.

### **T2.1 — Never-throw contract + spawn fidelity + isolation** · **Opus**
*Very-high complexity: central documented invariant, cross-file (spawn↔execute↔result), security-isolation, dead-code reachability.*

- **Files owned (exclusive):** `src/parent/spawn.ts`, `src/parent/delegate-tool.ts` (executeSingle + execute), `src/parent/result.ts`, `src/parent/spawn-pool.ts` (new, see T2.2 coordination).
- **Findings:** A1 (timeout dead code), A2 (single-task error paths throw), A3 (non-zero exit = success / `mapExitCode`), A4/X6 (`SPAWN_FAILED` taxonomy), D1 (flag order), D2/X5 (remove `--output-file`), C1 (child-cwd isolation, **see note**).
- **Tasks:** (1) decide & implement the timeout contract — `spawnRun` *resolves* `{output,exitCode,timedOut}` (preferred) and `executeSingle` maps `timedOut→TIMEOUT`; (2) wrap `execute()`/`executeSingle` in a top-level try/catch returning `[BLOCKED:ERROR|SPAWN_FAILED]`; move `PI_DELEGATE_AGENTS` parse + temp-file creation inside the guard; (3) add `SPAWN_FAILED` to `result.ts` `ErrorCode` and map binary/spawn failures to it; (4) wire `mapExitCode` so non-ok exits → blocked; (5) fix spawn flag order; remove the dead `--output-file` arg; (6) **child-cwd isolation (C1):** spawn children in an empty work dir distinct from the temp I/O dir.
- **DoD:** real timeout returns `[BLOCKED:TIMEOUT]` (with a test in T3.1); missing-binary/bad-env/spawn-error return labeled strings, never throw; 71 existing tests still pass after mock alignment.

### **T2.2 — Concurrency, cancellation & process-wide cap** · **Opus**
*Very-high complexity: concurrent control flow, abort-signal composition, global resource cap correctness.*

- **Files owned (exclusive):** `src/parent/parallel.ts`. **Provides** the `spawn-pool.ts` semaphore module API consumed by T2.1.
- **Findings:** B1 (failFast drops parent signal), B2 (pool ignores abort between tasks), B3 (unvalidated `concurrency`), B4/C4 (process-wide `maxInFlightChildren` semaphore).
- **Coordination with T2.1:** the process-wide semaphore must wrap **every** `spawnRun` (single + parallel), which lives in `spawn.ts` (T2.1's file). **Resolution:** T2.2 authors the standalone `spawn-pool.ts` module (a module-level async semaphore keyed off `config.maxInFlightChildren`) as a **new file** (no conflict); T2.1 imports and wraps `spawnRun` with it. T2.2 removes the bogus per-call `maxInFlightChildren` term from `parallel.ts`. New-file authorship + import wiring avoids a same-file edit collision.
- **Tasks:** compose parent + failFast signals (`AbortSignal.any`); break `worker()` on `aborted` and short-circuit already-aborted tasks before spawn; clamp `concurrency` to `Math.max(1, …)` for positive integers else default; add `minimum:1` to the schema; implement + export the `spawn-pool` semaphore.
- **DoD:** parent cancel aborts in-flight children even with `failFast:true`; no new children spawn after abort; `concurrency:0/-1/NaN` no longer crashes; concurrent `delegate` calls collectively respect `maxInFlightChildren` (test in T3.1).

> **Parallelism:** T2.1 and T2.2 are file-disjoint (T2.2's only shared touchpoint is the *new* `spawn-pool.ts`, which T2.1 merely imports). Run both Opus packages concurrently in separate worktrees; the Wave-4 integrator reconciles the one import line.

---

## Wave 3 — Dependent refactors + behavior-coupled tests (after Wave 2)

These depend on Wave-2 files/behavior, so they run after T2.1/T2.2 land.

| ID | Pkg | Model | Files owned | Depends on | Findings | DoD |
|---|---|---|---|---|---|---|
| **T3.1** | Tests for spawn + concurrency (corrected behavior) | **Opus** | `test/conformance/spawn.test.ts`(new), `parallel.test.ts`(extend) | T2.1, T2.2 | G1, G2, G8, G11, B-cluster, A-cluster | Real `buildSpawnArgs` argv-order + full env-map assertions (catches D1); `spawnRun` stream-parse + **timeout** + **abort** via an injected fake child; `executeSingle` TIMEOUT/exit-mapping/ceiling paths; real `failFast` sibling-abort + process-wide-cap assertions (replacing the assert-nothing test). **Opus** because it needs a fake-child harness + timing/abort reasoning. |
| **T3.2** | Provider single-purpose refactor | **Sonnet** | `src/parent/register.ts`(new), `src/delegate-provider/index.ts`, `src/parent/delegate-tool.ts` (extract only) | T2.1 (owns delegate-tool.ts) | C2 / X4 (F6/D7/C9), C1-isolation-test | Extract a tool-only `registerDelegateTool(pi)` into a neutral module; child provider calls **that** instead of `parentActivate`; parent re-uses it too; add cwd-isolation test. **Runs after T2.1** because both edit `delegate-tool.ts`. Sonnet: clear, bounded refactor across the trust boundary. |
| **T3.3** | Config precedence layers *(decision-gated)* | **Sonnet** | `src/parent/resolve.ts`, `src/parent/config.ts` | none on Wave 2 (disjoint), but **gated on T4.2 decision** | F1 (C5), F2 (D11 tools-normalize) | **If decision = implement:** add project/user config layers for model/tools/prompt + `tools` trim/dedup. **If decision = narrow spec:** no code change; SPEC edit moves to T4.2. *(See Open Decisions.)* |

> T3.1 is the single most valuable package — it is the regression net for every Theme-A/B fix and it directly catches the live flag-order bug. Assign **Opus**.

---

## Wave 4 — Integration & finalization (single Opus integrator)

### **T4.1 — Integration & full verification** · **Opus**
- Merge all worktrees; resolve the known coordination points (the `spawn-pool` import between T2.1/T2.2; the `delegate-tool.ts` extraction in T3.2).
- Run `pnpm --filter pi-delegate test` + `typecheck` (must be green); install `@vitest/coverage-v8` and report coverage delta; manually re-verify the never-throw contract end-to-end (timeout, missing binary, bad env, abort).
- Produce a final `reviews/RESOLUTION-REPORT.md` mapping each finding → resolved/deferred + evidence.

### **T4.2 — SPEC/doc finalization (decision-dependent)** · **Sonnet**
- Owns `docs/SPEC.md`, `docs/IMPLEMENTATION-PLAN.md`, and any README/SPEC lines tied to code decisions made in Waves 2–3: `SPAWN_FAILED` (now emitted → keep; else downgrade), `--output-file` removal, `maxConcurrency` semantics, child-cwd isolation wording, config-layer decision (F1), `tools` normalization (F2), `stream.ts` reference (D17).
- Runs last so docs reflect the **actual** shipped behavior.

---

## Open decisions (resolve before / during Wave 3–4)

1. **Config precedence layers (C5/F1):** implement project/user config layers for model/tools/prompt (more work, matches SPEC §8) **or** narrow SPEC to "config governs depth/timeouts/binary/sandbox/cwd only" (cheaper). → gates T3.3 vs T4.2.
2. **`tools` normalization (D11/F2):** implement trim/dedup **or** downgrade the SPEC MUST.
3. **Distribution model (E2):** confirm TS-source-via-jiti is intentional (document it) **or** add a build/dist step.
4. **Timeout contract shape (A1):** `spawnRun` resolves-with-`timedOut` (recommended) vs caller try/catch — pick one so T2.1 and T3.1 agree.

---

## Model-tier allocation summary

| Tier | Packages | Rationale |
|---|---|---|
| **Opus** (very-high complexity / cross-cutting correctness) | T2.1, T2.2, T3.1, T4.1 | Central invariant violations, concurrency/abort reasoning, fake-child test harness, cross-worktree integration. |
| **Sonnet** (moderate-high / large-context) | T1.3, T1.4, T1.5, T1.6, T3.2, T3.3, T4.2 | Multi-file refactors, fixture-heavy test suites, doc/spec reconciliation across many files. |
| **Haiku** (simple / mechanical / single-file) | T0.1, T0.2, T1.1, T1.2, T1.7 | Git worktree removal, new static files, one-line fs fix, simple unit tests for small modules. |

## Dependency graph

```
Phase 0 (gate):     T0.1 ──▶ (T0.2 optional, confirm-gated) ──▶ unblocks all waves
Wave 1 (parallel):  T1.1  T1.2  T1.3  T1.4  T1.5  T1.6  T1.7
Wave 2 (parallel):  T2.1 ──────┐        T2.2 (provides spawn-pool.ts → T2.1)
                                │
Wave 3:             T3.1 ◀── T2.1 + T2.2
                    T3.2 ◀── T2.1
                    T3.3 ◀── (decision in T4.2 / independent files)
Wave 4:             T4.1 ◀── ALL code+test packages
                    T4.2 ◀── T2.x/T3.x decisions
```

**Critical path:** T0.1 (gate) → T2.1 → T3.2/T3.1 → T4.1 → T4.2. Everything else parallelizes around it.
