# pi-delegate — Specification (v1, normative)

> Status: **Draft for implementation (hardened).** Working name `pi-delegate`; the
> registered tool is `delegate`. This document is normative: it defines the contract
> an implementation MUST satisfy. Design rationale and internals live in `DESIGN.md`;
> the staged build path lives in `IMPLEMENTATION-PLAN.md`.
>
> Conformance language: **MUST / MUST NOT / SHOULD / MAY** per RFC 2119.
> Backend: **subprocess** (§3) — each child runs as a separate `pi` process. The
> child CLI flag surface is pinned to `pi` 0.79.8 (exact) in `peerDependencies`
> (§3.2).

---

## 1. Scope

`pi-delegate` is a Pi extension that registers one tool, `delegate`, letting the
running agent (the **parent**) spawn one or more **child** agent runs with a
parent-chosen model, tool set, and prompt, optionally under a structured-output
contract, and run them singly or in parallel — all under enforced recursion-depth
and cycle limits, with the parent able to decide whether (and how) a child may
itself delegate.

**In scope for v1 (this spec):** single delegation; parallel fan-out; per-child
model/tools/prompt/structured-output; depth + cycle guards; capability gating;
**subprocess (out-of-process) execution** (§3).

**Out of scope for v1** (reserved, MUST NOT block the v1 contract): multi-step
chains, git-worktree isolation, background/async jobs, cross-session intercom, and
the **embedded (in-process) execution backend**. These MAY be added later without
breaking the v1 `delegate` contract.

> **v2 backlog — embedded backend.** An in-process backend (`createAgentSession`)
> is a candidate v2 optimization for read-only children, where process-spawn
> latency is the dominant cost and OS-level isolation is unnecessary. It is
> deferred, not designed, here: adopting it later MUST preserve the §4 contract
> and the §6/§7 guarantees, and it remains gated on confirming the child
> system-prompt API and provider/auth inheritance for in-process sessions.

---

## 2. Terms

- **Parent** — the agent run that calls `delegate`.
- **Child** — an agent run created by a `delegate` call.
- **Agent definition** — a named, reusable child configuration (model, tools,
  prompt, inheritance, delegation grant), authored as a Markdown file with YAML
  frontmatter (§5).
- **Run** — a single child execution with one assigned task. A `delegate` call
  produces one run (single mode) or N runs (parallel mode).
- **Depth** — the number of `delegate` hops from the root agent to the current
  run. The root agent is depth `0`; a child it spawns runs at depth `1`.
- **Lineage path** — the ordered list of ancestor runs from root to the current
  run, used for cycle detection (§7.2).
- **Capability grant** — the parent's decision about whether a given child
  receives the `delegate` tool, and which agents it may target (§6).
- **Backend** — the mechanism that executes a child run. v1 defines exactly one:
  `subprocess` (§3) — each child runs as a separate `pi` process. The `embedded`
  (in-process) backend is reserved for a potential v2 and is out of scope here
  (§1).

---

## 3. Execution backend (subprocess)

A conforming v1 implementation MUST execute each child run as a **separate `pi`
operating-system process**, configured entirely through command-line flags,
environment variables, and temporary files. The child runs the real Pi agent
loop; the implementation does not reimplement that loop.

This backend is chosen for **enforcement strength and behavioral fidelity**: a
child literally cannot exceed its granted tools, extensions, or capabilities,
because the host process never loads them; and the child's agent semantics
(compaction, skill loading, tool dispatch) are identical to a normal Pi run
because it *is* a normal Pi run. The cost — process spawn latency and an
out-of-process streaming path — is accepted deliberately (§3.7).

> The **embedded** backend (`createAgentSession`, in-process) is **deferred** and
> MUST NOT be assumed by any v1 conformance test (§1). Where this spec says "the
> child receives tool X", the subprocess backend satisfies it by including X in the
> child's `--tools` allowlist (builtins) or by the loaded child provider (custom
> tools); the contract (§4) is backend-independent.

The `delegate` tool's `execute` MUST, for each requested run, perform the steps in
§3.1–§3.8 in order, forward progress to the parent via `onUpdate` (§9), and, on
completion or failure, read the run's outcome (§3.8) and remove that run's
temporary files (§10).

### 3.1 Binary resolution

The implementation MUST resolve a `pi` executable before spawning any child,
using this precedence:

1. An explicit `piBinaryPath` from configuration (§11), if set.
2. A `pi` executable on `PATH`.
3. A bundled or peer-dependency bin link shipped with the extension.

If no executable resolves, the run result MUST be `SPAWN_FAILED` with a message
naming the resolution attempts. The implementation SHOULD verify the resolved
binary's version satisfies the pinned `peerDependencies` range and SHOULD emit a
non-fatal diagnostic on mismatch. The resolved path MUST be reused for every child
in a `delegate` call rather than re-resolved per child.

### 3.2 Process invocation — arguments

Each child is spawned as `pi <flags> <task>`, where `<task>` is the resolved
per-run objective passed as the initial user turn, and `<flags>` are derived from
the resolved configuration (§8). The flag *names* below are the intended surface
and MUST be pinned to a specific Pi version in `peerDependencies`; an implementation
MAY substitute the host Pi's equivalent flags but MUST preserve the guarantee in
each row.

| Resolved input | Flag(s) | Guarantee |
|---|---|---|
| Model (§8.1) | `--model <provider/model[:thinking]>` | The child runs exactly the resolved model; `:thinking` carries the resolved thinking level. |
| Tools (§8.2) | `--tools <allowlist>` | The child receives **only** the effective allowlist; it MUST NOT be a superset of the parent ceiling. |
| System prompt, `replace` (§8.3) | `--system-prompt <file>` | The child's base prompt is replaced by the composed prompt file (§3.5). |
| System prompt, `append` (§8.3) | `--append-system-prompt <file>` | The composed prompt is appended to Pi's base prompt. |
| `inheritProjectContext = false` (§8.3) | the host Pi flag that suppresses context files (e.g. `--no-context-files`) | The child MUST NOT load `AGENTS.md`/context files. |
| `inheritSkills = false` (§8.3) | `--no-skills` | The child MUST NOT load skills. |
| Structured stdout (§3.7, §3.8) | `--mode json` | The child emits all session events as JSON lines (`AgentEvent`) on stdout, giving a parseable stream for progress and result capture. |
| Child providers (§3.4) | `--no-extensions` plus `--extensions <paths…>` — the structured-output provider when a schema applies, the delegate provider when authorized, both when both, neither otherwise | The child loads **only** the single-purpose provider(s) its grant requires, never the parent's other extensions/MCP tools. |
| Session isolation (§3.6) | `--no-session` (or `--session-dir <temp>`) | The child MUST NOT write the parent's session file. |

Exactly one of `--system-prompt` / `--append-system-prompt` MUST be passed per
child, determined by the resolved `promptMode` (§8.3). The task string MUST be
passed as data (a single positional argument), never interpolated into a flag, so
that task content cannot be read as an option.

### 3.3 Process invocation — environment

The child process environment MUST be the host environment plus the nested-route
variables below. Provider credentials and model-registry configuration present in
the host environment MUST be passed through unchanged, so the child authenticates
to its resolved model without the implementation re-plumbing keys; if the resolved
model has no usable credentials in the child environment, the run result MUST be
`NO_MODEL_OR_AUTH` (§8.1).

| Variable | Value | Purpose |
|---|---|---|
| `PI_DELEGATE_DEPTH` | the child's depth, `parentDepth + 1` (integer) | Carries depth down the tree (§7.1). |
| `PI_DELEGATE_MAX_DEPTH` | the child's resolved ceiling, `min`-clamped (§7.1) | Children may only tighten. |
| `PI_DELEGATE_PATH` | the lineage path as sanitized JSON (§7.2) | Cycle-detection substrate. |
| `PI_DELEGATE_TOKEN` | a fresh high-entropy capability token, **only for authorized children** (§6) | Arms `delegate` in the delegate provider (§3.4). |
| `PI_OUTPUT_SCHEMA` | path to `schema.json` (§3.5), **only when an output schema applies** | Arms `structured_output` in the structured-output provider (§3.4). |
| `PI_OUTPUT_FILE` | path to `output.json` (§3.5), **only when an output schema applies** | Where the structured-output provider writes the captured result (§3.8). |

`PI_DELEGATE_PATH` MUST be sanitized before it is set: entries are reduced to
`{ runId, agent? }`, with no path separators, no `..`, and a length cap
(`lineagePathCap`, §11). For **unauthorized** children (§6), `PI_DELEGATE_TOKEN`
MUST be set empty (blanked), not merely omitted; likewise `PI_OUTPUT_SCHEMA` /
`PI_OUTPUT_FILE` MUST be blanked for a child with no output schema, so a child
cannot inherit a stray value from the host environment.

### 3.4 Child providers and capability arming

A child loads **only** the provider(s) its grant requires (§3.2) — never the
parent's other extensions or MCP tools. v1 defines **two independent,
single-purpose child providers**, each shipped with the extension and loaded à la
carte:

- The **delegate provider** registers `delegate` and is loaded **only for a
  delegation-authorized child** (§6). It arms `delegate` **if and only if** it
  observes a non-empty, well-formed `PI_DELEGATE_TOKEN` (§3.3); the child's depth
  ceiling is the `min`-clamped `PI_DELEGATE_MAX_DEPTH`. An unauthorized child is
  spawned **without** this provider and with a blanked token, so `delegate` is never
  registered — there is no tool to call.
- The **structured-output provider** registers `structured_output` and is loaded
  **only when an output schema applies** to the run (§8.4). It reads the schema from
  the path in `PI_OUTPUT_SCHEMA` (`schema.json`, §3.5) and writes the child's
  captured call to `PI_OUTPUT_FILE` (`output.json`, §3.8). It carries no token,
  depth, or lineage logic and is independent of delegation, so a leaf child that
  only needs structured output loads **no** delegation code.

Separating the two keeps each child's surface minimal: a read-only child that
returns a structured value never loads the delegation machinery, and an authorized
child that returns free text never loads the structured-output machinery. They are
combined (`--extensions <structured-output> <delegate>`) only when a run needs both.
The providers ship as **two packages**: `pi-delegate` (the parent extension and the
child-side delegate provider) and `pi-structured-output` (the structured-output
provider, independently installable). The structured-output provider's decoupling
from delegation — no token, depth, or lineage — is what makes a separate package
clean. This packaging does not affect the contract.

The capability token is conveyed through the environment because the backend is a
separate process. Its security property is **non-forgeability of a grant the child
did not receive**: a child can read its own (blanked) environment but cannot invent
a token it was never given, and an unauthorized child is never given one. The token
MUST be freshly generated per authorized child and MUST NOT be derived from, or
predictable from, the parent's token or the task content.

### 3.5 Prompt and schema temporary files

Per-run inputs that are too large or too sensitive for flags MUST be delivered as
files in a **per-run temporary directory** created mode `0700`, each file created
mode `0600`:

- `prompt.md` — the composed child system prompt (§8.3), referenced by
  `--system-prompt` / `--append-system-prompt` (§3.2).
- `schema.json` — present only when an output schema applies (§8.4); the JSON
  Schema the child's `structured_output` tool must satisfy.
- `output.json` — the path the child's `structured_output` tool writes its result
  to (§3.4); read back in §3.8.

These files MUST be removed on completion, error, and abort, best-effort (§10).
The implementation MUST NOT place these files inside the child's `cwd` (§10) where
the child's own tools could read or overwrite them; the schema/output paths are
surfaced to the **structured-output provider** via `PI_OUTPUT_SCHEMA` /
`PI_OUTPUT_FILE` (§3.3, §3.4), not to the child's builtin tools.

### 3.6 Session isolation

Child transcripts MUST be isolated from the parent's session. The child MUST be
spawned with session writing disabled (`--no-session`) or directed to an ephemeral
per-run session directory; in either case the child MUST NOT write to, or read
from, the parent's session file. Any ephemeral session directory MUST be removed
on completion (§10).

### 3.7 Process lifecycle, streaming, and cancellation

**Spawn and capture.** The implementation MUST capture the child's `stdout` and
`stderr`. It MUST NOT inherit the parent's interactive TTY for the child. The child
MUST be spawned in `--mode json` (§3.2), so its `stdout` is a stream of newline-
delimited `AgentEvent` objects — `agent_start`, `turn_start`, `message_start` /
`message_update` / `message_end`, `tool_execution_start` / `update` / `end`,
`turn_end`, and a terminal `agent_end` carrying the final `AgentMessage`s. All
progress and result parsing reads this stream rather than freeform text.

**Streaming.** The implementation MUST forward child progress to the parent via
`onUpdate` (§9) by parsing the `AgentEvent` stream. v1 MAY surface **coarse**
progress — at minimum, `turn_start` and `tool_execution_start`/`end` boundaries —
rather than mirroring every token; it SHOULD forward assistant text from
`message_update`/`message_end` where available. Lines that fail to parse as JSON
(e.g. interleaved diagnostics) MUST be ignored for progress, not treated as errors.
Richer event forwarding MAY be added later without changing the `delegate` contract.
No cross-process control channel back *into* the child is required in v1.

**Exit and status mapping.** When the child exits, the implementation MUST map the
outcome to a per-run `status` (§4.3): a clean exit with a captured result → `"ok"`;
a non-zero exit or unreadable result → `"error"` with `SPAWN_FAILED` (or the more
specific code where determinable, e.g. `NO_MODEL_OR_AUTH`, `SCHEMA_INVALID`); a
guard refusal raised inside the child (a nested `delegate`) is returned through that
child's own result, not this process's exit code.

**Cancellation.** When the `signal` passed to `delegate`'s `execute` aborts, the
implementation MUST terminate every in-flight child it spawned: send `SIGTERM`,
allow a brief grace period, then `SIGKILL` if the process has not exited.
Terminated children MUST carry `status="aborted"` (§4.3). In a parallel call with
`failFast=true`, the first `status="error"` child MUST trigger this same
termination of in-flight siblings and skip not-yet-started specs (§9).

**Timeout.** If a time budget is configured for a run (`runTimeoutMs`, §11) and the
child exceeds it, the implementation MUST terminate the child as above and return
`TIMEOUT` (§4.4).

### 3.8 Reading the result

After a child exits cleanly, the implementation MUST produce the run's outcome
(§4.3) as follows:

- **With an output schema (§8.4):** read `output.json`, validate it against
  `schema.json` (TypeBox `Compile`), and on success return the validated object as
  `structuredOutput`. A missing or invalid `output.json` MUST yield `SCHEMA_INVALID`,
  regardless of the child's exit code.
- **Without an output schema:** take the child's final assistant text from the
  terminal `agent_end` event (or the last `message_end` if `agent_end` carries
  several messages) in the `--mode json` stream (§3.7), truncate it to
  `maxOutputLines` (§4.2), and return it as `output`. The implementation MUST NOT
  scrape freeform stdout for this text.

`usage` accounting (§4.3) MAY be populated from the child's reported token/cost
totals when available. The run's temporary directory (§3.5) and any ephemeral
session directory (§3.6) MUST then be removed.

---

## 4. The `delegate` tool contract

### 4.1 Identity

The extension MUST register exactly one tool named `delegate`. Its description is
model-facing and MUST state, in this order: what it does, the single-vs-parallel
shapes, and the parent's non-overlap responsibility. Reference wording is in
Appendix A.

### 4.2 Parameters

`delegate` accepts **either** a single-run shape **or** a parallel shape. Exactly
one of `task` (single) or `parallel` (fan-out) MUST be present; supplying both, or
neither, is a validation error (`INVALID_PARAMS`).

**Single run:**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `agent` | string | SHOULD | Name of a predefined agent definition (§5). If omitted, the run is **inline**: overrides layer on built-in defaults (model inherits the parent run's model; `tools` defaults to none; prompt defaults to Pi's base). An inline child has no agent definition and therefore can never delegate (§6). |
| `task` | string | MUST | The work for this child, stated as a self-contained instruction. |
| `model` | string | MAY | Per-call model override, `provider/model[:thinking]` (§8.1). |
| `tools` | string[] \| string | MAY | Per-call tool override; comma-string or array (§8.2). Narrowing only — see §8.2. |
| `prompt` | string | MAY | Per-call system-prompt override (§8.3). |
| `promptMode` | `"replace"` \| `"append"` | MAY | How `prompt` combines with the base (§8.3). Default: the agent definition's `systemPromptMode`, else `replace`. |
| `outputSchema` | object | MAY | JSON Schema (object root) for a strict structured result (§8.4). |
| `maxOutputLines` | integer ≥ 1 | MAY | Cap on inline result text returned to the parent. Default `1000` (§11). |

**Parallel fan-out:**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `parallel` | array | MUST | 2+ run specs, each with the single-run fields above (minus `parallel`). |
| `concurrency` | integer ≥ 1 | MAY | Max simultaneously-running children for this call. Default `4` (§11). Values above `maxConcurrency` are clamped (§9). |
| `failFast` | boolean | MAY | If `true`, the first failed child aborts the remaining in-flight and not-yet-started children. Default: `false`. |

The parameter schema descriptions are model-facing and MUST follow Appendix A.

### 4.3 Result

A `delegate` result MUST report each run's outcome. For a single run, the result
content is that run's outcome; for parallel, it is an ordered array aligned to the
input order of `parallel`.

Per-run outcome fields:
- `status` — `"ok"` | `"error"` | `"blocked"` | `"aborted"`.
- `agent` — the resolved agent name (or `"(inline)"`).
- `output` — the child's final assistant text, truncated to `maxOutputLines`
  (present when `status="ok"` and no `outputSchema`).
- `structuredOutput` — the validated object (present when `status="ok"` and an
  `outputSchema` applied).
- `error` — an `{ code, message }` pair (present when `status="error"|"blocked"`),
  with `code` from §4.4.
- `usage` — optional `{ inputTokens, outputTokens, costUsd }` for accounting.

In parallel mode, the result is **partial-tolerant**: a run failing MUST NOT
suppress the results of runs that succeeded (unless `failFast` aborted them, in
which case those carry `status="aborted"`).

### 4.4 Error taxonomy

Guard refusals and failures are returned **as results**, not thrown, so the parent
can adapt. Every error result MUST carry one of these codes:

| Code | Meaning | Parent's expected next move |
|---|---|---|
| `INVALID_PARAMS` | Malformed call (both/neither of task/parallel, bad schema). | Fix the call. |
| `UNKNOWN_AGENT` | `agent` names no discoverable definition. | Use a listed agent or supply inline config. |
| `DEPTH_BLOCKED` | `depth >= maxDepth` at this run (§7.1). | Do the work directly; do not delegate. |
| `CYCLE_DETECTED` | Target agent already in the lineage path (§7.2). | Choose a different agent or do it directly. |
| `TOOL_NOT_PERMITTED` | A requested child tool is outside the builtin set or the ceiling, names `delegate` (§8.2), or a child targets an agent outside its `delegateAgents` (§6). | Narrow the tool set / target an allowed agent. |
| `SCHEMA_INVALID` | `outputSchema` is not a JSON Schema object, or the child's `structured_output` payload failed validation (§8.4). | Repair the schema or retry. |
| `NO_MODEL_OR_AUTH` | No model resolved, or no credentials for the resolved model. | Configure the model/provider. |
| `SPAWN_FAILED` | Process spawn or run start failed for another reason. | Inspect message; retry. |
| `TIMEOUT` | The run exceeded its time budget (if configured). | Narrow the task. |
| `ABORTED` | The run was cancelled (parent abort or `failFast`). | None required. |

### 4.5 Preflight ordering (deterministic error precedence)

For each run, the implementation MUST evaluate the following checks in this order
and return the first failure as that run's result. This makes error codes
deterministic when more than one would apply, and guarantees a check that prevents
a child is reached before any check that would spawn one:

1. Parameter shape (§4.2) → `INVALID_PARAMS`.
2. Agent resolution (§5) → `UNKNOWN_AGENT`.
3. Depth guard (§7.1) → `DEPTH_BLOCKED`.
4. Cycle guard, then path-cap backstop (§7.2) → `CYCLE_DETECTED` / `DEPTH_BLOCKED`.
5. Tool-ceiling check (§8.2) and delegation grant (§6) → `TOOL_NOT_PERMITTED`.
6. Output-schema validity (§8.4) → `SCHEMA_INVALID`.
7. Model/credential resolution (§8.1) → `NO_MODEL_OR_AUTH`.
8. Process spawn and run start → `SPAWN_FAILED` / `TIMEOUT` / `ABORTED`.

Checks 1–7 MUST NOT spawn a child or consume model tokens. In parallel mode this
ordering applies per spec, independently (§9).

---

## 5. Agent definitions

### 5.1 Format and discovery

An agent definition is a Markdown file: YAML frontmatter + a system-prompt body.
The implementation MUST discover definitions from two scopes:
- **user**: under Pi's agent directory (`getAgentDir()`, default `~/.pi/agent`),
  in an `agents/` subdirectory, plus the extension's bundled defaults.
- **project**: `./.pi/agents/*.md` under the current `cwd`.

The exact discovery globs are fixed in `DESIGN.md` against the resolved
`getAgentDir()` layout. Project scope MUST override user scope on name collision.
Definitions MUST be loaded at extension start and MAY be refreshed on demand.

### 5.2 Frontmatter schema

| Field | Type | Default | Meaning |
|---|---|---|---|
| `name` | string | — (MUST) | Unique identifier used by `delegate({ agent })`. |
| `description` | string | — (SHOULD) | One line; shown to the parent when listing agents. |
| `model` | string | inherit parent | `provider/model[:thinking]` (§8.1). |
| `fallbackModels` | string[] | `[]` | Tried in order if the primary model fails to start (§8.1). |
| `thinking` | enum | model default | `off\|minimal\|low\|medium\|high\|xhigh`. |
| `tools` | string[] \| string | `[]` | The child's builtin-tool allowlist (§8.2). Empty = a tool-free reasoning child. |
| `systemPrompt` | string (body) | — | The prompt body below the frontmatter. |
| `systemPromptMode` | `replace`\|`append` | `replace` | How the body combines with Pi's base prompt (§8.3). |
| `inheritProjectContext` | boolean | `false` | Whether the child loads `AGENTS.md`/context files (§8.3). |
| `inheritSkills` | boolean | `false` | Whether the child loads skills (§8.3). |
| `outputSchema` | string\|object | — | Default structured-output contract; a path or inline JSON Schema (§8.4). |
| `canDelegate` | boolean | `false` | Whether this child receives the `delegate` tool (§6). |
| `delegateAgents` | string[] | all | When `canDelegate`, the allowlist of agents this child may target (§6). |
| `maxSubagentDepth` | integer ≥ 0 | inherit | Per-agent depth ceiling; combined by `min` with the inherited ceiling (§7.1). |

Unknown frontmatter keys MUST be ignored (forward-compatibility), and the
implementation SHOULD surface them as a non-fatal diagnostic. A definition missing
`name`, or whose effective config yields no model and no `task`-time model, MUST
fail discovery for that file with a diagnostic, not abort the extension.

---

## 6. Capability model (requirement #5)

Whether a child may itself delegate is decided by the **operator**, declared in the
agent definition, and enforced by **absence**, not by instruction. Authorization is
not raisable at call time: the parent agent cannot escalate a child's privilege
through tool arguments.

- A child can delegate **if and only if** its agent definition sets
  `canDelegate: true`. An authorized child is spawned with a valid capability token
  (`PI_DELEGATE_TOKEN`, §3.3) and the loaded **delegate provider** registers its
  `delegate` tool (§3.4); an unauthorized child is spawned **without** the delegate
  provider and with a blanked token. The child therefore cannot delegate — there is
  no tool to call.
- An **inline child** (no `agent`, §4.2) has no definition and is therefore always
  leaf-only: it can never receive `delegate`.
- The system MUST NOT rely on telling an unauthorized child "do not delegate."
  Enforcement is structural: an unauthorized child is spawned without the delegate
  provider, and the provider would refuse to arm `delegate` absent a valid token in
  any case (§3.4).
- For an authorized child, the definition's `delegateAgents` allowlist restricts
  which agents that child may target **as its immediate children**. A request from
  the child naming an agent outside that allowlist MUST be refused with
  `TOOL_NOT_PERMITTED`. `delegateAgents` governs immediate targets only; deeper
  levels are re-gated by each level's own `canDelegate` / `delegateAgents`.
- Authorization MUST be conveyed to an authorized child as a **capability token**:
  a fresh, high-entropy value passed in the child's environment
  (`PI_DELEGATE_TOKEN`, §3.3), which the loaded provider checks before arming the
  `delegate` tool. The token MUST be generated per authorized child and MUST NOT be
  derived from, or predictable from, the parent's token or the task content. The
  security property is **non-forgeability of a grant not received**: a child can
  read its own environment, but an unauthorized child is never given a token (its
  token is blanked, §3.3) and cannot invent one. A child cannot obtain delegation
  authority it was not granted.
- An authorized child's depth ceiling MUST be the `min` of the parent's remaining
  ceiling and its own `maxSubagentDepth` (§7.1), carried in `PI_DELEGATE_MAX_DEPTH`
  (§3.3). Authorization never *raises* a child's limits.

> Operators SHOULD set `delegateAgents` explicitly on any `canDelegate: true`
> definition; the open default (all agents) is permissive and is reached only after
> the deliberate `canDelegate` opt-in.

---

## 7. Guard semantics (requirement #2)

Guards run **before** a child is spawned. A blocked delegation MUST return
a result (`DEPTH_BLOCKED` or `CYCLE_DETECTED`), MUST NOT spawn a child, and MUST
NOT consume model tokens.

### 7.1 Depth

- The implementation MUST track the current run's `depth` (root = 0), carried to
  each child as `depth + 1` via `PI_DELEGATE_DEPTH` (§3.3).
- The effective ceiling `maxDepth` is resolved as: explicit runtime override
  (env `PI_DELEGATE_MAX_DEPTH`) → config `maxDelegateDepth` → built-in default
  **`2`**. The value MUST be a non-negative integer.
- A child's ceiling MUST be `min(parentCeiling, agentDefinition.maxSubagentDepth)`
  when the agent declares one; children may only *tighten*, never *loosen*.
- The gate: a `delegate` call at a run where `depth >= maxDepth` MUST return
  `DEPTH_BLOCKED` for every requested run.

### 7.2 Cycles

- Each run MUST be assigned a fresh, process-unique `runId` at creation (e.g. a
  random token). The implementation MUST maintain a **lineage path**: an ordered
  list of entries `{ runId, agent? }`, one per ancestor run, appended at each hop.
- Before creating a child for agent `X`, if `X` already appears in the lineage
  path (compared by `agent` identity), the call MUST return `CYCLE_DETECTED` with a
  message naming the cycle (e.g. `A → B → A`). It MUST NOT spawn the child.
- The lineage path MUST be length-capped (default cap **8**) as an independent
  backstop: even a non-repeating chain MUST NOT nest beyond the cap. Reaching the
  cap MUST refuse the run with `DEPTH_BLOCKED` and a message stating the nesting
  cap was reached (the parent's remedy — do the work directly — is the same as a
  depth block, so the code is shared).
- Inline (`agent`-less) children have no stable agent identity; for those, cycle
  detection MUST fall back to the depth and path-cap backstops.

---

## 8. Model / tools / prompt resolution (requirement #3)

For every field, **per-call override > agent definition > project config > user
config > built-in default**. Depth ceilings are the exception: always `min`-clamped
down the tree (§7.1).

### 8.1 Model

- Format: `provider/model[:thinking]`. A `:thinking` suffix sets the child's
  thinking level; a separate `thinking` field applies only when the model string
  carries no suffix.
- Resolution order (§8 precedence): per-call `model` → agent definition `model` →
  **inherit the parent run's current model**. The parent always has a model, so a
  model normally resolves; `NO_MODEL_OR_AUTH` is reserved for the cases below.
- `fallbackModels` MUST be tried in order when the primary model cannot start
  (e.g. missing credentials). If every candidate (primary + fallbacks) fails to
  start, the run result is `NO_MODEL_OR_AUTH`.
- If a model is named but cannot be resolved to a known provider/model, or has no
  credentials and no working fallback, the run result MUST be `NO_MODEL_OR_AUTH`.

### 8.2 Tools

- **Normalization.** A `tools` value MUST be normalized to a name set: a string is
  split on commas; entries are trimmed; empty entries and duplicates are dropped.
  An array is treated the same after trimming and de-duplication.
- The child receives **only** the **effective allowlist** via `--tools` (§3.2):
  `(resolved tool list) ∩ (ceiling)`. The **ceiling** is the spawning run's active
  builtin tools — for the root parent, read via `pi.getActiveTools()` minus
  `delegate`; for a nested authorized child, its own resolved tool set. A child MUST
  NOT receive a builtin tool the spawning run itself lacks.
- A per-call `tools` override MUST be able to **narrow** but MUST NOT **widen**
  beyond the ceiling. A request for a tool outside the ceiling MUST yield
  `TOOL_NOT_PERMITTED` for the whole run (confirmed §-choice: fail loudly rather
  than silently degrade capability).
- **v1 grants builtin tools only.** Valid names are the Pi builtins: `read`,
  `grep`, `find`, `ls`, `edit`, `write`, `bash`. Extension and MCP tools are **not**
  grantable to a child in v1, because a v1 child loads only the single-purpose child
  providers it needs (§3.4) and none of the parent's extensions/MCP tools; a name
  outside the builtin set yields `TOOL_NOT_PERMITTED`. Granting extension/MCP tools
  to children is reserved for a later tier.
- `delegate` is never a `--tools` entry. For an authorized child it is provided by
  the loaded delegate provider (§3.4, §6), not requested through `tools`. A `tools`
  list naming `delegate` MUST yield `TOOL_NOT_PERMITTED`.

### 8.3 Prompt

- The child system prompt is delivered as a **temporary file** (§3.5) referenced
  by a CLI flag (§3.2): `promptMode = "replace"` → `--system-prompt <file>`
  (replaces Pi's base prompt); `promptMode = "append"` → `--append-system-prompt
  <file>` (appended to Pi's base prompt).
- Composition order for the child **system-prompt file**, top to bottom: (1) the
  base prompt (append mode) or the replacement prompt (replace mode), (2) the agent
  body and/or the per-call `prompt`, (3) when an output schema applies, the
  structured-output directive (Appendix B).
- The per-task objective (`task`) is **not** part of the system-prompt file. It is
  delivered as the child's initial **user turn** (a positional argument to `pi`,
  §3.2). It therefore sits last in the child's context — in the recency window,
  after the entire system prompt — without being interpolated into any flag.
- Inheritance is applied through the child's CLI flags (§3.2):
  `inheritProjectContext = false` MUST suppress context files (`AGENTS.md` and the
  like); `inheritSkills = false` MUST pass `--no-skills`.
- Extensions: a v1 child loads **only** the single-purpose child providers it needs
  (§3.4) and none of the parent's other extensions — the structured-output provider
  when a schema applies, the delegate provider when authorized, both when both,
  neither otherwise. A per-agent extension allowlist is deferred — the v1
  frontmatter (§5.2) has no `extensions` field.

### 8.4 Structured / expected output

Two levers, usable together:

1. **Soft directive (default).** The parent expresses a desired response shape in
   natural language within `task`/`prompt`. The implementation does not synthesize
   or validate it; it is ordinary prompt text. Use this when no machine-checkable
   contract is needed.
2. **Hard contract (`outputSchema`).** When present:
   - The schema MUST be a JSON Schema **object** at the root; otherwise
     `SCHEMA_INVALID` before any child is spawned.
   - The child MUST receive a `structured_output` tool — registered by the loaded
     **structured-output provider** (§3.4), with the schema supplied via `schema.json`
     (§3.5, path in `PI_OUTPUT_SCHEMA`) and a directive to finish by calling it once
     (Appendix B). This provider loads independently of delegation, so a tool-free,
     non-delegating child can still return a structured value.
   - After the child run ends, the implementation MUST validate the captured
     payload (`output.json`, §3.8) against the schema (TypeBox `Compile`). On missing
     or invalid payload, the run result MUST be `SCHEMA_INVALID` with a concise
     validation message; the parent MAY retry.
   - On success, the validated object is returned as `structuredOutput` (§4.3).

---

## 9. Parallel execution (requirement #4)

- A parallel `delegate` call MUST run its specs concurrently up to `concurrency`
  (default **4**; clamped to `maxConcurrency`, default **8**; §11). Order of results
  MUST match input order regardless of completion order.
- `concurrency` bounds one `delegate` call. Because a parent MAY issue more than one
  `delegate` call concurrently (parallel tool execution), the implementation MUST
  also enforce a process-wide cap, `maxInFlightChildren` (default **8**, §11), on
  the total number of simultaneously-running children. When the global cap is
  reached, additional ready children MUST queue (not error) until a slot frees.
- **Non-overlap is the parent's responsibility.** The tool description MUST state
  this (Appendix A). The implementation MUST NOT attempt to detect or auto-resolve
  conflicts between parallel children. It MAY offer per-child `cwd` isolation (§10)
  as a mechanism the parent opts into.
- `failFast=true` MUST, on the first child that finishes with `status="error"`,
  abort in-flight children (via the shared run `AbortController`) and skip
  not-yet-started ones; aborted children carry `status="aborted"`. A `status="blocked"`
  result (a deterministic guard refusal, §7) MUST NOT trigger `failFast`, since it
  reflects this spec's configuration, not a runtime failure of its siblings.
  `failFast=false` MUST run all children to completion and report each independently.
- A parallel call MUST apply the preflight checks (§4.5), including the depth and
  cycle guards (§7), to **each** spec independently before starting it; blocked
  specs return their guard result and do not start.

---

## 10. Isolation, streaming, cleanup, untrusted output

- **Sessions** MUST be ephemeral and isolated: each child is spawned with session
  writing disabled (`--no-session`) or directed to a per-run temporary session
  directory, and MUST NOT read or write the parent's session file (§3.6). Any
  ephemeral session directory MUST be removed after the run, including on error and
  abort.
- **Untrusted child output.** A child's output is data produced by a separate model
  run; it MUST be returned to the parent as **tool-result content**, never injected
  as a user or system instruction, so the parent treats it as a result rather than a
  command. The implementation SHOULD label the returned text as the child's result
  (e.g. a short `from agent "<name>"` prefix) so a child cannot impersonate the
  user or steer the parent by emitting instruction-shaped text.
- **Streaming**: the implementation MUST capture each child's `stdout`/`stderr`
  and forward incremental progress to the parent via `onUpdate` (§9), parsing the
  `--mode json` `AgentEvent` stream (§3.7). v1 MAY forward **coarse** progress — at
  minimum `turn_start` and `tool_execution_start`/`end` boundaries — and SHOULD
  include streamed assistant text (`message_update`/`message_end`) where available.
  The path is cross-process (child stdout), not shared memory; no control channel
  back into the child is required in v1.
- **Working directory**: default to the parent `cwd`. The implementation MAY accept
  a per-child `cwd` (or a temp directory) to support parent-orchestrated isolation
  of parallel writers. It MUST NOT silently relocate a child's `cwd`.
- **Output bounds**: inline `output` MUST be truncated to `maxOutputLines` (§4.2).
  `structuredOutput` is the validated object; the implementation MAY reject a
  payload above a size bound as `SCHEMA_INVALID` to protect parent context.
- **Run budget**: the implementation MAY enforce a per-run wall-clock timeout
  (`runTimeoutMs`, §11); on expiry the run result is `TIMEOUT` and the child is
  terminated (§3.7). When unset, no timeout applies and the child runs to its own
  loop completion.
- **Temp files**: per-run inputs (`prompt.md`, and `schema.json` / `output.json`
  when an output schema applies) MUST be created mode `0600` inside a per-run
  temporary directory created mode `0700` (§3.5), placed **outside** the child's
  `cwd` so the child's own tools cannot read or overwrite them, and removed on
  completion, error, and abort (best-effort).

---

## 11. Configuration reference

`config.json` (at `~/.pi/agent/extensions/delegate/config.json`). All values are
non-negative integers unless noted; the listed defaults are RECOMMENDED and the
implementation SHOULD use them when the key is absent:

| Key | Type | Default | Meaning |
|---|---|---|---|
| `maxDelegateDepth` | integer ≥ 0 | `2` | Default depth ceiling (§7.1). |
| `defaultConcurrency` | integer ≥ 1 | `4` | Default per-call parallel concurrency (§9). |
| `maxConcurrency` | integer ≥ 1 | `8` | Hard cap on per-call concurrency (§9). |
| `maxInFlightChildren` | integer ≥ 1 | `8` | Process-wide cap on simultaneous children across all `delegate` calls (§9). |
| `lineagePathCap` | integer ≥ 1 | `8` | Lineage-path length cap (§7.2). |
| `defaultMaxOutputLines` | integer ≥ 1 | `1000` | Default inline-output cap (§4.2). |
| `runTimeoutMs` | integer ≥ 0 | `0` (off) | Per-run wall-clock timeout (§10); `0` disables. |
| `piBinaryPath` | string | unset | Explicit path to the `pi` executable; overrides PATH resolution (§3.1). |

Environment overrides (highest precedence for the field they name):
`PI_DELEGATE_MAX_DEPTH` (integer) overrides `maxDelegateDepth`.

---

## 12. Conformance checklist

An implementation conforms to v1 when all hold:

1. Registers exactly one tool `delegate` with the §4.2 schema and §4.4 error
   results (refusals returned, not thrown), evaluated in the §4.5 preflight order.
2. Executes children as separate `pi` **subprocesses**, each spawned with a
   resolved `--tools` allowlist (never exceeding the parent ceiling), the resolved
   `--model`, a system-prompt temp file, isolated/ephemeral sessions, the required
   single-purpose child provider(s) (structured-output and/or delegate, §3.4), and
   child progress forwarded to `onUpdate` (§3).
3. Discovers user- and project-scoped agent definitions with project-over-user
   precedence (§5).
4. Enforces depth (default `2`, `min`-clamped) and explicit agent-identity cycle
   detection, with a path-cap backstop, **before** spawning any child (§7).
5. Gates child delegation by tool absence (definition-only `canDelegate`), honors
   `delegateAgents` for immediate targets, and conveys authorization as a
   non-forgeable per-child capability token an unauthorized child never receives
   (§6).
6. Resolves model/tools/prompt with the §8 precedence; grants builtin tools only;
   never widens a child's tool set beyond the ceiling.
7. Validates `outputSchema` results and returns `SCHEMA_INVALID` on miss/invalid
   (§8.4).
8. Runs parallel specs with ordered results, `concurrency`/`maxInFlightChildren`
   caps, `failFast`-on-error-only semantics, and per-spec preflight checks (§9).
9. Propagates the parent `signal` to terminate all in-flight children, and cleans
   up child processes, ephemeral sessions, and `0600` temp files on success, error,
   and abort (§10).
10. Returns child output as labeled tool-result data, never as parent-facing
    instructions (§10).

---

## Appendix A — model-facing text: the `delegate` tool (parent)

> Authored under the contexting principles: task first, positive instructions, one
> referent per term, closed sets, parent responsibility stated explicitly. Final
> wording is owned by `DESIGN.md`; this is the normative baseline.

**Tool description:**

> Delegate a self-contained task to a child agent with its own model, tools, and
> prompt, and get its result back. Use one child for one focused task; use
> `parallel` to run several independent children at once. You assign each child a
> non-overlapping slice of work — children do not coordinate with each other, so
> two children given the same files may conflict. Give each child everything it
> needs in `task`; it does not see this conversation.

**`task` (parameter):** "The complete instruction for this child, written so it can
act without seeing this conversation."

**`parallel` (parameter):** "A list of independent children to run at once. Assign
each a separate slice of work; overlapping slices may conflict."

**`outputSchema` (parameter):** "A JSON Schema object. When set, the child returns
a value matching it instead of free text."

**Injected capability note** (added to the parent's prompt at `before_agent_start`,
one line; the recency-ordered objective stays the user's):

> You can call `delegate` to hand a focused task to a child agent (single or
> `parallel`). Assign non-overlapping work; you are responsible for splitting it.

---

## Appendix B — model-facing text: child structured-output directive

Appended to the child's prompt only when an `outputSchema` applies. Positive,
single instruction, placed last:

> Finish by calling `structured_output` exactly once with a value matching its
> schema. That call is your answer; do not also summarize in prose.
