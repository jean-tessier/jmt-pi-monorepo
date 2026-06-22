> **⚠️ STATUS: SUPERSEDED — The codebase is now fully implemented.**
> This implementation plan was written when the repo was greenfield. All 28 tasks (G1–G26)
> have been completed. This document is preserved for historical reference but does NOT
> reflect the current code. See `SPEC.md` for the normative spec and `DESIGN.md` for design
> rationale. The actual module layout closely follows the proposed layout in §2.

# Implementation Plan

> Generated: 2026-06-20 (updated 2026-06-22 to reflect completed implementation)
> Spec source(s): `SPEC.md` (v1, normative), `DESIGN.md` (subprocess internals + OQ-1/OQ-2/OQ-3), `SUBAGENT-EXTENSION-RESEARCH.md` (prior-art map)
> Codebase scanned: fully implemented (see `handoff.md` for the debugging session that fixed the final output extraction bug)
> Focus area: full v1 (subprocess backend, two single-purpose child providers)

This plan treats `SPEC.md` as authoritative and decomposes its §12 conformance
checklist into a dependency-ordered build. "Current State" is greenfield throughout;
where a mechanism can be adopted from `pi-subagents` rather than written from scratch,
the gap row says so. Module paths are **proposed** (no tree exists yet) and are fixed
here so tasks can reference exact files.

---

## 1. Gap Analysis

| # | Target Capability (SPEC) | Current State | Gap | Proposed Work | Status (Completed?) |
|---|---|---|---|---|---|
| G1 | Project is two loadable Pi extensions in a pnpm workspace: `pi-delegate` + `pi-structured-output`, peer deps pinned to `pi` 0.79.8, jiti entries (§3, header) | None | Whole scaffold absent | `pnpm-workspace.yaml` + two `package.json`; pin `pi` 0.79.8 | ✅ Implemented |
| G2 | Register exactly one `delegate` tool; parent `before_agent_start` capability note (§4.1, §4.2, Appendix A) | None | Tool + injection absent | `delegate` registration, param schema, description text | ✅ Implemented |
| G3 | Single-run + parallel param shapes, validation (§4.2) | None | Absent | Discriminated schema (`task` xor `parallel`), `INVALID_PARAMS` | ✅ Implemented |
| G4 | Subprocess execution: binary resolution, arg/env builder, `--mode json` spawn (§3.1–§3.3) | None | Absent | Resolve `pi`; build flags/env; spawn child process | ✅ Implemented |
| G5 | `--mode json` `AgentEvent` stream → `onUpdate` progress + final-message capture (§3.7, §3.8, §10) | None | Absent | Line parser; coarse progress; `agent_end`/`message_end` capture | ✅ Implemented |
| G6 | Per-run temp files (`prompt.md`/`schema.json`/`output.json`), `0700`/`0600`, outside child `cwd` (§3.5) | None | Absent | Temp-dir lifecycle + cleanup on ok/error/abort | ✅ Implemented |
| G7 | Agent-definition discovery (user+project scope, project-over-user) + frontmatter schema (§5) | None | Absent; frontmatter shape adoptable from pi-subagents | Glob discovery, YAML parse, validation, diagnostics | ✅ Implemented |
| G8 | Model/tools/prompt resolution with §8 precedence; builtins-only ceiling via `pi.getActiveTools()` (§8.1–§8.3) | None | Absent | Precedence resolver; tool intersection/ceiling; prompt composition | ✅ Implemented |
| G9 | Depth guard, default `2`, `min`-clamp down the tree (§7.1) | None | Absent; depth-env pattern adoptable | `PI_DELEGATE_DEPTH`/`_MAX_DEPTH` threading + gate | ✅ Implemented |
| G10 | Explicit agent-identity cycle detection + lineage path + cap backstop (§7.2) | None | Absent; lineage-path primitive adoptable from pi-subagents `nested-path.ts` | `PI_DELEGATE_PATH` build/sanitize; cycle check | ✅ Implemented |
| G11 | Capability gating by provider absence + non-forgeable per-child token (§3.4, §6) | None | Absent; gating-by-absence pattern adoptable | Token gen/blank; delegate provider arming | ✅ Implemented |
| G12 | **Delegate provider** (child-side `delegate`, token-armed) (§3.4) | None | Absent | Standalone child extension | ✅ Implemented |
| G13 | **Structured-output provider** (`structured_output`, schema-armed, no delegation code) (§3.4, §8.4) | None | Absent; structured-output-via-tool pattern adoptable from pi-subagents `structured-output.ts` | Standalone child extension; à-la-carte load | ✅ Implemented |
| G14 | `outputSchema` hard contract: schema in, `structured_output` out, TypeBox `Compile` validation parent-side (§3.8, §8.4) | None | Absent | Schema file plumbing; `PI_OUTPUT_*` env; validate-on-read | ✅ Implemented |
| G15 | `delegateAgents` immediate-target allowlist (§6) | None | Absent | Allowlist check → `TOOL_NOT_PERMITTED` | ✅ Implemented |
| G16 | Deterministic preflight ordering + full error taxonomy, refusals-as-results (§4.4, §4.5) | None | Absent | Ordered checks 1–8; result-shaped errors | ✅ Implemented |
| G17 | Parallel execution: ordered results, `concurrency`/`maxConcurrency`/`maxInFlightChildren`, `failFast`-on-error-only (§9) | None | Absent | Limiter; global in-flight cap; partial-tolerant results | ✅ Implemented |
| G18 | Cancellation: parent `signal` → `SIGTERM`/`SIGKILL`; `failFast` sibling abort (§3.7, §9) | None | Absent | AbortController wiring; process termination | ✅ Implemented |
| G19 | Untrusted child output returned as labeled tool-result, never as instruction (§10) | None | Absent | Result framing/labeling | ✅ Implemented |
| G20 | Config + env precedence (`config.json`, `PI_DELEGATE_MAX_DEPTH`, `piBinaryPath`) (§11) | None | Absent | Config loader + precedence | ✅ Implemented |
| G21 | Run timeout (`runTimeoutMs`) (§3.7, §10) | None | Absent | Per-run wall-clock budget | ✅ Implemented |
| G22 | DX: `/delegate` status/interrupt command, `doctor`, result rendering | None | Absent | Slash command + diagnostics | ✅ Implemented |
| G23 | Packaging/distribution: two packages `pi-delegate` + `pi-structured-output`, `install.mjs` (§3.4) | None | Decided (two packages) | Two publishable manifests; install script | ✅ Implemented |
| G24 | Docs: README + QUICK-START (research §5) | None | Absent | Author both | ✅ Implemented |
| G25 | Conformance suite mapped to §12 (1–10) | None | Absent | Test harness + cases | ✅ Implemented |
| G26 | Child bash/write trust model: confirm process inheritance, default `cwd` confinement for write-capable children, optional OS-sandbox hook (research **Q5**) | None | Absent — v1 ships bash/write agents | Close Q5 spike; confinement default; sandbox config knob | ✅ Implemented |

---

## 2. Plan Skeleton

**Stage 0 — Scaffold.** Make the repo a loadable Pi extension with pinned peer deps,
shared types, and config; nothing functional yet. (G1, G20)

**Stage 1 — MVP happy path.** A working single + parallel `delegate` that spawns real
`pi` subprocesses, applies model/tools/prompt, streams coarse progress, captures the
result via `--mode json`, and enforces the depth gate with a soft output directive.
No cycles, no capability token, no hard schema. (G2–G9, G17 partial)

**Stage 2 — Guards, capability, contracts.** Add cycle detection, the two child
providers, capability token + à-la-carte loading, the `outputSchema` hard contract,
`delegateAgents`, full preflight/error taxonomy, `min`-clamp precedence, cancellation,
untrusted-output labeling, and — since v1 ships `bash`/`write` agents — the child
trust model + sandbox hook. This is the stage that makes the build *conformant*.
(G10–G16, G18–G21, G26)

**Stage 3 — DX, packaging, docs, conformance.** `/delegate` command, `doctor`, result
rendering, timeout, two-package packaging + install, README/QUICK-START, and the §12
conformance suite. (G22–G25)

Proposed workspace layout (two packages; paths fixed here for task references):

```
pnpm-workspace.yaml                       # pnpm workspaces
package.json                              # workspace root (scripts, devDeps)
packages/
  pi-delegate/                            # parent extension + child-side delegate provider
    package.json
    src/
      parent/   index.ts delegate-tool.ts agents.ts resolve.ts guards.ts
                spawn.ts stream.ts tempfiles.ts parallel.ts config.ts result.ts command.ts doctor.ts
      delegate-provider/ index.ts
      shared/   types.ts lineage.ts schema.ts
    agents/                               # bundled default agent definitions
  pi-structured-output/                   # standalone structured-output provider
    package.json
    src/ index.ts
test/                                     # conformance + unit (workspace root)
install.mjs
README.md  QUICK-START.md
```

> Task `Files:` paths below are relative to `packages/pi-delegate/` **except** Task 15
> (the structured-output provider), which lives in `packages/pi-structured-output/`.
> `pi-structured-output` has no dependency on `pi-delegate` — its decoupling (no token,
> depth, or lineage) is what lets it be a clean standalone package.

---

## 3. Ordered Task List

### Stage 0 — Scaffold

- **Task 1** [S] ✅ — Workspace scaffold: `pnpm-workspace.yaml` + root `package.json`; `packages/pi-delegate/package.json` (`pi.extensions` for the parent + delegate-provider entry points) and `packages/pi-structured-output/package.json` (SO provider entry); `peerDependencies` pinned to **`pi` 0.79.8 (exact)**; shared tsconfig, jiti-compatible TS.
  - Closes gap(s): G1
  - Files: `pnpm-workspace.yaml`, `package.json`, `packages/pi-delegate/package.json`, `packages/pi-structured-output/package.json`, `tsconfig.json`, `packages/pi-delegate/src/parent/index.ts` (stub)
  - Depends on: none
- **Task 2** [S] ✅ — Shared types + config loader: `DelegationContext`, `NestedPathEntry`, run/result types; `config.json` read with defaults and `PI_DELEGATE_MAX_DEPTH`/`piBinaryPath` precedence (§11).
  - Closes gap(s): G20
  - Files: `src/shared/types.ts`, `src/parent/config.ts`
  - Depends on: Task 1

### Stage 1 — MVP happy path

- **Task 3** [M] ✅ — Agent discovery + frontmatter parse: user/project globs, project-over-user precedence, validation + non-fatal diagnostics (§5). Adopt frontmatter shape from pi-subagents.
  - Closes gap(s): G7
  - Files: `src/parent/agents.ts`
  - Depends on: Task 2 · [PARALLEL] with Task 4
- **Task 4** [M] ✅ — Resolution + precedence: model/tools/prompt per §8; tool ceiling via `pi.getActiveTools()` minus `delegate`; builtins-only allowlist; prompt composition order (§8.1–§8.3). Schema lever deferred to Stage 2.
  - Closes gap(s): G8
  - Files: `src/parent/resolve.ts`
  - Depends on: Task 2 · [PARALLEL] with Task 3
- **Task 5** [S] ✅ — Temp-file lifecycle (MVP subset): per-run `0700` dir, `prompt.md` `0600`, cleanup on ok/error/abort, placed outside child `cwd` (§3.5).
  - Closes gap(s): G6 (partial)
  - Files: `src/parent/tempfiles.ts`
  - Depends on: Task 2
- **Task 6** [M] ✅ — Binary resolution + arg/env builder: resolve `pi` (config → PATH → bundled), build flags incl. `--mode json`, `--model`, `--tools`, `--system-prompt`/`--append-system-prompt`, `--no-skills`, `--no-context-files`, `--no-session`; env with `PI_DELEGATE_DEPTH`/`_MAX_DEPTH` (§3.1–§3.3, depth only).
  - Closes gap(s): G4 (partial), G9 (env)
  - Files: `src/parent/spawn.ts`
  - Depends on: Task 4, Task 5
- **Task 7** [L] ✅ — Spawn + `--mode json` stream: process spawn, `stdout`/`stderr` capture, `AgentEvent` line parser, coarse `onUpdate` (turn/tool boundaries), final-message capture from `agent_end`/`message_end`, exit→status mapping (§3.7, §3.8, §10 streaming).
  - Closes gap(s): G5
  - Files: `src/parent/stream.ts`
  - Depends on: Task 6
- **Task 8** [M] ✅ — `delegate` tool (single) + parent injection: param schema (single shape), `execute` orchestration, `before_agent_start` capability note, tool/param descriptions (§4.1, §4.2 single, Appendix A).
  - Closes gap(s): G2, G3 (single)
  - Files: `src/parent/delegate-tool.ts`, `src/parent/index.ts`
  - Depends on: Task 3, Task 7
- **Task 9** [S] ✅ — Depth gate + minimal preflight: `depth >= maxDepth` → `DEPTH_BLOCKED` as a result before spawn; preflight skeleton (param shape, agent resolution, depth) (§7.1, §4.5 subset).
  - Closes gap(s): G9 (gate)
  - Files: `src/parent/guards.ts`
  - Depends on: Task 8
- **Task 10** [M] ✅ — Parallel fan-out: `parallel` param, `concurrency`/`maxConcurrency`/`maxInFlightChildren` limiter, ordered partial-tolerant results; `failFast` scaffold (full abort in Task 16) (§9, §4.2 parallel).
  - Closes gap(s): G3 (parallel), G17
  - Files: `src/parent/parallel.ts`, `src/parent/delegate-tool.ts`
  - Depends on: Task 8
- **Task 11** [XS] ✅ — Soft output directive: optional natural-language response-shape text appended to `task`/`prompt`; no validation (§8.4 lever 1).
  - Closes gap(s): G14 (soft)
  - Files: `src/parent/resolve.ts`
  - Depends on: Task 4

### Stage 2 — Guards, capability, contracts

- **Task 12** [M] ✅ — Lineage + cycle detection: `PI_DELEGATE_PATH` build + sanitize (no `..`/separators, `lineagePathCap`), agent-identity cycle check → `CYCLE_DETECTED`, cap backstop → `DEPTH_BLOCKED` (§7.2). Adopt `nested-path.ts`.
  - Closes gap(s): G10
  - Files: `src/shared/lineage.ts`, `src/parent/guards.ts`
  - Depends on: Task 9
- **Task 13** [S] ✅ — Capability token: per-authorized-child high-entropy token gen; blank `PI_DELEGATE_TOKEN`/`PI_OUTPUT_*` for ineligible children; env threading (§3.3, §6).
  - Closes gap(s): G11
  - Files: `src/parent/spawn.ts`, `src/shared/types.ts`
  - Depends on: Task 6
- **Task 14** [M] ✅ — Delegate provider: standalone child extension registering `delegate` iff valid `PI_DELEGATE_TOKEN`; reads depth/path; re-enters orchestration for grandchildren (§3.4, §6).
  - Closes gap(s): G12
  - Files: `delegate-provider/index.ts`
  - Depends on: Task 13 · [PARALLEL] with Task 15
- **Task 15** [M] ✅ — Structured-output provider: standalone child extension registering `structured_output` iff `PI_OUTPUT_SCHEMA` present; writes payload to `PI_OUTPUT_FILE`; carries no delegation code (§3.4, §8.4). Adopt `structured-output.ts` pattern.
  - Closes gap(s): G13
  - Files: `packages/pi-structured-output/src/index.ts`
  - Depends on: Task 5 · [PARALLEL] with Task 14
- **Task 16** [S] ✅ — À-la-carte provider loading + cancellation: select `--extensions` per grant (none/SO/delegate/both); wire parent `signal` → `SIGTERM`/`SIGKILL`; `failFast` sibling abort via shared `AbortController` (§3.2, §3.4, §3.7, §9).
  - Closes gap(s): G11 (loading), G18
  - Files: `src/parent/spawn.ts`, `src/parent/parallel.ts`
  - Depends on: Task 14, Task 15, Task 10
- **Task 17** [M] ✅ — `outputSchema` hard contract: validate schema-is-object preflight; write `schema.json`; pass `PI_OUTPUT_SCHEMA`/`PI_OUTPUT_FILE`; read+validate `output.json` (TypeBox `Compile`) → `structuredOutput` or `SCHEMA_INVALID` (§3.5, §3.8, §8.4).
  - Closes gap(s): G6 (schema files), G14 (hard)
  - Files: `src/shared/schema.ts`, `src/parent/tempfiles.ts`, `src/parent/stream.ts`
  - Depends on: Task 15, Task 7
- **Task 18** [S] ✅ — `delegateAgents` enforcement: immediate-target allowlist check in the delegate provider → `TOOL_NOT_PERMITTED` (§6).
  - Closes gap(s): G15
  - Files: `delegate-provider/index.ts`
  - Depends on: Task 14
- **Task 19** [M] ✅ — Full preflight + error taxonomy: ordered checks 1–8, all codes returned as results not thrown, per-spec in parallel (§4.4, §4.5).
  - Closes gap(s): G16
  - Files: `src/parent/guards.ts`, `src/parent/result.ts`
  - Depends on: Task 12, Task 17, Task 18
- **Task 20** [S] ✅ — `min`-clamp + full precedence: child ceiling = `min(parent, agent)`; per-call > def > project > user > default across fields (§7.1, §8).
  - Closes gap(s): G9 (clamp), G8 (full precedence)
  - Files: `src/parent/resolve.ts`, `src/parent/guards.ts`
  - Depends on: Task 4, Task 12
- **Task 21** [S] ✅ — Untrusted-output labeling: return child output as tool-result content with a `from agent "<name>"` label; never as instruction (§10).
  - Closes gap(s): G19
  - Files: `src/parent/result.ts`
  - Depends on: Task 7
- **Task 28** [M] ✅ — Child bash/write trust model (Stage 2; added because v1 ships bash/write agents): close the **Q5** spike (confirm what a child `pi` process inherits — uid, filesystem, network); default write/bash-capable children to per-child `cwd` confinement (§10); document the trust boundary (a child runs with the parent's OS permissions unless externally sandboxed); add an optional `sandboxCommand` config knob that wraps the spawn (e.g. `bwrap`/`firejail`), deferring built-in seccomp/landlock. Design rationale in `DESIGN.md` OQ-4.
  - Closes gap(s): G26
  - Files: `src/parent/spawn.ts`, `src/parent/config.ts`
  - Depends on: Task 16

### Stage 3 — DX, packaging, docs, conformance

- **Task 22** [S] ✅ — Run timeout: enforce `runTimeoutMs`, terminate child, return `TIMEOUT` (§3.7, §10).
  - Closes gap(s): G21
  - Files: `src/parent/spawn.ts`
  - Depends on: Task 16
- **Task 23** [M] ✅ — `/delegate` command + result rendering: status/interrupt surface; render child outcomes in the parent tool-call UI.
  - Closes gap(s): G22 (command, rendering)
  - Files: `src/parent/command.ts`
  - Depends on: Task 10 · [PARALLEL] with Task 24
- **Task 24** [S] ✅ — `doctor`: verify binary resolution + version pin, provider discovery, config sanity (§3.1).
  - Closes gap(s): G22 (doctor)
  - Files: `src/parent/doctor.ts`
  - Depends on: Task 6 · [PARALLEL] with Task 23
- **Task 25** [M] ✅ — Packaging + install: build/publish two packages — `pi-delegate` (parent + delegate provider) and `pi-structured-output` (standalone); `install.mjs`; bundled default agents (§3.4).
  - Closes gap(s): G23
  - Files: `install.mjs`, `packages/pi-delegate/package.json`, `packages/pi-structured-output/package.json`, `packages/pi-delegate/agents/*.md`
  - Depends on: Task 14, Task 15
- **Task 26** [M] ✅ — Docs: README (five capabilities, safety model, config, comparison vs pi-subagents) + QUICK-START (define agent → single → parallel → schema → nested → trigger a depth/cycle block).
  - Closes gap(s): G24
  - Files: `README.md`, `QUICK-START.md`
  - Depends on: Task 19, Task 25 · [PARALLEL] with Task 27
- **Task 27** [L] ✅ — Conformance suite: one test per §12 item (1–10), incl. negative guard tests (depth block, cycle block, tool-not-permitted, schema-invalid), parallel partial-failure, and a `cwd`-confinement check for write-capable children (G26).
  - Closes gap(s): G25, G26 (verification)
  - Files: `test/conformance/*.test.ts`
  - Depends on: Task 19, Task 21, Task 28 · [PARALLEL] with Task 26

---

## 4. Self-Critique & Reviewer Notes

**Assumptions made (verify before execution):**

- **Module tree is invented.** No code exists; the `src/parent` · `src/providers` ·
  `src/shared` split is a proposal. If you prefer pi-subagents' `runs/shared` layout,
  remap the file paths — task ordering and dependencies are unaffected.
- **Pi flag surface is pinned to 0.79.8 (exact)** per `DESIGN.md` OQ-1 verification.
  Tasks 6/16 assume `--mode json`, `--extensions` (plural array), `--no-extensions`,
  `--no-context-files`, `--no-skills`, `--no-session`, `--system-prompt`,
  `--append-system-prompt`, `--tools`, `--model` are all stable at 0.79.8 (research
  **Q3**, verified). The exact pin in Task 1 is the guard; a future `pi` upgrade is a
  deliberate, re-verified bump.
- **Decisions locked.** Names and packaging are settled: the parent extension is
  `pi-delegate` (registers `delegate`, and houses the child-side delegate provider);
  the structured-output provider is `pi-structured-output`, shipped as a **separate
  package**. `pi-structured-output` has no dependency on `pi-delegate`. These are
  reflected in Task 1 / Task 25 and the workspace layout above.
- **`PI_OUTPUT_SCHEMA`/`PI_OUTPUT_FILE` names are provisional** (`SPEC.md` §3.3). They
  are decoupled from the `PI_DELEGATE_*` namespace by design (option C); confirm no
  collision with host env before finalizing.
- **v1 ships `bash`/`write`-capable agents** (decided). This is consistent with the
  SPEC contract (§8.2 already lists `bash`/`write` as grantable builtins under the
  parent ceiling); the added work is the trust model + sandbox hook (Task 28, G26),
  not a contract change. Until the **Q5** spike in Task 28 confirms what a child
  process inherits, treat write/bash children as running with the parent's full OS
  permissions and rely on per-child `cwd` confinement.

**Confidence caveats:**

- **Task 7 (stream parsing) is the riskiest single item** (sized L). The exact
  `AgentEvent` shapes are known from the published types, but back-pressure, partial
  lines, and interleaved `stderr`/diagnostics need real-process testing. Budget slack.
- **Auth inheritance (`DESIGN.md` OQ-2) is assumed to "just work"** via host-env
  passthrough (§3.3). Validate against each provider's credential mechanism early
  (a 30-minute spike in Stage 1, not a blocker) so it doesn't surprise Task 6.
- **`pi-subagents` adoption is by-pattern, not by-dependency.** Rows that say "adoptable"
  mean the *approach* is proven; expect to re-implement against this spec's narrower
  surface rather than import code directly.

**What a human must verify before execution begins:**

All v1 scoping decisions are resolved (Pi 0.79.8 pin, pnpm workspaces, two packages
`pi-delegate` + `pi-structured-output`, ship `bash`/`write` agents). The remaining
unknowns are **scheduled spikes handled during the build**, not pre-execution blockers:

1. **Child process inheritance** (Q5) — confirmed inside Task 28 before write/bash
   children are trusted beyond `cwd` confinement.
2. **Provider/auth inheritance** (`DESIGN.md` OQ-2) — validated by an early Stage 1
   spike against each provider's credential mechanism (informs Task 6).
