# pi-delegate

> Spawn child Pi agents as tool calls.

## What it does

`pi-delegate` is a Pi extension that lets your agent spawn specialized sub-agents for focused tasks, coordinate parallel work, enforce safety limits, and validate structured output — all while keeping children isolated and trustworthy.

Five core capabilities:

1. **Single delegation** — the `delegate` tool spawns one child agent for a focused task; the parent waits for its result and incorporates it into the conversation.

2. **Parallel fan-out** — delegate to multiple children concurrently with a configurable `concurrency` limit; results come back as an ordered array, and `failFast` lets you bail early if one task fails.

3. **Typed output** — supply an `outputSchema` (JSON Schema) to enforce a strict contract on the child's response; the child returns a validated object, not freeform text.

4. **Depth & cycle safety** — configurable max depth guards against infinite recursion; cycle detection blocks an agent from appearing twice in the call chain; lineage tracking gives you full visibility into the delegation ancestry.

5. **Child trust model** — children default to a temporary working directory, confining their filesystem access; optional `sandboxCommand` wraps the child process (e.g., `firejail`) for defense-in-depth; children inherit your auth credentials (env vars) so they can hit the same APIs, but never your parent's session or cwd.

## Safety model

Every child run is **a separate `pi` subprocess**, not an in-process call. This choice buys you:

- **Enforcement strength** — a child literally cannot exceed its granted tools, models, or capabilities, because the host never loads what it's not supposed to see.
- **Behavioral fidelity** — the child runs the real Pi agent loop, with all its compaction, skill loading, and tool dispatch; you get the same semantics as a standalone Pi run.

The safety guarantees:

- **Depth limits** — the parent sets `PI_DELEGATE_DEPTH` and `PI_DELEGATE_PATH` in the child's environment. The depth is checked *before* spawn; if `depth >= maxDepth`, the run is blocked with `DEPTH_BLOCKED`.

- **Cycle detection** — if the target agent name already appears in the lineage path (from root to parent), the run is blocked with `CYCLE_DETECTED`.

- **Capability gating** — the parent generates a time-limited `PI_DELEGATE_TOKEN` that the child must present to use the `delegate` tool. No token = no delegation. The parent also grants a `delegateAgents` allowlist, restricting which agents the child may target.

- **Output labeling** — when the child's result comes back, it is **labeled** with `from agent "name":` so the model never mistakes it for instructions it should obey — it's data, not a directive.

- **Tool ceiling** — the parent specifies which builtin tools the child may use (e.g., `bash`, `write`). The child's config cannot expand that set; it can only narrow it or request none.

## Installation

Clone this repository and run the install script:

```bash
git clone <repo-url> my-pi-monorepo
cd my-pi-monorepo
node install.mjs
```

This copies `pi-delegate` and `pi-structured-output` into `~/.config/pi/extensions/`.

Next, add the extensions to your Pi config. Edit `~/.config/pi/pi.yaml` (or your Pi config file) and include:

```yaml
extensions:
  - ~/.config/pi/extensions/pi-delegate/src/parent/index.ts
  - ~/.config/pi/extensions/pi-delegate/src/delegate-provider/index.ts
  - ~/.config/pi/extensions/pi-structured-output/src/index.ts
```

Verify the install worked by running:

```bash
pi doctor  # Looks for /delegate command and agent discovery
```

## Configuration

Config file: `~/.config/pi/pi-delegate/config.json`

Create this file to tune pi-delegate's behavior:

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
| `maxDepth` | `2` | Maximum delegation depth allowed. Set to `0` to disable delegation entirely. Depth 0 = root agent, depth 1 = one level of delegation. |
| `piBinaryPath` | (from PATH) | Override the location of the `pi` executable. If omitted, looks in `PATH`. |
| `runTimeoutMs` | (no limit) | Wall-clock timeout (milliseconds) for each child run. If a child exceeds this, it is terminated and the result is `TIMEOUT`. |
| `sandboxCommand` | (none) | Optional prefix command to sandbox each child process. Example: `firejail` for OS-level sandboxing. Child still runs with your OS identity/permissions. |
| `childCwd` | (temp dir) | Override the child's working directory. Default is a temporary directory created per run. Set to a stable path if you want child state to persist (at your own risk). |

### Environment variable overrides

You can override any config setting with environment variables:

- `PI_DELEGATE_MAX_DEPTH` — override `maxDepth`
- `PI_DELEGATE_BINARY_PATH` — override `piBinaryPath`
- `PI_DELEGATE_RUN_TIMEOUT_MS` — override `runTimeoutMs`
- `PI_DELEGATE_CHILD_CWD` — override `childCwd`

Example:

```bash
export PI_DELEGATE_MAX_DEPTH=3
pi chat "Use the delegate tool to split this into sub-tasks."
```

## vs pi-subagents

Both `pi-delegate` and the Pi built-in `pi-subagents` let you call out to sub-agents. Here's how they differ:

| Feature | pi-delegate | pi-subagents |
|---------|-------------|--------------|
| **Extension type** | Opt-in Pi extension | Pi built-in |
| **Child spawn** | subprocess (`--mode json`) | subprocess |
| **Typed output** | TypeBox JSON Schema validation | inline parsing |
| **Depth guard** | yes, configurable | yes (hardcoded limits) |
| **Cycle detection** | yes, explicit lineage tracking | limited or implicit |
| **Parallel execution** | yes (with concurrency limit) | yes |
| **Capability gating** | yes (`delegateAgents` allowlist, token) | limited |
| **Tool-ceiling override** | yes | no |
| **Fallback models** | yes | no |
| **Structured output tool** | standalone provider, opt-in | not applicable |

**When to use pi-delegate:**

- You want fine-grained control over which agents a caller can delegate to.
- You need strict JSON Schema validation on the child's output.
- You want to set depth limits per-installation, not per-call.
- You're building a system where sub-agents have different security postures.
- Parallel fan-out with a concurrency budget is critical.

**When pi-subagents might be simpler:**

- You trust all agents equally and don't need an allowlist.
- You don't need structured output validation.
- You prefer Pi's built-in machinery over an extension.

Both are production-ready. Pick the one that fits your trust model and feature needs.
