# AGENTS.md — pi-delegate

> Scoped guidance for AI agents working in `packages/pi-delegate/`. The root `AGENTS.md` applies here too; this file adds package-specific rules.

---

## Module layout

```
src/
  parent/           ← Pi extension loaded in the PARENT (user's) Pi process
    index.ts        ← extension entry point; registers the `delegate` tool
    delegate-tool.ts
    config.ts, agents.ts, guards.ts, resolve.ts, spawn.ts, ...
  delegate-provider/ ← Pi extension loaded in CHILD Pi processes only
    index.ts        ← provides a child with its own `delegate` capability
  shared/           ← types and utilities imported by both sides
    types.ts, lineage.ts, schema.ts
```

**The two extension entry points (`parent/index.ts` and `delegate-provider/index.ts`) are registered separately and must not ES-module-import each other.** `src/parent/` must never `import` from `src/delegate-provider/` and vice versa. Only `src/shared/` is fair game from both sides. Note: `delegate-tool.ts` does reference `../delegate-provider/index.ts` as a *file path string* (via `import.meta.url`) for passing to the child's `-e` CLI flag — this is path resolution, not a module import, and does not violate the invariant.

---

## Core invariants

### Preflight order (`guards.ts`)

`runPreflight()` runs exactly 8 checks in strict order; the first failure returns immediately (no accumulation). **Do not reorder them.** The order is contractually documented in `README.md` and `docs/SPEC.md §4.4`:

1. Empty/missing task → `INVALID_PARAMS`
2. Depth exceeded → `DEPTH_BLOCKED`
3. Lineage path at cap (50 entries) → `DEPTH_BLOCKED`
4. Cycle detected → `CYCLE_DETECTED`
5. Schema not a plain object → `SCHEMA_INVALID`
6. Named agent not found → `INVALID_PARAMS`
7. Agent not in `delegateAgents` allowlist → `TOOL_NOT_PERMITTED`
8. Schema not compilable by TypeBox → `SCHEMA_INVALID`

### Result format (`result.ts`)

All responses — including errors and blocks — are **returned as labeled strings, never thrown**:

```
from agent "<name>": <output>                            ← success
from agent "<name>" (structured): <JSON>                 ← structured output
[BLOCKED:<CODE>] from agent "<name>": <message>          ← any blocked result
```

The `from agent` prefix is untrusted-output labeling, not instructions. Never omit it.

### Depth semantics

A run is blocked when `depth >= maxDepth`, not `depth > maxDepth`. The root caller is depth `0`; a child it spawns runs at depth `1`. Default `maxDepth` is `2`.

---

## Configuration (`config.ts`)

| Key | Code default | Env override |
|-----|-------------|-------------|
| `maxDepth` | `2` | `PI_DELEGATE_MAX_DEPTH` |
| `runTimeoutMs` | `600_000` (10 min) | `PI_DELEGATE_RUN_TIMEOUT_MS` |
| `maxInFlightChildren` | `undefined` (no limit) | — |
| `piBinaryPath` | (PATH search) | `PI_DELEGATE_BINARY_PATH` |
| `childCwd` | (temp dir) | `PI_DELEGATE_CHILD_CWD` |

The config file location precedence: `PI_DELEGATE_CONFIG_PATH` → `$PI_CONFIG_DIR/pi-delegate/config.json` → `~/.config/pi/pi-delegate/config.json`. Missing or invalid JSON is silently treated as empty (defaults apply).

---

## Child process spawn (`spawn.ts`)

Children are spawned with these flags (in this order):
```
--mode json
--model <model>
--tools <t1,t2,...>
(--system-prompt | --append-system-prompt) <text>
--no-skills --no-context-files --no-session --no-extensions
-e <parent-provider-path>      (one -e per provider)
<task>
```

`-e` (singular) is used per provider. Do NOT use `--extensions` (plural).

Structured output paths are passed via the `PI_OUTPUT_FILE` environment variable, not a `--output-file` CLI flag.

### Temp files

Per-run dir: `/tmp/pi-delegate/<taskId>/` (`0o700`). Files inside: `prompt.md`, `output.json`, `schema.json` (all `0o600`). Cleanup happens in a `finally` block in the execute path.

### Signal forwarding

The `AbortSignal` from the tool's `execute()` call **must be threaded through to `spawnRun()`** — both the single-task path and every slot in `runParallel()`. Without this, parent cancellation does not terminate child processes.

---

## TypeBox schema rules

- Tool `parameters` must be a flat `Type.Object(...)` at the root — no `anyOf`, no wrapping. See root `AGENTS.md` and the fix in commit `fce5be0`.
- Optional fields use `Type.Optional(Type.String())` etc. — do not use `Type.Union([..., Type.Undefined()])`.
- `additionalProperties: false` is on `DELEGATE_TOOL_PARAMS` only — `PARALLEL_TASK_ITEM` does not carry it. Preserve this distinction.
- `Type.Enum` in tool schemas generates `anyOf/const` patterns that Pi rejects. Use the `StringEnum` helper from `@earendil-works/pi-ai` if enum types are ever needed. Note: `@earendil-works/pi-ai` is a transitive dependency (not declared directly in `package.json`), available through `@earendil-works/pi-coding-agent`.

---

## Testing

Tests live in `test/conformance/`. Tests mock the spawn layer (`spawn.ts`) via `vi.mock()` — **mock at the spawn boundary, not higher up**. This keeps tests fast and deterministic without the Pi binary.

```ts
vi.mock('../../src/parent/spawn.js', () => ({
  resolvePiBinary: vi.fn().mockResolvedValue('/mock/pi'),
  spawnRun: vi.fn().mockResolvedValue({ output: 'mock output', exitCode: 0, timedOut: false }),
  generateCapabilityToken: vi.fn().mockReturnValue('mock-token'),
  buildSpawnArgs: vi.fn().mockReturnValue([]),
}));
```

Run tests: `pnpm --filter pi-delegate test`  
Typecheck: `pnpm --filter pi-delegate typecheck`
