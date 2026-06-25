# pi-delegate — Implementation Plan

> **SUPERSEDED NOTICE:** This document describes the original phased implementation plan
> produced during early design. The actual implementation may differ in task ordering,
> module names, and scope. For the authoritative description of shipped behavior, see
> `docs/SPEC.md`. This document is retained as a historical record of design intent.
>
> Notable divergence: the streaming/output-capture logic described as `src/parent/stream.ts`
> was implemented directly in `src/parent/spawn.ts` (no separate stream module).

---

## Goals

1. Expose a `delegate` tool that a parent Pi agent can call to spawn child Pi processes.
2. Support single-task and parallel fan-out delegation.
3. Enforce depth limits, cycle detection, and tool ceilings.
4. Validate structured output against JSON Schema (TypeBox).
5. Maintain a never-throw contract from the tool execute boundary inward.

---

## Phase 1 — Scaffold and core types

**Task 1 — Package scaffold**
- Create `packages/pi-delegate/` with `package.json`, `tsconfig.json`, `vitest.config.ts`.
- Declare dependencies: `@earendil-works/pi-coding-agent`, `typebox`, `jiti`.
- Entry point: `src/parent/index.ts`.

**Task 2 — Shared types**
- File: `src/shared/types.ts`
- Exports: `DelegateConfig`, `AgentDefinition`, `DelegateToolParams`, `ParallelTask`,
  `RunResult`, `RunStatus`, `DelegationContext`.

**Task 3 — Agent discovery**
- File: `src/parent/agents.ts`
- `findAgent(name)`: searches `.pi/agents/<name>.md`, then `~/.config/pi/agents/<name>.md`.
- Parses YAML frontmatter + body into `AgentDefinition`.

**Task 4 — Parameter resolution**
- File: `src/parent/resolve.ts`
- `resolveParams(input)`: merges agent-def fields + per-call overrides.
- `applyToolCeiling(requested, activeTools)`: removes `delegate`, intersects with ceiling.
- `resolveMaxDepth(configMaxDepth, agentMaxDepth)`: min-clamp.

---

## Phase 2 — Config and spawn

**Task 5 — Config loader**
- File: `src/parent/config.ts`
- `loadConfig()`: finds config file (precedence: `PI_DELEGATE_CONFIG_PATH` > `$PI_CONFIG_DIR/pi-delegate/config.json` > `~/.config/pi/pi-delegate/config.json`).
- Reads and validates: `maxDepth`, `piBinaryPath`, `runTimeoutMs`, `maxInFlightChildren`,
  `sandboxCommand`, `childCwd`. Applies env-variable overrides at highest precedence.

**Task 6 — Binary resolution and arg builder**
- File: `src/parent/spawn.ts`
- `resolvePiBinary(config)`: config path > `PI_DELEGATE_BINARY_PATH` > PATH search.
- `buildSpawnArgs(resolved, context)`: constructs argv and env for child process.

**Task 7 — Child process spawner and stdout parser**
- File: `src/parent/spawn.ts` (same file as Task 6)
- `spawnRun(binaryPath, args, tempFiles, options)`: spawns child, parses `--mode json` stdout
  line-by-line, captures output from `message_end` events (fallback to `agent_end.result`).
- Timeout: SIGTERM → SIGKILL after 5s; resolves with `{ output, exitCode: -1, timedOut: true }`.
- Abort: kills child, resolves with captured output so far.
- Child error (spawn failure): rejects; caller wraps in never-throw guard.

**Task 8 — Temp file lifecycle**
- File: `src/parent/tempfiles.ts`
- `createTempRunFiles(taskId, prompt, schema?)`: creates `/tmp/pi-delegate/<taskId>/` (mode 0o700),
  writes `prompt.md` (0o600), optionally writes `schema.json` (0o600).
- Returns `{ dir, promptFile, schemaFile, outputFile, cleanup }`.

---

## Phase 3 — Preflight, result formatting, and orchestration

**Task 9 — Preflight checks**
- File: `src/parent/guards.ts`
- `runPreflight(ctx)`: 8 ordered checks returning first failure.
  1. `task` non-empty string.
  2. `depth >= maxDepth`.
  3. Lineage path cap (50 entries).
  4. Cycle detection.
  5. `outputSchema` plain object check.
  6. Agent definition found check.
  7. `delegateAgents` allowlist check.
  8. Schema compilability check.

**Task 10 — Lineage path utilities**
- File: `src/shared/lineage.ts`
- `encodeLineagePath`, `decodeLineagePath`, `appendToPath`, `detectCycle`, `isPathAtCap`.
- Separator: `>`. Cap: 50 entries.

**Task 11 — Result formatters**
- File: `src/parent/result.ts`
- `formatOkResult(agentName, output)`: `from agent "<name>": <output>`
- `formatBlockedResult(code, message, agentName)`: `[BLOCKED:<CODE>] from agent "<name>": <message>`
- `formatStructuredResult(agentName, output)`: `from agent "<name>" (structured): <json>`

---

## Phase 4 — Tool registration and parallel fan-out

**Task 12 — Delegate tool registration**
- File: `src/parent/delegate-tool.ts`
- `activate(pi)`: registers `delegate` tool and `before_agent_start` hook.
- `executeSingle(params, pi, signal?, onUpdate?)`: full orchestration sequence (preflight →
  resolve → spawn → result).
- Never-throw wrapper catches all errors from `resolvePiBinary`, `spawnRun`, and JSON.parse.

**Task 13 — Parallel fan-out**
- File: `src/parent/parallel.ts`
- `runParallel(tasks, options, runner)`: fan-out with configurable concurrency and failFast.
- `executeParallel(params, pi, signal?, onUpdate?)` in `delegate-tool.ts`: normalizes parallel
  items, calls `runParallel`, joins results.

---

## Phase 5 — Extensions and structured output

**Task 14 — Delegate provider (child-side)**
- File: `src/delegate-provider/index.ts`
- Reads `PI_DELEGATE_TOKEN`; if empty, activates as a no-op.
- Registers the `delegate` tool for the child process using the same `activate()` from
  `delegate-tool.ts` via the capability token gate.

**Task 15 — Structured output support**
- Schema written to `schema.json`; paths conveyed via `PI_OUTPUT_SCHEMA` and `PI_OUTPUT_FILE`
  env vars (no `--output-file` CLI flag).
- After a successful run, parent reads `output.json`, validates with TypeBox.

**Task 16 — Extension path selection**
- `selectExtensions(agentDef, hasToken)` in `delegate-tool.ts`:
  - Always includes `pi-structured-output` provider.
  - Includes delegate provider only when child has a non-empty token.

---

## Phase 6 — Safety, commands, and utilities

**Task 17 — Doctor command**
- File: `src/parent/doctor.ts`
- `runDoctor()`: checks binary path, config validity, extension wiring.

**Task 18 — Cancel registry and /delegate command**
- File: `src/parent/cancel-registry.ts` — process-wide `AbortController` registry.
- File: `src/parent/command.ts` — `/delegate status`, `/delegate cancel`, `/delegate doctor`.

**Task 19 — Sandbox wrapping**
- `wrapWithSandbox(binaryPath, args, sandboxCommand?)` in `src/parent/spawn.ts`:
  splits `sandboxCommand` on whitespace, prepends sandbox binary + args before pi binary + args.

---

## Phase 7 — Documentation

**Task 20 — SPEC.md**
- File: `docs/SPEC.md` (this was created in T4.2 to reflect the actual shipped behavior).

**Task 21 — README.md**
- File: `README.md` — user-facing install, config, and usage guide.

---

## Known divergences from this plan

| Plan reference | Actual implementation |
|---|---|
| `src/parent/stream.ts` (streaming/stdout parser) | Logic lives in `src/parent/spawn.ts`; no separate stream module. |
| `--output-file` CLI flag | Never implemented; structured output paths use `PI_OUTPUT_FILE` env var exclusively. |
| Config governs model/tools/prompt | Not implemented in 0.1.0; config governs only depth/timeouts/binary/sandbox/cwd. |
| MUST trim/dedup tool list | Downgraded to SHOULD for 0.1.0; callers are responsible for clean tool lists. |
