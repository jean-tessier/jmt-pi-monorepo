# pi-delegate — Specification (v0.1.0)

> **Scope:** This document specifies the observable behavior of `pi-delegate` version 0.1.0.
> It is the authoritative reference for correctness checks, conformance tests, and code review.
> Implementation details (file layout, internal data structures) live in source comments and
> `IMPLEMENTATION-PLAN.md`.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Distribution model](#2-distribution-model)
3. [Delegate tool](#3-delegate-tool)
   - [3.1 Single-task mode](#31-single-task-mode)
   - [3.2 Child process invocation](#32-child-process-invocation)
   - [3.3 Result format](#33-result-format)
   - [3.4 Extension loading](#34-extension-loading)
4. [Parallel fan-out mode](#4-parallel-fan-out-mode)
   - [4.1 Parameters](#41-parameters)
   - [4.2 Concurrency](#42-concurrency)
   - [4.3 Result format](#43-result-format)
   - [4.4 Error handling](#44-error-handling)
5. [Preflight checks](#5-preflight-checks)
6. [Depth and cycle safety](#6-depth-and-cycle-safety)
7. [Cancellation](#7-cancellation)
8. [Configuration layers](#8-configuration-layers)
   - [8.1 Config file fields (0.1.0 scope)](#81-config-file-fields-010-scope)
   - [8.2 Tool resolution and ceiling](#82-tool-resolution-and-ceiling)
   - [8.3 Prompt composition](#83-prompt-composition)
   - [8.4 Structured output](#84-structured-output)
9. [Environment variables](#9-environment-variables)
10. [Agent discovery](#10-agent-discovery)
11. [Error taxonomy](#11-error-taxonomy)
12. [Spawn layer contract](#12-spawn-layer-contract)
13. [Capability tokens and trust](#13-capability-tokens-and-trust)

---

## §1 Overview

`pi-delegate` is a Pi extension that lets an agent delegate focused sub-tasks to isolated
child Pi processes (called "sub-agents"). It exposes a `delegate` tool that the parent agent
calls, and a delegate-provider extension loaded into child processes that allows recursive
delegation within the configured depth limit.

Key invariants that hold for all paths through the system:

- **Never-throw contract.** The `delegate` tool execute function MUST NOT throw to the Pi
  framework. All errors — binary not found, spawn failure, timeout, non-zero exit — are
  returned as labeled result strings. Exceptions are caught and converted internally.

- **Depth safety.** Every delegation checks the current depth against `maxDepth`; a child that
  would exceed the cap receives a `[BLOCKED:DEPTH_BLOCKED]` result before any process is spawned.

- **Cycle detection.** If a named agent appears more than once in the current lineage path,
  the delegation is blocked with `[BLOCKED:CYCLE_DETECTED]` before spawning.

- **Tool ceiling.** Children can only receive tools that the parent has active. The `delegate`
  tool itself is always removed from the child's tool list.

---

## §2 Distribution model

`pi-delegate` ships as TypeScript source files and uses `jiti` for runtime transpilation.
There is no build step and no `dist/` directory. This is an intentional choice for 0.1.0
that trades a build step for simplicity, at the cost of a `jiti` runtime dependency.

The extension entry point is `src/parent/index.ts`, which Pi loads via `jiti` when the
extension path is configured in `~/.config/pi/settings.json`.

---

## §3 Delegate tool

### §3.1 Single-task mode

**Parameters (single-task):**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task` | string | YES | Task description passed to the child agent as a positional arg |
| `agent` | string | no | Named agent definition (from `.pi/agents/` or `~/.config/pi/agents/`). Omit for default agent. |
| `model` | string | no | Model override for this sub-task |
| `tools` | string[] | no | Tool allowlist for the sub-agent. Must be a subset of parent's active tools. |
| `prompt` | string | no | Custom system prompt (see §8.3 for compose rules) |
| `promptMode` | `'replace'` \| `'append'` | no | How `prompt` interacts with the agent definition's prompt. Default: `'replace'`. |
| `outputSchema` | object | no | JSON Schema to enforce structured output |

**Execution sequence:**

1. Read `PI_DELEGATE_DEPTH` from env (default 0).
2. Load config via `loadConfig()`.
3. Look up the named agent definition (if `agent` is specified).
4. Run preflight checks (§5). Return a blocked result on any failure.
5. Resolve effective parameters (§8.2, §8.3).
6. Apply tool ceiling check — if any requested tool is outside the parent's active tool set,
   return `[BLOCKED:TOOL_NOT_PERMITTED]`.
7. Create temp run directory with `prompt.md` (and `schema.json` if `outputSchema` is set).
8. Resolve the pi binary path (§12).
9. Generate a capability token for this child.
10. Build argv and env via `buildSpawnArgs()`.
11. Spawn the child process via `spawnRun()`.
12. If `outputSchema` is set and exit code is 0, read and validate `output.json`.
13. Return a labeled result string.

**SPAWN_FAILED:** If the pi binary cannot be found or spawned, the delegate tool MUST return
`[BLOCKED:SPAWN_FAILED] from agent "<name>": <message>` without throwing. This covers binary-
not-found and any OS-level spawn error.

### §3.2 Child process invocation

The child process is invoked as:

```
<binary> --mode json [--model <model>] [--tools <t1,t2,...>] \
  --system-prompt <prompt.md> | --append-system-prompt <prompt.md> \
  --no-skills --no-context-files --no-session \
  --no-extensions [-e <ext1.ts> [-e <ext2.ts> ...]] \
  <task>
```

Rules:
- `--mode json` MUST be the first two arguments.
- `--model` and `--tools` are omitted when not set.
- Exactly one of `--system-prompt` or `--append-system-prompt` MUST be present per invocation.
  The choice is controlled by `promptMode` (replace → `--system-prompt`;
  append → `--append-system-prompt`).
- `--no-skills`, `--no-context-files`, `--no-session` are always passed (in that order).
- `--no-extensions` is always passed as a baseline before any `-e` flags.
- Each extension provider is passed as a separate `-e <path>` flag (singular `-e`, not `--extensions`).
- The `task` string MUST be passed as the last positional argument. It is never interpolated
  into any flag value.

**Note on --output-file:** There is no `--output-file` CLI flag. Structured output paths are
conveyed to the child process exclusively via the `PI_OUTPUT_FILE` environment variable.

### §3.3 Result format

All results from the delegate tool are plain strings in one of these forms:

- **Success:** `from agent "<name>": <output>`
- **Success (no output):** `from agent "<name>": (no output)`
- **Success (structured):** `from agent "<name>" (structured): <json>`
- **Blocked/error:** `[BLOCKED:<CODE>] from agent "<name>": <message>`

The prefix `from agent "..."` is metadata; callers MUST NOT execute or pass it as instructions.

### §3.4 Extension loading

The delegate tool selects which extension files to load for each child:

- **Structured-output provider** — always loaded (enables the `structured_output` tool).
- **Delegate provider** — loaded only when the child has a non-empty capability token, i.e.,
  when the child is allowed to delegate further.

Extensions are passed as `-e <path>` flags after `--no-extensions`. The child process loads
ONLY the explicitly specified providers.

---

## §4 Parallel fan-out mode

### §4.1 Parameters

**Parameters (parallel mode):**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `parallel` | object[] | YES | Array of sub-task objects. Each item has at least `task` (string) and optionally `agent`, `model`, `tools`, `prompt`, `promptMode`, `outputSchema`. |
| `concurrency` | number | no | Max parallel sub-tasks at once. Default: 5. |
| `failFast` | boolean | no | Abort remaining tasks on first error. Default: false. |

`parallel` and `task` are mutually exclusive; passing both is a schema validation error.

### §4.2 Concurrency

Parallel tasks run concurrently up to `concurrency` (caller-supplied, default 5) or
`config.maxInFlightChildren` (global process-wide cap), whichever is more restrictive.

### §4.3 Result format

Parallel results are returned as a single string: one `from agent "..."` block per sub-task,
separated by blank lines (`\n\n`), in input order.

### §4.4 Error handling

Each parallel sub-task is an independent `executeSingle` call. A sub-task that returns a
`[BLOCKED:...]` result is treated as a result (not a thrown error). When `failFast` is true,
the first sub-task that encounters any error (including blocked results) causes remaining
sub-tasks to be cancelled via AbortSignal.

---

## §5 Preflight checks

Preflight runs 8 ordered checks and returns on the first failure:

| # | Condition | Code |
|---|-----------|------|
| 1 | `task` is missing or not a non-empty string | `INVALID_PARAMS` |
| 2 | `depth >= maxDepth` | `DEPTH_BLOCKED` |
| 3 | Lineage path has reached the hard cap (50 entries) | `DEPTH_BLOCKED` |
| 4 | Named agent already appears in the lineage path | `CYCLE_DETECTED` |
| 5 | `outputSchema` is provided but is not a plain object | `SCHEMA_INVALID` |
| 6 | `agent` is specified but the definition file was not found | `INVALID_PARAMS` |
| 7 | Target agent is not in the parent's `delegateAgents` allowlist | `TOOL_NOT_PERMITTED` |
| 8 | `outputSchema` cannot be compiled by TypeBox | `SCHEMA_INVALID` |

All preflight failures produce a `[BLOCKED:<CODE>]` result; none throw.

---

## §6 Depth and cycle safety

### Depth

- `PI_DELEGATE_DEPTH` (integer) tracks the current nesting level. Top-level agents have depth 0.
  A child is spawned with `PI_DELEGATE_DEPTH = parent_depth + 1`.
- `maxDepth` comes from config (default 2) or a per-agent definition override (whichever is
  lower — the agent definition cannot raise the cap above config).
- A call at `depth >= maxDepth` is blocked before spawning.

### Lineage path

The lineage path (`PI_DELEGATE_PATH`) is a `>`-separated string of agent names. The parent
appends the current agent's name before spawning the child:

```
root > agent-a > agent-b
```

The lineage path has a hard cap of 50 entries (`LINEAGE_PATH_CAP`). When the cap is reached,
delegation is blocked with `DEPTH_BLOCKED` regardless of the configured `maxDepth`.

### Cycle detection

If the named agent's name already appears anywhere in the lineage path, the call is blocked
with `CYCLE_DETECTED` before spawning. This prevents infinite recursion when a chain of agents
loops back to an agent already in the ancestry.

---

## §7 Cancellation

Each delegation creates an `AbortController`. If the parent provides an `AbortSignal` (forwarded
from the Pi framework), the child's abort controller is linked so that parent cancellation
propagates to the child's spawn.

When a child is aborted:
- `SIGTERM` is sent immediately; if the child is still alive after 5 seconds, `SIGKILL` is sent.
- `spawnRun` resolves with whatever output was captured up to the abort point.

The `/delegate cancel` command calls `cancelRegistry.abortAll()`, which cancels all in-flight
delegations for the current process.

---

## §8 Configuration layers

> **0.1.0 scope note:** In 0.1.0, the config file governs only the fields listed in §8.1
> (depth, timeouts, binary path, sandbox command, and child cwd). Config-file layers for
> model, tools, and system prompt are **not implemented** and are reserved for a future
> release. Model, tools, and prompt are per-call and per-agent-definition concerns only.

### §8.1 Config file fields (0.1.0 scope)

The config file is a JSON object. Only the following fields are read; all others are ignored:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxDepth` | positive integer | 2 | Maximum delegation depth. |
| `piBinaryPath` | string | (from PATH) | Override path to the `pi` binary. |
| `runTimeoutMs` | positive integer | 600000 | Wall-clock timeout (ms) per child run. |
| `maxInFlightChildren` | positive integer | (no limit) | Global concurrency cap. |
| `sandboxCommand` | string | (none) | Space-separated OS-level sandbox command prefix (e.g. `firejail --quiet`). |
| `childCwd` | string | (auto temp dir) | Override the child's working directory. |

**Config file location precedence (first match wins):**

1. `PI_DELEGATE_CONFIG_PATH` env var (explicit path to config file).
2. `$PI_CONFIG_DIR/pi-delegate/config.json` (if `PI_CONFIG_DIR` is set and the file exists).
3. `~/.config/pi/pi-delegate/config.json` (default).

Invalid JSON in the config file is silently ignored (defaults are used with a console warning).
Unknown config fields are silently ignored.

**Child working directory:** When no explicit `childCwd` is configured (either via config file
or `PI_DELEGATE_CHILD_CWD`), the child's working directory is the temp run directory
(`/tmp/pi-delegate/<taskId>/`). This directory contains `prompt.md` and, when structured
output is used, `schema.json` and `output.json`. To give the child an isolated workspace that
does not contain these files, configure an explicit `childCwd`.

### §8.2 Tool resolution and ceiling

Tool resolution order (later wins):

1. Agent definition `tools` field.
2. Per-call `tools` parameter.

The resolved tool list is then subject to the ceiling:

- The `delegate` tool is always removed from the child's tool list (the child does not
  auto-inherit the ability to delegate).
- If the parent has a non-empty active tool set, the child's tool list is intersected with it.
  Any child request for a tool outside the ceiling returns `[BLOCKED:TOOL_NOT_PERMITTED]`.

> **0.1.0 advisory:** The implementation SHOULD trim and deduplicate the tool list before
> applying the ceiling, but does not do so in 0.1.0. Callers are responsible for providing
> a clean (no leading/trailing whitespace, no duplicates) tool list. A caller passing
> `[' bash ', 'bash']` will see both entries passed through unmodified.

### §8.3 Prompt composition

| `promptMode` | Result |
|---|---|
| `'replace'` (default) | Per-call `prompt` replaces the agent definition's `systemPrompt`. |
| `'append'` | Per-call `prompt` is appended to the agent definition's `systemPrompt` with `\n\n` separator. |

If `outputSchema` is set, a soft output directive is automatically appended to the composed
system prompt:

```
When you have completed the task, call the structured_output tool with your result matching the provided schema.
```

### §8.4 Structured output

When `outputSchema` is provided:

1. A `schema.json` is written to the temp run directory.
2. `PI_OUTPUT_SCHEMA` env var is set to the `schema.json` path.
3. `PI_OUTPUT_FILE` env var is set to the `output.json` path.
4. After a successful (exit code 0) run, `output.json` is read and validated against the schema
   using TypeBox.
5. On validation success: `from agent "<name>" (structured): <json>`.
6. On validation failure or missing file: `[BLOCKED:SCHEMA_INVALID]`.

---

## §9 Environment variables

### Variables read by the parent

| Variable | Description |
|----------|-------------|
| `PI_DELEGATE_DEPTH` | Current nesting depth (integer, default 0). |
| `PI_DELEGATE_MAX_DEPTH` | Maximum allowed depth (integer). |
| `PI_DELEGATE_PATH` | Lineage path (`>`-separated agent names). |
| `PI_DELEGATE_TOKEN` | Capability token authorizing this process to use the delegate provider. Empty for unauthorized processes. |
| `PI_DELEGATE_AGENTS` | JSON array of agent names this process is allowed to delegate to. Empty string means no restriction. |
| `PI_DELEGATE_BINARY_PATH` | Override the `pi` binary path (higher precedence than config file). |
| `PI_DELEGATE_CONFIG_PATH` | Explicit path to the config JSON file. |
| `PI_DELEGATE_MAX_DEPTH` | Override `maxDepth` (higher precedence than config file). |
| `PI_DELEGATE_RUN_TIMEOUT_MS` | Override `runTimeoutMs` (higher precedence than config file). |
| `PI_DELEGATE_CHILD_CWD` | Override `childCwd` (higher precedence than config file). |

### Variables set by the parent on each child

| Variable | Value |
|----------|-------|
| `PI_DELEGATE_DEPTH` | `parent_depth + 1` |
| `PI_DELEGATE_MAX_DEPTH` | Effective max depth for the child |
| `PI_DELEGATE_PATH` | Updated lineage path with parent agent appended |
| `PI_DELEGATE_TASK_ID` | UUID for this run |
| `PI_DELEGATE_TOKEN` | Capability token (or empty string for ineligible children) |
| `PI_DELEGATE_AGENTS` | JSON-serialized agent allowlist (or empty string) |
| `PI_OUTPUT_FILE` | Absolute path to `output.json` (or empty string if no schema) |
| `PI_OUTPUT_SCHEMA` | Absolute path to `schema.json` (or empty string if no schema) |

---

## §10 Agent discovery

Agent definitions are `.md` files loaded from two locations:

1. `.pi/agents/` in the current working directory (project-local agents).
2. `~/.config/pi/agents/` (user-global agents).

Project-local agents take precedence over user-global agents when names collide.

Agent definitions use YAML frontmatter to specify fields:

```yaml
---
name: my-agent
description: Specialist agent for X
model: google/gemini-2.5-flash-001
tools:
  - read
  - bash
delegateAgents:
  - sub-agent-name
maxDepth: 1
---
System prompt body goes here.
```

The agent's body (after the frontmatter) becomes the `systemPrompt` used when `promptMode`
is `'replace'` (or when no per-call `prompt` is provided).

---

## §11 Error taxonomy

All error results are strings matching the pattern:
`[BLOCKED:<CODE>] from agent "<name>": <message>`

| Code | Meaning |
|------|---------|
| `DEPTH_BLOCKED` | Delegation would exceed `maxDepth` or the lineage path cap. |
| `CYCLE_DETECTED` | The target agent already appears in the lineage path. |
| `TOOL_NOT_PERMITTED` | Requested tool is outside the parent's active tool ceiling, or target agent is outside the `delegateAgents` allowlist. |
| `INVALID_PARAMS` | Missing or malformed parameters (e.g. empty `task`, agent not found). |
| `SCHEMA_INVALID` | `outputSchema` is not a plain object, cannot be compiled, or the child's output failed validation. |
| `TIMEOUT` | The child process exceeded `runTimeoutMs`. |
| `ERROR` | The child process exited with a non-zero exit code. |
| `SPAWN_FAILED` | The pi binary could not be found or the child process could not be spawned. |

---

## §12 Spawn layer contract

### Binary resolution

Binary resolution order (first match wins, error if the match is not executable):

1. `config.piBinaryPath` (from config file).
2. `PI_DELEGATE_BINARY_PATH` env var.
3. `pi` found in `PATH`.

If no executable `pi` is found, an error is thrown (caught by the never-throw wrapper and
returned as `[BLOCKED:SPAWN_FAILED]`).

### spawnRun contract

`spawnRun` is the low-level spawn wrapper. It:

- Spawns the child with `stdio: ['ignore', 'pipe', 'pipe']`.
- Parses `stdout` line-by-line as `--mode json` events.
- Captures the final text output from `message_end` events (falling back to `agent_end.result`).
- Accumulates `stderr` but never causes rejection due to stderr content.
- **On success:** resolves with `{ output: string, exitCode: number, timedOut: false }`.
- **On timeout:** resolves with `{ output: string, exitCode: -1, timedOut: true }`. A timed-out
  child is killed with SIGTERM → SIGKILL after 5 seconds. The caller (`executeSingle`) maps
  `timedOut: true` to `[BLOCKED:TIMEOUT]`.
- **On abort signal:** kills the child and resolves with captured output so far.
- **On child error (binary not found / spawn failure):** rejects with the OS error; the
  caller catches this and returns `[BLOCKED:SPAWN_FAILED]`.
- **Does NOT call `TempRunFiles.cleanup()`** — cleanup is the caller's responsibility.

### Sandbox wrapping

When `sandboxCommand` is configured, the binary and arguments are prefixed with the sandbox
command parts. Example: `sandboxCommand: 'firejail --quiet'` produces:

```
firejail --quiet /path/to/pi --mode json ... <task>
```

### Exit code mapping

- Exit code 0 → success.
- Any non-zero exit code → `[BLOCKED:ERROR]`.

---

## §13 Capability tokens and trust

Each delegation generates a cryptographically random 256-bit capability token (64 hex chars)
using `crypto.randomBytes(32)`. This token is passed to the child as `PI_DELEGATE_TOKEN`.

The child's delegate-provider extension checks `PI_DELEGATE_TOKEN` at activation time. If the
token is empty or absent, the delegate provider is not loaded (or registers as inactive), and
the child cannot make further delegations.

The `delegateAgents` field in an agent definition constrains which sub-agents that agent may
delegate to. The allowlist is passed as `PI_DELEGATE_AGENTS` (JSON-serialized string array).
An empty string means no restriction; a non-empty array is enforced at preflight check 7.
