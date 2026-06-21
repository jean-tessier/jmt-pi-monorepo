# pi-delegate

> Pi extension: spawn child Pi agents as tool calls.

`pi-delegate` lets your agent delegate focused tasks to specialized sub-agents, coordinate parallel work, enforce safety limits, and validate structured output — all while keeping children isolated from the parent session.

## Core capabilities

1. **Single delegation** — the `delegate` tool spawns one child agent for a focused task; the parent receives the result and incorporates it into the conversation.

2. **Parallel fan-out** — delegate to multiple children concurrently with a configurable `concurrency` limit; results return as an ordered array, and `failFast` lets you abort early if one task fails.

3. **Typed output** — supply an `outputSchema` (JSON Schema) to enforce a strict contract on the child's response; the child returns a validated object, not freeform text.

4. **Depth & cycle safety** — configurable `maxDepth` guards against infinite recursion; cycle detection blocks an agent from appearing twice in the call chain; lineage tracking gives full visibility into the delegation ancestry.

5. **Child trust model** — children default to a temporary working directory, confining their filesystem access; optional `sandboxCommand` wraps the child process (e.g., `firejail`) for defense-in-depth.

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

Config file: `~/.config/pi/pi-delegate/config.json`

```json
{
  "maxDepth": 2,
  "piBinaryPath": "/usr/local/bin/pi",
  "runTimeoutMs": 120000,
  "sandboxCommand": "firejail",
  "childCwd": "/tmp/pi-delegate-work"
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `maxDepth` | `2` | Maximum delegation depth. `0` disables delegation entirely. |
| `piBinaryPath` | (from PATH) | Override the `pi` executable location. |
| `runTimeoutMs` | (no limit) | Wall-clock timeout (ms) per child run. Exceeded runs return `TIMEOUT`. |
| `sandboxCommand` | (none) | Prefix command for OS-level sandboxing (e.g. `firejail`). |
| `childCwd` | (temp dir) | Override the child's working directory. |

Environment variable overrides: `PI_DELEGATE_MAX_DEPTH`, `PI_DELEGATE_BINARY_PATH`, `PI_DELEGATE_RUN_TIMEOUT_MS`, `PI_DELEGATE_CHILD_CWD`.

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
    "concurrency": 2,
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

Every child runs as a **separate `pi` subprocess**, not an in-process call:

- **Depth limits** — the parent sets `PI_DELEGATE_DEPTH` and `PI_DELEGATE_PATH` in the child's environment. Depth is checked before spawn; if `depth >= maxDepth`, the call returns `DEPTH_BLOCKED`.
- **Cycle detection** — if the target agent name already appears in the lineage path, the call returns `CYCLE_DETECTED` without spawning.
- **Capability gating** — the parent generates a time-limited `PI_DELEGATE_TOKEN`. No token = no delegation. A `delegateAgents` allowlist restricts which agents the child may target.
- **Output labeling** — child output is prefixed with `from agent "name":` so the model never mistakes it for instructions.
- **Tool ceiling** — the parent specifies which builtin tools the child may use; the child cannot expand that set.

## vs pi-subagents (built-in)

| Feature | pi-delegate | pi-subagents |
|---------|-------------|--------------|
| Extension type | opt-in extension | Pi built-in |
| Typed output | TypeBox JSON Schema | inline parsing |
| Depth guard | yes, configurable | yes (hardcoded) |
| Cycle detection | yes, explicit lineage | limited |
| Parallel execution | yes (concurrency limit) | yes |
| Capability gating | yes (allowlist + token) | limited |
| Tool-ceiling override | yes | no |

Use `pi-delegate` when you need fine-grained control over agent trust, strict schema validation, or configurable depth limits.
