# Handoff — Testing Delegation After Pi Restart

## Objective

Test the `delegate` tool end-to-end after restarting Pi so the extension cache picks up the JSON output parsing fix.

## What happened this session

### Context

We explored the **my-pi-monorepo** codebase (a pnpm monorepo with `pi-delegate` and `pi-structured-output` packages). I delegated sub-agent analysis to review the codebase and produced an abstract (`handoff.md` was then written separately for continuity).

### The delegation test

When I called `delegate` with a read-only task (read a file and report), the tool **responded successfully** — but returned `(no output)` for the child's result. This prompted investigation.

### Root cause

The `--mode json` stream parser in `packages/pi-delegate/src/parent/spawn.ts` extracts child output from the wrong fields. The actual `pi --mode json` event format has:

- `message_end` → output nested at **`message.content[N].text`** (not a top-level `content` string)
- `agent_end` → output nested at **`messages[N].content[N].text`** (not a `result` field)

The parser was looking for:

```ts
// old (broken):
event.content       // on message_end — undefined, doesn't exist
event.result        // on agent_end — undefined, doesn't exist
```

### What was fixed

In `packages/pi-delegate/src/parent/spawn.ts`:

1. **AgentEvent type definitions** — corrected `message_end` to expect `{ message?: { content?: Array<{ type: string; text?: string }> } }` and `agent_end` to expect `{ messages?: Array<...> }`.

2. **message_end handler** — now extracts text from `event.message.content` array, filtering for `type === 'text'` parts and joining them.

3. **agent_end handler** — now also tries extracting from `event.messages` array (finds the `assistant` message, extracts text content parts) as a fallback.

### What else is confirmed working

These pipeline stages all completed without error:

| Component | Status |
|-----------|--------|
| `delegate` tool registration | ✅ |
| Before-agent-start capability note injection | ✅ |
| Preflight checks (depth, params, agent resolution) | ✅ |
| Config loading | ✅ |
| Agent definition lookup (DEFAULT_AGENT fallback) | ✅ |
| `pi` binary resolution | ✅ (found at `/opt/homebrew/bin/pi`) |
| Spawn args and env builder | ✅ |
| Child process spawn | ✅ |
| `--mode json` child execution | ✅ (verified by running `pi --mode json` directly) |
| Child clean exit (code 0) | ✅ |
| Temp file creation and cleanup | ✅ |
| Labeled result (prefix `from agent "..."`) | ✅ |
| Install script (copies to `~/.config/pi/extensions/`) | ✅ |

## What to test next session

### After Pi restart

1. **Basic delegation** — call `delegate` with `task: "Read file /path/to/file"` and `tools: ["read"]`. Should now return the file's content instead of `(no output)`.

2. **Multiple models** — try with different `model` overrides like `google/gemini-2.5-flash-001` or the default parent model.

3. **Parallel fan-out** — run 2-3 read tasks in parallel with `parallel` array and observe ordered results.

4. **Depth guard** — confirm depth limit is enforced (default `maxDepth=2`).

5. **Cycle detection** — define an agent that delegates to itself and confirm `CYCLE_DETECTED` result.

### If the fix still doesn't work

If `(no output)` persists after restart, check:

- Whether Pi loaded the updated extension files from `~/.config/pi/extensions/pi-delegate/src/parent/spawn.ts` (verify the file contains the new parsing logic).
- If the extension uses a compiled/bundled entry point rather than direct `.ts` files — the `package.json` `pi.extensions` field should point at the source `.ts` files so `jiti` can load them fresh.
- Run `pi --mode json "simple task" 2>&1` directly and inspect the JSON output to confirm the event format hasn't changed.

## Files changed

| File | Change |
|------|--------|
| `packages/pi-delegate/src/parent/spawn.ts` | Fixed AgentEvent types and message_end/agent_end output extraction |
| `packages/pi-delegate/src/parent/delegate-tool.ts` | Replaced flat `Type.Object` schema with `Type.Union([...])` (2 branches: single-task + parallel); added `failFast` param; added string normalization in `executeParallel`; added `additionalProperties: false` to both branches |
| `packages/pi-delegate/src/shared/types.ts` | Added `failFast?: boolean` to parallel branch of `DelegateToolParams` |
| `packages/pi-delegate/test/conformance/parallel.test.ts` | **New** — 20 conformance tests for schema validation, `runParallel` with mock callbacks, failFast, concurrency limits, error handling |
| `handoff.md` | Updated to reflect resolved parallel invocation issues |

## Resolved issues: parallel invocation ✅

All four parallel invocation issues discovered in the previous session have been resolved:

| # | Issue | Status | Fix |
|---|---|---|---|
| 1 | Schema rejects `parallel`-only calls | ✅ **Fixed** | `DELEGATE_TOOL_PARAMS` is now `Type.Union([SINGLE_TASK_PARAMS, PARALLEL_TASK_PARAMS])` with `additionalProperties: false` on both branches — ensures exactly one of `task` or `parallel` is present, never both |
| 2 | String parallel items silently fail | ✅ **Fixed** | `executeParallel` normalizes string items to `{ task: item }` objects before processing. Also, schema now uses `Type.Object` for parallel items (not `Type.Any`), so strings are rejected at validation layer |
| 3 | No integration test coverage for parallel flow | ✅ **Fixed** | Added `test/conformance/parallel.test.ts` with 20 tests covering schema validation, `runParallel` behavior (concurrency, failFast, error handling, AbortSignal, empty arrays, maxConcurrency ceiling), and result shape |
| 4 | `failFast` parameter missing from TypeBox schema | ✅ **Fixed** | Added `failFast: Type.Optional(Type.Boolean())` to the parallel schema branch and `failFast?: boolean` to the `DelegateToolParams` type; `executeParallel` passes `params.failFast ?? false` to `runParallel` |

### What was done

1. **TypeBox schema** (`delegate-tool.ts`):
   - Split into `SINGLE_TASK_PARAMS` (has `task`, no `parallel`) and `PARALLEL_TASK_PARAMS` (has `parallel`, `concurrency`, `failFast`, no `task`)
   - Both branches use `{ additionalProperties: false }` so mutually exclusive keys are enforced
   - Union via `Type.Union([...])` — matches the TypeScript `DelegateToolParams` discriminated union

2. **String normalization** (`delegate-tool.ts` `executeParallel`):
   - Maps each item through a runtime check: `typeof item === 'string'` → wraps in `{ task: item }`
   - Belt-and-suspenders: schema already rejects strings, but this handles any edge case that slips through

3. **failFast propagation** (`types.ts`, `delegate-tool.ts`):
   - Added `failFast?: boolean` to the parallel branch of `DelegateToolParams` type
   - Added `failFast: Type.Optional(Type.Boolean())` to the parallel TypeBox schema
   - `executeParallel` now passes `params.failFast ?? false` to `runParallel`

4. **Conformance tests** (`test/conformance/parallel.test.ts`):
   - Schema validation: 10 tests covering single-task, parallel with all options, mutual exclusivity, string rejection, missing required fields
   - `runParallel` with mock callbacks: 7 tests covering ordered results, concurrency limiting, error tolerance vs failFast abort, empty arrays, AbortSignal propagation, maxConcurrency ceiling
   - Result shape: 1 test confirming `ParallelResult` has `index`, `output`, `status`
   - Dispatcher: 2 tests confirming tool activation and schema registration

All 65 tests pass (7 test files) with no regressions.

## Keys

- Extension source: `packages/pi-delegate/`
- Parent entry: `packages/pi-delegate/src/parent/index.ts`
- Delegate provider: `packages/pi-delegate/src/delegate-provider/index.ts`
- SO provider: `packages/pi-structured-output/src/index.ts`
- Install script: `install.mjs`
- Installed extensions: `~/.config/pi/extensions/pi-delegate/`
- Config: `~/.config/pi/pi-delegate/config.json`
- Agent definitions: `~/.config/pi/agents/` or `./.pi/agents/`