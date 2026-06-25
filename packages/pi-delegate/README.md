# pi-delegate

> Pi extension: spawn child Pi agents as tool calls.

`pi-delegate` lets your agent delegate focused tasks to specialized sub-agents, coordinate parallel work, enforce safety limits, and validate structured output — all while keeping children isolated from the parent session.

## Core capabilities

1. **Single delegation** — the `delegate` tool spawns one child agent for a focused task; the parent receives the result and incorporates it into the conversation.

2. **Parallel fan-out** — delegate to multiple children concurrently with a configurable `concurrency` limit; results return as a joined labeled string (one `from agent "..."` block per task, separated by blank lines), and `failFast` lets you abort early if one task fails.

3. **Typed output** — supply an `outputSchema` (JSON Schema) to enforce a strict contract on the child's response; the child returns a validated object, not freeform text. The schema is compiled with TypeBox for validation.

4. **Depth & cycle safety** — configurable `maxDepth` guards against infinite recursion; cycle detection blocks an agent from appearing twice in the call chain; lineage tracking (colon-separated agent names, capped at 50 entries) gives full visibility into the delegation ancestry.

5. **Child trust model** — children are spawned with a capability token, a restricted agent allowlist (`delegateAgents`), and an optional sandbox command; child `delegate` tool calls are silently removed from the available tool list (tool ceiling).

## Installation

Clone the monorepo and run the install script from the root:

```bash
node install.mjs
```

This copies the extension into `~/.config/pi/extensions/pi-delegate/`.

The install script automatically registers the extensions by adding them to `~/.config/pi/settings.json` (JSON, not YAML). You should see output like:

```
✓ Installed pi-delegate → /Users/you/.config/pi/extensions/pi-delegate
✓ Updated /Users/you/.config/pi/settings.json
```

Verify the install:

```bash
/delegate doctor
```

## Configuration

Default config path: `~/.config/pi/pi-delegate/config.json`

Override with the `PI_DELEGATE_CONFIG_PATH` environment variable.

```json
{
  "maxDepth": 2,
  "piBinaryPath": "/usr/local/bin/pi",
  "runTimeoutMs": 600000,
  "maxInFlightChildren": 10,
  "sandboxCommand": "firejail",
  "childCwd": "/tmp/pi-delegate-work"
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `maxDepth` | `2` | Maximum delegation depth. `0` disables delegation entirely. |
| `piBinaryPath` | (from PATH) | Override the `pi` executable location. |
| `runTimeoutMs` | `600000` | Wall-clock timeout (ms) per child run; default is 10 min. Exceeded runs return `TIMEOUT`. |
| `maxInFlightChildren` | (no limit) | Maximum concurrent child processes. |
| `sandboxCommand` | (none) | Prefix command for OS-level sandboxing (e.g. `firejail`). |
| `childCwd` | (auto-created temp dir) | Override the child's working directory. |

Environment variable overrides:

| Env var | Overrides |
|---------|-----------|
| `PI_DELEGATE_MAX_DEPTH` | `maxDepth` |
| `PI_DELEGATE_BINARY_PATH` | `piBinaryPath` |
| `PI_DELEGATE_RUN_TIMEOUT_MS` | `runTimeoutMs` |
| `PI_DELEGATE_CHILD_CWD` | `childCwd` |

## Agent discovery

Agents are discovered from two locations:

- **User scope:** `~/.config/pi/agents/`
- **Project scope:** `./.pi/agents/` — searched upward from the current directory to the git root; the first match (closest to cwd) wins.

Agent file names must match `/^[a-z0-9][a-z0-9-]*$/` — lowercase alphanumeric characters and hyphens, no leading hyphen.

Each agent file is a Markdown file with YAML frontmatter. Only the following frontmatter fields are recognized; all others are ignored:

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Agent name (must match filename stem) |
| `description` | string | Human-readable purpose |
| `model` | string | Model identifier for the child |
| `tools` | string[] | Built-in tools the child may use |
| `delegateAgents` | string[] | Allowlist of agent names this agent may delegate to |
| `outputSchema` | object | JSON Schema for structured output validation |
| `maxDepth` | number | Per-agent depth cap (overrides config, resolved via `min`) |

The **Markdown body** (content after the closing `---`) becomes the child's system prompt (`systemPrompt` in the parsed definition). It is not a frontmatter key.

API:

- `findAgent(name)` → `Promise<AgentDefinition | undefined>`
- `discoverAgents()` → `Promise<AgentDefinition[]>`

If no user or project agent is found, a default agent is used:

```typescript
const DEFAULT_AGENT = {
  name: 'default',
  filePath: '',
  description: 'General-purpose agent'
};
```

## Usage examples

### Single delegation

```json
{
  "tool": "delegate",
  "params": {
    "task": "Summarize this transcript: [long text...]",
    "agent": "summarizer"
  }
}
```

### Parallel fan-out

```json
{
  "tool": "delegate",
  "params": {
    "parallel": [
      { "task": "Summarize the Q1 earnings call", "agent": "summarizer" },
      { "task": "Extract the top 5 financial metrics", "agent": "analyst" }
    ],
    "concurrency": 5,
    "failFast": false
  }
}
```

### Typed output

```json
{
  "tool": "delegate",
  "params": {
    "task": "Extract structured metadata from this document",
    "agent": "extractor",
    "outputSchema": {
      "type": "object",
      "properties": {
        "title": { "type": "string" },
        "topics": { "type": "array", "items": { "type": "string" } }
      },
      "required": ["title", "topics"]
    }
  }
}
```

See [QUICK-START.md](../../QUICK-START.md) for a full walkthrough and [docs/SPEC.md](../../docs/SPEC.md) for the complete specification.

## Safety model

Every child runs as a **separate `pi` subprocess**, not an in-process call.

### Preflight checks (performed in order)

Before spawning a child, the following checks are executed. The first failure returns a blocked result with the corresponding code.

| # | Check | Code | Condition |
|---|-------|------|-----------|
| 1 | Empty/missing task | `INVALID_PARAMS` | Task string is empty or absent |
| 2 | Depth exceeded | `DEPTH_BLOCKED` | `depth >= maxDepth` |
| 3 | Lineage cap | `DEPTH_BLOCKED` | Lineage path length >= 50 entries |
| 4 | Cycle detected | `CYCLE_DETECTED` | Agent name already in lineage path |
| 5 | Schema validity | `SCHEMA_INVALID` | `outputSchema` is not an object |
| 6 | Agent not found | `INVALID_PARAMS` | Named agent does not exist |
| 7 | Not in allowlist | `TOOL_NOT_PERMITTED` | Agent not in `delegateAgents` |
| 8 | Schema compile | `SCHEMA_INVALID` | Schema cannot be compiled by TypeBox |

Blocked results follow the format:

```
[BLOCKED:<CODE>] from agent "<name>": <message>
```

### Environment variables passed to children

| Variable | Description |
|----------|-------------|
| `PI_DELEGATE_DEPTH` | Current depth (parent depth + 1) |
| `PI_DELEGATE_MAX_DEPTH` | Resolved maximum depth |
| `PI_DELEGATE_PATH` | Colon-separated lineage of agent names (sanitized: `:` → `_`, `/` → `_`, `..` → `_`) |
| `PI_DELEGATE_TASK_ID` | Unique task identifier |
| `PI_DELEGATE_TOKEN` | Capability token (always generated via `randomBytes(32).toString('hex')`) |
| `PI_OUTPUT_SCHEMA` | Schema JSON string (blank if no schema) |
| `PI_OUTPUT_FILE` | Path to output file (blank if no schema) |
| `PI_DELEGATE_AGENTS` | JSON array of allowed agent name strings |

### Capability gating

A capability token (`PI_DELEGATE_TOKEN`) is always generated for every child. The **delegate provider** is only loaded when the token is present (token length > 0). The **structured-output provider** is always loaded regardless. This ensures that:

- Children without a token cannot delegate further.
- Structured output validation is always available.

### Tool ceiling

The `delegate` tool is **silently removed** from the child's tools list — no error is raised, the tool simply does not appear. The `checkToolCeiling()` function returns the name of the first tool that exceeds the ceiling, or `null` if all tools are permitted.

### Result format

Successful single-task results:

```
from agent "<name>": <output>
```

Structured output results:

```
from agent "<name>" (structured): <JSON>
```

The output prefix ensures the model never mistakes child output for instructions.

### Child process lifecycle

- **Kill timeout:** If a child must be terminated, `killChild()` sends `SIGTERM` first, then `SIGKILL` after 5 seconds.
- **Temp directory:** `/tmp/pi-delegate/<taskId>` (mode `0o700`) is created per task and contains:
  - `prompt.md` — the task prompt (mode `0o600`)
  - `output.json` — the child's output (always created)
  - `schema.json` — the output schema (only when a schema is provided)
- **Cleanup:** Temp files are removed in a `finally` block.
- **`before_agent_start` hook:** Appends a capability note about the delegate tool to the system prompt.

### CLI flags for child spawn

Children are spawned with these flags:

```
--mode json
--model <model>
--tools <tool1,tool2,...>
--system-prompt <prompt> | --append-system-prompt <text>
--no-skills
--no-context-files
--no-session
--no-extensions
-e <provider-path>   (repeatable for each provider)
[--output-file <path>]
<task>
```

Note: `-e` (singular) is used per provider, not `--extensions` (plural).

### Parallel task parameter schemas

`DELEGATE_TOOL_PARAMS` uses `additionalProperties: false`; `PARALLEL_TASK_ITEM` does not. The `tools` field in `PARALLEL_TASK_ITEM` accepts a union type: `Type.Union([Type.Array(Type.String()), Type.String()])`.

### Parallel defaults

| Parameter | Default |
|-----------|---------|
| `concurrency` | `5` |
| Return type | joined labeled string (one `from agent "..."` block per task, separated by `\n\n`) |

### Depth resolution

`resolveMaxDepth(configMaxDepth, agentMaxDepth)` returns:
- `agentMaxDepth` if defined (i.e., `min(configMaxDepth, agentMaxDepth)`)
- `configMaxDepth` otherwise

## Distribution and dependency notes

### TypeScript source via jiti

The `exports` field in `package.json` points directly at `.ts` source files (e.g. `./src/parent/index.ts`) rather than compiled JavaScript. This works because pi uses [jiti](https://github.com/unjs/jiti) to load extensions at runtime — jiti transpiles TypeScript on the fly, so no build step is required.

As a consequence:

- **At runtime**, the TypeScript source is loaded by pi's own jiti instance, and type imports like `typebox` resolve through pi's own `node_modules` (which bundles `typebox@1.1.38`).
- **For type-checking and tests** (local `pnpm test` / `pnpm typecheck`), the workspace-local `typebox` devDependency is used. It is pinned to `~1.1` to match the version pi bundles, avoiding API drift between dev-time types and runtime behavior.
- There is no `build` script and no `dist/` directory. If you need a pre-built copy, compile with `tsc` against the `tsconfig.json`.

### pi version alignment

The peer dependency for `@earendil-works/pi-coding-agent` is set to `^0.79.0`. The `pi` CLI binary is provided by that package. There is no dependency on the separate `pi` npm package (an unrelated "PI number" utility).

## vs pi-subagents (built-in)

| Feature | pi-delegate | pi-subagents |
|---------|-------------|--------------|
| Extension type | opt-in extension | Pi built-in |
| Typed output | TypeBox JSON Schema | inline parsing |
| Depth guard | yes, configurable | yes (hardcoded) |
| Cycle detection | yes, explicit lineage | limited |
| Parallel execution | yes (concurrency limit) | yes |
| Capability gating | yes (allowlist + token) | limited |
| Tool-ceiling override | yes (silent removal) | no |

Use `pi-delegate` when you need fine-grained control over agent trust, strict schema validation, or configurable depth limits.