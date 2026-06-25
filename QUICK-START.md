# QUICK-START — Installing and using pi-delegate

This guide walks you through installation and the core features of pi-delegate: defining agents, single delegation, parallel fan-out, typed output, nested delegation, and safety limits.

## Installation

### Prerequisites

- Pi CLI installed (see [pi.ai](https://pi.ai) for installation)
- Node.js ≥ 18
- `~/.config/pi/` directory exists (Pi creates this automatically)

### Step 0: Install the extensions

Clone this repository and run the install script:

```bash
git clone <repo-url> my-pi-monorepo
cd my-pi-monorepo
node install.mjs
```

This copies both `pi-delegate` and `pi-structured-output` to `~/.config/pi/extensions/`.

**Output:**
```
✓ Installed pi-delegate → /Users/you/.config/pi/extensions/pi-delegate
✓ Installed pi-structured-output → /Users/you/.config/pi/extensions/pi-structured-output

Done. Extensions automatically registered in ~/.config/pi/settings.json.
```

### Step 0b: Register with Pi

The install script (`install.mjs`) automatically updates `~/.config/pi/settings.json` for you, so manual registration is typically **optional**. If you prefer to configure manually, or need to adjust the registration, open `~/.config/pi/pi.yaml` (create it if it doesn't exist) and add the extensions:

```yaml
extensions:
  - ~/.config/pi/extensions/pi-delegate/src/parent/index.ts
  - ~/.config/pi/extensions/pi-delegate/src/delegate-provider/index.ts
  - ~/.config/pi/extensions/pi-structured-output/src/index.ts
```

Verify installation:

```bash
/delegate doctor
```

You should see binary resolution, config validity, provider files, and timeout — all passing.

### Step 0c: (Optional) Configure pi-delegate

Create `~/.config/pi/pi-delegate/config.json` to customize behavior:

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

All fields are optional. Fields with built-in defaults: `maxDepth` (2), `runTimeoutMs` (600000 = 10 min), `maxInFlightChildren` (no limit). Fields with no default: `piBinaryPath`, `sandboxCommand`, `childCwd` — omit these if you don't need them. See `packages/pi-delegate/README.md` for details.

> **Note:** `piBinaryPath` is just an example. When left unset, the system PATH is searched automatically to find the `pi` binary.

You can also set environment variable overrides:
- `PI_DELEGATE_MAX_DEPTH`
- `PI_DELEGATE_BINARY_PATH`
- `PI_DELEGATE_RUN_TIMEOUT_MS`
- `PI_DELEGATE_CHILD_CWD`

## Usage

### Step 1: Define an agent

Agent definitions are Markdown files with YAML frontmatter. Create `~/.config/pi/agents/summarizer.md`:

```markdown
---
name: summarizer
description: Summarize documents and text
model: claude-opus
tools: [read]
---

You are a focused summarization expert. When given a document or transcript:
1. Extract the core message in 1-2 sentences.
2. List the top 3-5 key points.
3. Note any open questions or gaps.

Keep your summary concise and structured.
```

The frontmatter keys:

- **`name`** — unique identifier; used in `delegate({ agent: "summarizer" })`
- **`description`** — one-liner for discovery; shown when listing available agents
- **`model`** — override the model (e.g., `anthropic/claude-opus`); if omitted, inherits from parent
- **`tools`** — array of builtin tools the child may use (any subset of the parent's active tools); empty = reasoning-only
- **`systemPrompt`** (body) — the Markdown text below the frontmatter; becomes the child's system prompt

Save and reload Pi. Verify it's discoverable:

```bash
/delegate doctor  # Reports binary/config/providers/timeout
```

### Step 2: Single delegation

Call the `delegate` tool with a task and agent name:

```json
{
  "tool": "delegate",
  "params": {
    "task": "Summarize this transcript: [long text...]",
    "agent": "summarizer"
  }
}
```

Or in natural language:

```
Use the delegate tool to run the summarizer agent on this meeting transcript.
```

The `delegate` tool will:

1. Resolve the agent definition.
2. Check depth and cycle safety.
3. Spawn a child `pi` process with the agent's model, tools, and prompt.
4. Stream the child's progress back to you.
5. Return the result as: `from agent "summarizer": [child's output]`

The label `from agent "summarizer":` is **not** instructions — it's metadata telling you where the output came from.

### Step 3: Parallel fan-out

Run multiple tasks at the same time with the `parallel` parameter:

```json
{
  "tool": "delegate",
  "params": {
    "parallel": [
      {
        "task": "Summarize the Q1 earnings call",
        "agent": "summarizer"
      },
      {
        "task": "Extract the top 5 financial metrics from the call",
        "agent": "analyst"
      },
      {
        "task": "Flag any risks mentioned in the call",
        "agent": "risk-spotter"
      }
    ],
    "concurrency": 2,
    "failFast": false
  }
}
```

Key parameters:

- **`parallel`** — array of 2+ task specs; each spec has the same fields as a single run
- **`concurrency`** — max children running at the same time (default `5`)
- **`failFast`** — if `true`, stop and abort remaining tasks on the first failure

Result: labeled strings, one per task spec, separated by blank lines:

```
from agent "summarizer": <output>

from agent "analyst": <output>

from agent "risk-spotter": <output>
```

### Step 4: Typed output (outputSchema)

When you need the child to return **structured data** (not freeform text), supply an `outputSchema`:

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
        "authors": { "type": "array", "items": { "type": "string" } },
        "publishDate": { "type": "string", "format": "date" },
        "topics": { "type": "array", "items": { "type": "string" } },
        "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
      },
      "required": ["title", "topics"]
    }
  }
}
```

When an `outputSchema` is present:

1. The child's `structured_output` tool becomes available (automatically registered).
2. The child calls `structured_output(data)` with the data it extracted.
3. The data is validated against the schema (using TypeBox `Compile`).
4. On success, the result comes back as `structuredOutput` (the validated object), not text:

```
from agent "extractor" (structured): {"title":"Building AI Systems","authors":["Alice","Bob"],"publishDate":"2024-01-15","topics":["AI","design","safety"],"confidence":0.92}
```

This is much cleaner than parsing the child's freeform output yourself.

### Step 5: Nested delegation

A child agent can itself delegate to other agents, as long as depth and cycle limits allow it. Create an agent that uses delegation:

```markdown
---
name: researcher
description: Research a topic by delegating to specialists
model: claude-opus
delegateAgents: [summarizer, analyst, web-search]
---

You are a research coordinator. Your job is to gather information on the topic using specialized agents:
- Use summarizer for condensing sources
- Use analyst for numerical data
- Use web-search for current information

Call delegate multiple times and synthesize the results into a cohesive report.
```

The **`delegateAgents`** field is critical: it's an **allowlist** of agents this child may delegate to. The parent enforces it — if the child tries to call `delegate` with an agent not in the list, the call fails with `TOOL_NOT_PERMITTED`.

Configure the parent's max depth in `~/.config/pi/pi-delegate/config.json`:

```json
{
  "maxDepth": 3
}
```

Now:

- Depth 0: your root agent (parent)
- Depth 1: agents spawned by the parent (e.g., `researcher`)
- Depth 2: agents spawned by depth-1 agents (e.g., `summarizer` called by `researcher`)
- Depth 3 and beyond: **blocked** with `DEPTH_BLOCKED`

If the `researcher` agent tries to delegate at depth 3, it will get:

```
[BLOCKED:DEPTH_BLOCKED] from agent "researcher": Delegation depth 3 reached maxDepth 3
```

It's up to the child agent to handle this and pivot to a direct solution.

### Step 6: Triggering depth and cycle blocks

### Depth block

Set `maxDepth: 1` in the config:

```json
{
  "maxDepth": 1
}
```

Now your root agent can call `delegate`, but any child agent that tries to call `delegate` will be blocked:

```
[BLOCKED:DEPTH_BLOCKED] from agent "researcher": Delegation depth 1 reached maxDepth 1
```

This is how you create **leaf agents** — agents that can do work but not spawn further children.

### Cycle detection

Create a scenario where an agent tries to delegate to itself:

1. Define an agent named `loop-test`:

```markdown
---
name: loop-test
description: Test cycle detection
delegateAgents: [loop-test]
---

I can delegate to myself.
```

2. Call it:

```json
{
  "tool": "delegate",
  "params": {
    "task": "Do something and then delegate to loop-test",
    "agent": "loop-test"
  }
}
```

The root agent calls `loop-test` at depth 1. Inside `loop-test`, the agent tries to call `delegate` with agent `loop-test` again. The lineage path is `loop-test` (colon-separated), and `loop-test` is already in it, so:

```
[BLOCKED:CYCLE_DETECTED] from agent "loop-test": Cycle detected: agent "loop-test" already in path [loop-test]
```

The cycle block fires *before* the spawn, preventing runaway recursion.

---

## What's next?

- **Configuration**: Tune `maxDepth`, `runTimeoutMs`, and `sandboxCommand` in `~/.config/pi/pi-delegate/config.json`.
- **Agent discovery**: Check `~/.config/pi/agents/` and `./.pi/agents/` (project scope) for agent definitions.
- **Error handling**: Inspect the `error` object (code + message) in blocked or failed results.
- **Monitoring**: Run `/delegate doctor` to verify installation (binary, config, providers, timeout).

For the full spec, see `/docs/SPEC.md` in the repo.
