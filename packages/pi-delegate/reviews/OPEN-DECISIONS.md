# pi-delegate — Open Decision Record

> Captured by T3.3 (Wave 3). These decisions were made by the Orchestrator to resolve
> ambiguities identified during the MASTER-REVIEW and encoded in the RESOLUTION-PLAN.
> T4.2 must propagate each decision into `docs/SPEC.md`.

---

## Decision F1 / C5 — Config precedence layers

**Finding:** SPEC §8 claims config governs model/tools/prompt defaults (project-level and
user-level config layers). The implementation (`src/parent/config.ts`) does not implement
these layers.

**Option chosen:** NARROW SPEC

**Rationale:** Adding model/tools/prompt config layers is new feature work with non-trivial
design surface (merge semantics, per-agent overrides, env interaction). The existing
implementation correctly handles the safety-critical subset — depth, timeouts, binary path,
sandbox command, and child cwd — which is the right scope for 0.1.0. Implementing the
broader config layers now would expand scope and risk for the initial release.

**Implementation confirmation:** `src/parent/config.ts` reads and validates only these fields:
- `maxDepth` (positive integer)
- `piBinaryPath` (string)
- `runTimeoutMs` (positive integer)
- `maxInFlightChildren` (positive integer)
- `sandboxCommand` (string)
- `childCwd` (string)

No model, tools, or systemPrompt fields are read from config. This is correct for 0.1.0.

**What T4.2 must update in `docs/SPEC.md`:**
- Remove or amend the §8 claim that config governs model/tools/prompt defaults.
- Replace with a narrowed statement: config governs only `maxDepth`, `runTimeoutMs`,
  `piBinaryPath`, `sandboxCommand`, and `childCwd`. Model, tools, and prompt are
  per-call and per-agent-definition concerns only, not config-file concerns.
- Add a note that project/user config layers for model/tools/prompt are deferred post-0.1.0.

---

## Decision F2 / D11 — Tools list normalization

**Finding:** SPEC §8.2 contains a `MUST` requiring the tools list to be trimmed and
deduplicated before use.

**Option chosen:** DOWNGRADE SPEC MUST to SHOULD

**Rationale:** The implementation gap is low-risk — trim/dedup is caller responsibility and
no bug has been filed for malformed input. Implementing trim/dedup in the library would be
a defensive measure, not a correctness fix for any known failure mode. Downgrading to
`SHOULD` defers the work without breaking any contract a real caller depends on.

**Implementation confirmation:** `src/parent/resolve.ts` does NOT perform trim or dedup
on the tools list. The `applyToolCeiling` function:
1. Filters out the string `'delegate'` (exact match, no trim)
2. If `activeTools` is non-empty, intersects with it

Neither operation normalizes whitespace nor removes duplicates. A caller passing
`[' bash ', 'bash']` would produce `[' bash ', 'bash']` in the resolved params (minus
ceiling filtering), not `['bash']`.

**What T4.2 must update in `docs/SPEC.md`:**
- Change §8.2: lower `MUST trim and deduplicate the tools list` to
  `SHOULD trim and deduplicate the tools list` (or equivalent phrasing such as
  "callers are expected to pass a normalized list").
- Add a note that the implementation does not perform normalization in 0.1.0 and this
  is caller responsibility.

---

## Decision E2 — Distribution model

**Finding:** The package ships TypeScript source and relies on `jiti` for runtime
transpilation rather than building to a `dist/` directory. This was flagged as an
undocumented choice (X7 in MASTER-REVIEW).

**Option chosen:** DOCUMENT AS INTENTIONAL (TS-source-via-jiti)

**Rationale:** T1.4 already documented this decision in `README.md`. The choice trades
a build step for simplicity at the cost of a runtime dependency on `jiti`. This is
appropriate for 0.1.0 where the toolchain is still being established.

**What T4.2 must update in `docs/SPEC.md`:**
- No SPEC edit required. The distribution decision is documented in `README.md` (by T1.4).
- If SPEC §1 or §2 describes a compiled distribution, update it to reflect the
  TS-source-via-jiti model.

---

## Decision A1 — Timeout contract shape

**Finding:** `spawnRun` had a dead-code timeout path (signal fired after the process
already exited). The question was whether `spawnRun` should resolve with a `timedOut`
flag or propagate a thrown exception for callers to catch.

**Option chosen:** RESOLVE WITH `timedOut` FLAG

**Rationale:** Resolves-with-timedOut keeps `spawnRun` consistent with the never-throw
contract (a core invariant of pi-delegate). Callers that want to distinguish timeout from
normal exit inspect the returned `timedOut` boolean; `executeSingle` maps `timedOut: true`
to a `[BLOCKED:TIMEOUT]` result. This was implemented in T2.1.

**Implementation status:** Already implemented by T2.1 (`spawnRun` resolves with
`{ output, exitCode, timedOut }`; `executeSingle` maps `timedOut → BLOCKED:TIMEOUT`).

**What T4.2 must update in `docs/SPEC.md`:**
- Confirm that the timeout section accurately describes `spawnRun` resolving with a
  `timedOut` boolean rather than throwing.
- If §8 or the spawn section describes an exception-based timeout, replace with the
  resolved-value shape: `{ output: string, exitCode: number, timedOut: boolean }`.
- Ensure the SPEC states that a timed-out child returns `[BLOCKED:TIMEOUT]` (not an
  unhandled exception or process exit).

---

## Summary for T4.2

| Decision | Finding | Chosen option | SPEC change needed |
|---|---|---|---|
| F1 / C5 | Config governs model/tools/prompt (SPEC §8) | Narrow SPEC | Remove model/tools/prompt from config scope; note deferred |
| F2 / D11 | Tools MUST be trim/deduped (SPEC §8.2) | Downgrade to SHOULD | Change MUST → SHOULD; note caller responsibility |
| E2 | Distribution model undocumented | Document TS-via-jiti | Check §1/§2 for compiled-dist assumptions; README already updated |
| A1 | Timeout contract shape | Resolve with `timedOut` flag | Confirm spawn section matches resolved-value shape |
