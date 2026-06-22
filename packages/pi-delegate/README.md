# pi-delegate

> Pi extension: spawn child Pi agents as tool calls.

`pi-delegate` lets your agent delegate focused tasks to specialized sub-agents, coordinate parallel work, enforce safety limits, and validate structured output — all while keeping children isolated from the parent session.

## Core capabilities

1. **Single delegation** — the `delegate` tool spawns one child agent for a focused task; the parent receives the result and incorporates it into the conversation.

2. **Parallel fan-out** — delegate to multiple children concurrently with configurable `concurrency` and `maxConcurrency` limits; results return as an ordered array of `{ index, output, status }` objects, and `failFast` lets you abort early if one task fails.

3. **Typed output** — supply an `outputSchema` (JSON Schema) to enforce a strict contract on the child's response; the child returns a validated object, not freeform text. The schema is compiled with TypeBox for validation.

4. **Depth & cycle safety** — configurable `maxDepth` guards against infinite recursion; cycle detection blocks an agent from appearing twice in the call chain; lineage tracking (colon-separated agent names, capped at 50 entries) gives full visibility into the delegation ancestry.

5. **Child trust model** — children are spawned with a capability token, a restricted agent allowlist (`delegateAgents`), and an optional sandbox command; child `delegate` tool calls are silently removed from the available tool list (tool ceiling).

## Installation

Clone the monorepo and run the install script from the root:

```bash
node install.mjs
```

This copies the extension into `~/.config/pi/extensions/pi-delegate/`.

Then add the extensions to your Pi config (`~/.config/pi/pi.yaml`):

```yaml
extensions:
  - ~/.config/pi/extensions/pi-delegate/src/parent/index.ts
  - ~/.config/pi/extensions/pi-delegate/src/delegate-provider/index.ts
```

Verify the install:

```bash
pi doctor
```

## Configuration

Default config path: `~/.config/pi/pi-delegate/config.json`

Override with the `PI_DELEGATE_CONFIG_PATH` environment variable.

```json
{
  "maxDepth": 2,
  "piBinaryPath": "/usr/local/bin/pi",
  "runTimeoutMs": 120000,
  "maxInFlightChildren": 10,
  "sandboxCommand": "firejail",
  "childCwd": "/tmp/pi-delegate-work"
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `maxDepth` | `2` | Maximum delegation depth. `0` disables delegation entirely. |
| `piBinaryPath` | (from PATH) | Override the `pi` executable location. |
| `runTimeoutMs` | (no limit) | Wall-clock timeout (ms) per child run. Exceeded runs return `TIMEOUT`. |
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
    "maxConcurrency": 10,
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

Both `SINGLE_TASK_PARAMS` and `PARALLEL_TASK_PARAMS` use `additionalProperties: false`. The `tools` field in `PARALLEL_TASK_ITEM` accepts a union type: `Type.Union([Type.Array(Type.String()), Type.String()])`.

### Parallel defaults

| Parameter | Default |
|-----------|---------|
| `concurrency` | `5` |
| `maxConcurrency` | `10` |
| Return type | `{ index, output, status }[]` |

### Depth resolution

`resolveMaxDepth(configMaxDepth, agentMaxDepth)` returns:
- `agentMaxDepth` if defined (i.e., `min(configMaxDepth, agentMaxDepth)`)
- `configMaxDepth` otherwise

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