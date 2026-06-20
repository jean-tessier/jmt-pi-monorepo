# pi-delegate — Design & Internals (v1)

> Status: **Seed.** Companion to `SPEC.md` (normative contract) and
> `IMPLEMENTATION-PLAN.md` (staged build). This document explains *how* the
> subprocess backend (`SPEC.md` §3) is built and records open design questions.
> Where this document and `SPEC.md` disagree, `SPEC.md` is authoritative.
>
> Backend: **subprocess** — each child runs as a separate `pi` process
> (`SPEC.md` §3). The embedded backend is a v2 backlog item (`SPEC.md` §1).

---

## Open design questions

Internal mechanism choices that are settled enough to spec but not yet validated
against Pi's confirmed CLI/extension surface. Each names the SPEC decision it
provisionally backs, so revising it later is a scoped change.

### OQ-1 — Structured-output delivery in the subprocess backend

**Context.** `SPEC.md` §8.4 requires a child to receive a `structured_output` tool
whenever an `outputSchema` applies — including for an otherwise tool-free *leaf*
child. In the (deferred) embedded design this was a trivial `customTools` entry.
The subprocess backend has no in-process tool-injection hook, so `SPEC.md` §3.4
currently specifies a **single `pi-delegate` child provider** loaded into every
child via `--extension`, self-gating: it registers `structured_output` when
`schema.json` is present (§3.5) and `delegate` only when a valid `PI_DELEGATE_TOKEN`
is present (§3.3).

**Decision recorded in v1:** option **A** below (provider self-gating). This item
exists to confirm or revise that mechanism once Pi's `--extension` loading and any
native structured-output surface are verified (ties to research **Q3** CLI-flag
stability and **Q5** permissions/sandbox).

**The question.** Is loading the delegate provider into *every* child the right way
to deliver `structured_output`, or is there a lighter path for the schema-only,
non-delegating case?

**Options.**

- **A — Single self-gating provider (current SPEC choice).** One extension arms
  `structured_output` on schema presence and `delegate` on token presence.
  *Pro:* one artifact to build, version, and ship; uniform child setup.
  *Con:* every child — even a read-only leaf that needs only structured output —
  loads delegation code; the provider MUST robustly refuse to arm `delegate`
  without a valid token, making that refusal a security-critical default.

- **B — Native Pi structured-output path** (e.g. a `--output-schema` flag or a
  built-in `structured_output` tool). **RULED OUT — verified against pi 0.79.8
  (see Verification below).** No such surface is reachable from a subprocess child.
  Retained only as a record of the option considered.

- **C — Two separate extensions** — a minimal `structured-output` provider and a
  distinct `delegate` provider, loaded independently.
  *Pro:* smallest surface per child; a leaf child that only needs structured output
  loads no delegation code at all; clean separation of concerns.
  *Con:* two artifacts to build/version/ship; marginally more install/packaging
  complexity.

**Sub-questions to close regardless of option.**

- *Path passing.* How does the provider learn the schema/output paths? Proposed:
  env vars (`PI_DELEGATE_SCHEMA`, `PI_DELEGATE_OUTPUT`) pointing at the §3.5 temp
  files, which sit outside the child `cwd` so the child's builtin tools cannot reach
  them.
- *Write vs. emit.* Does the child's tool write `output.json` directly, or emit the
  payload on stdout for the parent to persist? `SPEC.md` §3.8 reads `output.json`,
  which favors the provider writing the file.
- *Validation locus.* Child-side (provider validates before writing, fails the
  child early) vs. parent-side (parent validates after read, §3.8). `SPEC.md` §3.8
  puts the **authoritative** validation parent-side; the provider MAY pre-validate
  for a faster in-child error, but the parent's `Compile` check is the gate.

**Verification (pi 0.79.8, packed `dist`).** Three checks, all negative for B:

- The CLI `Args` interface (`packages/coding-agent/src/cli/args.ts`) enumerates
  every accepted flag — `--model`, `--tools`, `--no-tools`, `--no-builtin-tools`,
  `--system-prompt`, `--append-system-prompt`, `--extensions`, `--no-extensions`,
  `--no-skills`, `--no-context-files`, `--session-dir`, `--no-session`, `--mode`,
  and more — and contains **no** `--output-schema` / `responseFormat` / schema flag.
- `@earendil-works/pi-coding-agent` ships **no** `structured_output` tool factory
  (no match in the published `dist`); structured output is not a first-party tool.
- The only schema-adjacent control in `@earendil-works/pi-ai` is `toolChoice`
  (`"auto" | "any" | "none" | "required" | {…}`) on the provider stream options —
  tool *forcing*, not response-schema validation, and **in-process only** (not
  exposed through the `pi` CLI). A subprocess child cannot reach it.

Net: hard structured output via the subprocess backend MUST come from a
provider-supplied `structured_output` tool. **The live decision is A vs. C.**

**Useful by-product — `--mode json`.** Pi can stream every session event as JSON
lines (`AgentEvent`: `turn_start`, `tool_execution_start/update/end`,
`message_start/update/end`, `turn_end`, `agent_end`). This is not schema
enforcement, but it is the structured stdout contract the streaming/result paths
need: spawn children with `--mode json`, forward parsed event boundaries to
`onUpdate` (§3.7/§10), and capture the final `AgentMessage` from `agent_end`
(or the last `message_end`) for `SPEC.md` §3.8 rather than scraping freeform text.
This resolves **OQ-3** and tightens §3.8; `SPEC.md` now references `--mode json`
as the concrete capture mechanism (§3.2, §3.7, §3.8, §10).

**Decision (v1): C — two separate providers.** Structured output is delivered by a
standalone **structured-output provider** (registers only `structured_output`,
armed by `PI_OUTPUT_SCHEMA`/`PI_OUTPUT_FILE`), loaded à la carte alongside the
**delegate provider** (registers only `delegate`, armed by `PI_DELEGATE_TOKEN`).
A leaf child that only returns a structured value loads **no** delegation code;
an authorized free-text child loads no structured-output code; both load only when
a run needs both. Recorded in `SPEC.md` §3.2–§3.5, §6, §8.2–§8.4, §12. Chosen over
**A** (single self-gating provider) for the smaller per-child surface and clean
separation of concerns, accepting two shippable artifacts, distributed as **two
packages**: `pi-delegate` (parent extension + child-side delegate provider) and
`pi-structured-output` (standalone). **B is closed** (ruled out above).

For the deferred embedded backend (v2), `toolChoice: "required"` on a forced
`structured_output` tool call is the natural in-process equivalent; note it in the
v2 backlog.

---

### Other open items (to expand as they arise)

Logged here for visibility; fill in the OQ-1 structure when each is taken up.

- **OQ-2 — Provider/auth inheritance.** `SPEC.md` §3.3 passes the host environment
  through to the child so it authenticates without re-plumbing keys. Confirm this
  holds for every supported provider/credential mechanism, and that nothing
  sensitive beyond what's needed is forwarded.
- **OQ-3 — Streaming fidelity.** *Largely resolved (see OQ-1 Verification).* Pi's
  `--mode json` emits a structured `AgentEvent` line stream; v1 parses turn/tool
  boundaries from it for coarse `onUpdate` progress (`SPEC.md` §3.7/§10) and reads
  `agent_end`/`message_end` for the final result (§3.8). Remaining choice: whether
  to forward streamed assistant text (`message_update`) or stop at coarse
  boundaries for v1.
- **OQ-4 — Child execution sandboxing.** v1 ships `bash`/`write`-capable agents
  (`IMPLEMENTATION-PLAN.md` Task 28, G26), so the child trust model is committed
  work, not just a question. A child `pi` subprocess inherits the parent's OS
  identity and permissions by default; the subprocess boundary gives process
  isolation, not a security sandbox. v1 lean: (a) confirm the inherited
  filesystem/exec/network scope (the **Q5** spike), (b) default write/bash children
  to per-child `cwd` confinement (`SPEC.md` §10), (c) document the trust boundary
  plainly, and (d) expose an optional `sandboxCommand` config that wraps the spawn
  (`bwrap`/`firejail`/container), deferring built-in seccomp/landlock to a later
  tier.

---

## Sections to be written

Skeleton per research doc §5 (`SUBAGENT-EXTENSION-RESEARCH.md`). Each will document
the subprocess backend now that embedded is deferred:

1. **Execution internals** — binary resolution; the arg/env builder; prompt &
   schema temp-file lifecycle; process spawn/wait; streaming via `onUpdate`;
   cancellation via `signal` → `SIGTERM`/`SIGKILL`.
2. **Depth & cycle propagation** — env threading (`PI_DELEGATE_DEPTH`/`_MAX_DEPTH`/
   `_PATH`); `PI_DELEGATE_PATH` sanitization and the `min`-clamp.
3. **Capability gating** — the two single-purpose child providers (delegate,
   structured-output), the per-child token, and the load-à-la-carte / register-on-
   token mechanism (`SPEC.md` §3.4/§6).
4. **Module layout & sequence diagrams** — single, parallel, and nested delegation.
5. **Failure handling** — error-taxonomy mapping, timeouts, cleanup, telemetry
   hooks.
