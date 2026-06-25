# Shared Protocol — Source of Truth

> **This file is an operator reference, not a runtime prompt.** The six agent prompts in this folder were derived from it and conform to it. It exists so the contract — status vocabulary, envelopes, role definitions, loop parameters — lives in exactly one place. When you change a route or a status here, change the affected prompt(s) to match.

## Topology: hub-and-spoke, plus a write-path service

**Work routing is pure hub-and-spoke.** The work-spokes (Planner, Explorer, Coder, Executor, Reviewer, Arbiter) never coordinate work with each other. Each is dispatched by the **Orchestrator**, does its work, and returns a result the Orchestrator routes by `status`. There is no worker-to-worker work channel, and the Orchestrator is the only router.

**Persistence runs beside the loop, through one service.** The **Scribe** is a write-path service, not a control-flow spoke: any agent — a work-spoke *or* the Orchestrator — may call it to capture a durable document, and it returns a receipt (a doc pointer), not a work handoff. It routes no work, hands nothing back for execution, and never writes source or trunk. So "any agent can persist" does not reintroduce worker-to-worker coordination — capturing a document is persistence, not delegation, and the work loop still runs only through the Orchestrator.

Consequence for the prompts: a work-spoke prompt carries only **its own** work I/O contract, a short canonical picture of the team, and a thin capture call. It never reads another spoke's output. The Orchestrator holds the full routing table; the Scribe holds the persistence mechanics.

```
                    ┌──────────────┐        invoke on APPROVED
     goal ─────────▶│ Orchestrator │─────────────▶ [merge gate] ──▶ trunk
                    └──────┬───────┘
            dispatch       │ routes on status, owns counters
            envelopes      ▼
       ┌────────┬───────┬────────┬─────────┬─────────┐
       ▼        ▼       ▼        ▼         ▼         ▼
    Planner Explorer Coder  Executor  Reviewer  Arbiter    (Coder writes source to
       │        │      │        │         │         │       its branch; Executor runs
       │        │      │        │         │         │       commands in the workspace)
       └────────┴──────┴────────┴─────────┴─────────┴───┐
                  capture │ (+ Orchestrator)             │ receipt
                          ▼                              ▲
                     ┌─────────┐                         │
                     │ Scribe  │─────────────────────────┘
                     └────┬────┘
                          ▼
        docs / knowledge / trace store   (sole writer; maintains the manifest)
```

## Canonical roles (use these one-liners verbatim wherever a prompt describes a teammate)

- **Orchestrator** — Owns the loop counter and routes every agent by its emitted status; invokes the merge gate on green; escalates to the Arbiter on k-trip. Does not plan, explore, write code, or review.
- **Planner** — Produces the approach and the task-DAG as two independently-addressable outputs. Requests facts; does not gather them or write code.
- **Explorer** — Read-only over the codebase (never mutates source). Answers specific questions with a provenance-tagged findings map; persists durable facts as codebase guidance.
- **Coder** — Implements assigned task-DAG nodes on a branch. Cannot merge to trunk.
- **Executor** — Runs the shell commands and scripts the team needs run — the plan's operational steps (builds, migrations, codegen, data jobs, captured scripts) and the Reviewer's verification runs — and reports the result. Side-effects stay on the branch/workspace and remain subject to review; never advances trunk and authors no source.
- **Reviewer** — Two mandatory phases — coverage hunt, then quality/fit. Decides what must run and delegates execution to the Executor, then judges the results; emits findings; writes and runs no code itself.
- **Arbiter** — Invoked only on k-trip. Issues one binding ruling to break thrash and records it as an ADR. Read-only over the codebase.
- **Scribe** — Write-path service. The single writer to the docs/knowledge/trace store; captures durable documents (plans, ADRs, codebase guidance, reusable scripts, run logs) on request from any agent and maintains the manifest. Writes no source and never touches trunk.

## Status vocabulary (closed set, globally unique tokens)

Every worker result ends with a `status`. Tokens are unique across all agents so the Orchestrator routes on the token alone.

| Token | Emitter | Means | Orchestrator route |
|-------|---------|-------|--------------------|
| `PLAN_READY` | Planner | approach + task-DAG produced | Begin/continue the DAG: dispatch Explorer for any node whose `needs_facts` is open, else dispatch Coder on dependency-clear nodes |
| `NEED_FACTS` | Planner | a planning decision hinges on an unknown | Dispatch Explorer with the questions; on `FACTS_READY` re-dispatch Planner |
| `FACTS_READY` | Explorer | questions answered, tied to `base_ref` | Hand facts to the requester (Planner or Coder) and continue |
| `FACTS_INCONCLUSIVE` | Explorer | a fact could not be established from the repo | Fact-gap path (below) — never silently assume |
| `TASK_DONE` | Coder | node implemented on its branch | Dispatch Reviewer (phase 1) |
| `CODER_BLOCKED` | Coder | cannot implement as specified | `blocked_on=facts` → Explorer; `blocked_on=plan` → Planner. Counts as a node bounce |
| `RUN_PASSED` | Executor | command/script ran and met its success criteria | Route by the recorded requester: a Reviewer-requested run → hand results back to the Reviewer (no bounce). Else mark the run complete and advance; if it left shippable branch changes, route them to the Reviewer like any code |
| `RUN_FAILED` | Executor | ran but failed (non-zero, failed assertion, timeout) | Route by the recorded requester: a Reviewer-requested run → back to the Reviewer to judge (no bounce). Else route the fix by what was run — Coder branch build → Coder; wrong plan step → Planner; missing precondition → fact-gap — and count a node bounce |
| `RUN_BLOCKED` | Executor | could not run as specified | A Reviewer-requested run → back to the Reviewer to re-spec or proceed (no bounce). Else `blocked_on=command\|script` → source of the spec (Planner or Coder); `=precondition` → fact-gap; `=safety` (refused) → ESCALATE or re-spec. Counts as a node bounce |
| `REVIEW_NEEDS_RUN` | Reviewer | needs commands run to verify (tests, lint, type-check) | Dispatch Executor for each requested run, recording the Reviewer as requester; route the results back to the Reviewer. Not a node bounce |
| `COVERAGE_GAP` | Reviewer | phase 1 found untested/under-asserted behavior | Re-dispatch Coder with the gaps. Counts as a node bounce |
| `CHANGES_REQUESTED` | Reviewer | phase 1 clean, phase 2 found quality/fit problems | Re-dispatch Coder with the findings. Counts as a node bounce |
| `APPROVED` | Reviewer | both phases pass — green | Invoke the merge gate; on green, mark node complete and advance |
| `RULING` | Arbiter | binding decision that ends the loop on a node | Execute the ruling; reset that node's bounce counter |

The Orchestrator's own terminal statuses: `DONE` (all nodes merged) and `ESCALATE` (handed to a human with state).

## Loop control

- **Bounce counter** — per task-DAG node, the Orchestrator increments `bounce` on every re-dispatch of that node, regardless of which pair is bouncing (Coder↔Reviewer *or* Coder↔Planner). One counter per node covers all thrash on that node.
- **k-trip** — when a node's `bounce >= k`, the Orchestrator dispatches the **Arbiter** instead of the normal re-dispatch. Default `k = 3`.
- **Iteration cap** — a global maximum on total dispatches across the run. On cap, the Orchestrator emits `ESCALATE` with current state. Default cap = 60. (Safety stop for unattended runs.)
- **Fact-gap path** — on `FACTS_INCONCLUSIVE`: first occurrence, re-dispatch Explorer once with a narrowed question *or* dispatch Planner to re-plan around the unknown; if it recurs to k-trip on the same fact, dispatch the Arbiter to rule `proceed-with-stated-assumption` vs `ESCALATE_HUMAN`. The unknown is never silently filled.
- **Review runs are not bounces** — a review can take two passes: the Reviewer emits `REVIEW_NEEDS_RUN`, the Executor runs the commands, and the Reviewer judges the relayed results. These execution round-trips (and the Executor results routed back to the Reviewer) do **not** increment `bounce` — only a verdict that sends work back to the Coder (`COVERAGE_GAP` / `CHANGES_REQUESTED`) does. They remain bounded by the iteration cap.

## The merge gate

"The gate" is a mechanism, not an agent: the merge-to-trunk action (e.g., a CI/branch-protection merge), invoked **only by the Orchestrator and only on `APPROVED`** (or an Arbiter ruling that authorizes merge). No agent merges to trunk. The Coder has no merge tool; the gate is how trunk advances.

## Dispatch envelope (Orchestrator → worker)

Thin. Carries pointers, never bulk (Principle 9). The worker reads artifacts by ref.

```json
{
  "to": "Planner | Explorer | Coder | Executor | Reviewer | Arbiter",
  "node": "<node-id, or null for whole-plan work>",
  "objective": "<one-line task for this dispatch; for Executor, what success looks like>",
  "base_ref": "<commit or branch the work is anchored to>",
  "branch": "<target branch for Coder or the Executor's workspace, else null>",
  "inputs": {
    "plan_ref": "<pointer to approach + task-DAG, or null>",
    "findings_refs": ["<pointers to Explorer findings, or empty>"],
    "reviewer_findings": "<pointer, present on Coder re-dispatch, else null>",
    "ruling": "<pointer, present after an Arbiter ruling, else null>",
    "questions": ["<specific questions, for Explorer, else empty>"],
    "command": "<literal command for the Executor, or null>",
    "run_ref": "<pointer to a captured script for the Executor to run, or null>",
    "run_results": ["<Executor results relayed to the Reviewer after REVIEW_NEEDS_RUN, or empty>"],
    "revise": "approach | task_dag | both | null",
    "reason": "<why this dispatch / what to fix, or null>"
  },
  "bounce": 0
}
```

## Result envelope (worker → Orchestrator)

A worker emits its human-readable work (findings, diff summary, plan, rationale) first, then this fenced block **last** as the machine-routable contract. The Orchestrator parses the final `json` block; the prose above it is the artifact/log.

```json
{
  "agent": "<role>",
  "status": "<one token from the vocabulary>",
  "node": "<node-id or null>",
  "payload": { "...": "status-specific, defined in each prompt" },
  "artifacts": [{ "kind": "plan | adr | guidance | script | run-log | exec-log | diff | manifest", "ref": "<store path>" }]
}
```

## Artifact persistence and traceability

Durable artifacts are written to disk as markdown (scripts captured with their code and usage) so a run stays traceable after the agents' messages are gone. Two things make this work: a rule for *what* earns a file, and a single writer that owns *how* it gets written.

**What earns a file.** Persist when an output is **decision-bearing or reusable beyond the current node** — a plan, a binding ruling, a structural codebase fact a later task would rely on, a script someone would run again. **Keep ephemeral** (message only, no file) for process: routing lines, one-off question answers, single-node diff summaries, clean review passes. When unsure, persist decisions and reusable knowledge; do not persist process. Explorer findings split on this line: a durable fact becomes a guidance doc and enters the manifest, while a one-off answer stays in the Explorer's message and is relayed by the Orchestrator, unfiled. ("Traceable" here means a navigable trail of what was decided and built — not a transcript of every turn.)

*The decision of what earns a file stays with the domain agent* — it has the context to judge. *The mechanics of writing it* — formatting, naming, provenance, supersession, indexing — belong to one specialist: the **Scribe**.

### The Scribe is the single writer to the durable store

Three stores, one authority each:

| Store | Write authority | Reaches it how |
|-------|-----------------|----------------|
| Branch (source) | **Coder** authors; **Executor** may add run side-effects | the Coder's code tools; the Executor's command/script runs — both on the branch, both upstream of Review |
| Trunk | **the merge gate** | the Orchestrator invokes it on `APPROVED` |
| Docs / knowledge / trace | **the Scribe** | any agent invokes the Scribe to *capture*; the Scribe writes |

Consequence (Principle 14): the **Planner, Explorer, Reviewer, Arbiter, and Orchestrator** have **no write tool at all** — they persist by handing content to the Scribe, which makes them structurally read-only (they can only ask the Scribe to record). The two agents with side-effecting power are the **Coder** (authors source) and the **Executor** (runs commands that may mutate the workspace); **everything either of them leaves on a branch passes Review before the gate merges it**, so trunk has exactly one writer regardless. Neither can write the docs store (only the Scribe does) and neither can advance trunk (only the gate does) — so no agent's writes add a path to corrupt trunk, and persistence adds none either. The store layout below is enforced by the Scribe's `doc_type`→path mapping, so paths are correct regardless of which agent called.

### Store layout (path convention; roots configurable, defaults shown)

```
docs/
  plans/<plan-id>.md            # plan-of-record (approach + task-DAG)   — author: Planner
  decisions/ADR-<n>-<slug>.md   # one ADR per ruling, immutable          — author: Arbiter
  codebase/<topic>.md           # durable, provenance-stamped guidance   — author: Explorer
  scripts/<name>.md             # reusable script + usage + provenance   — author: Coder
  trace/runs/<run-id>/
    log.md                      # routing trace (run-level)              — author: Orchestrator
    exec/<node>.md              # command output, one per run step       — author: Executor
    manifest.md                 # index of every artifact in the run     — maintained by the Scribe
```

ADRs are immutable — superseded by later ADRs, never edited in substance. Live docs (plans, guidance) are updated in place so they stay coherent; git history is the revision trace.

### Capturing: the request and the receipt

An agent persists by sending the Scribe a **capture request** and receiving a **receipt** synchronously. The receipt is **out-of-band** — consumed by the calling agent, *not* routed by the Orchestrator (the Scribe is not in the status routing table). Scribe calls do **not** count against the iteration `cap`.

Capture request (any agent → Scribe):
```json
{
  "op": "capture",
  "doc_type": "plan | adr | guidance | script | run-log | exec-log",
  "title": "...",
  "body": "<the markdown substance the author wrote>",
  "supersedes": "<prior doc-id, or null — the Scribe auto-supersedes the same (run, doc_type[, topic]) scope>",
  "node": "<node-id or null>",
  "base_ref": "<commit or null>",
  "run_id": "<this run>",
  "author_agent": "Planner | Explorer | Coder | Reviewer | Arbiter | Orchestrator"
}
```

Lookup request (for discoverability before re-deriving knowledge):
```json
{ "op": "lookup", "by": "id | type | topic | run | text", "query": "..." }
```

Receipt (Scribe → caller; out-of-band):
```json
{
  "agent": "Scribe",
  "status": "CAPTURED | UPDATED | NOOP_DUPLICATE | LOOKUP_HIT | LOOKUP_MISS | REJECTED",
  "doc_id": "<assigned or matched id, or null>",
  "payload": {
    "path": "<store path>",
    "doc_status": "active | accepted | superseded",
    "supersedes": "<id or null>",
    "manifest_ref": "<path to this run's manifest>",
    "matches": ["<lookup only: {doc_id, type, title, doc_status, base_ref, path}>"],
    "reason": "<REJECTED only: why nothing was written>"
  },
  "artifacts": [{ "kind": "<doc_type>", "ref": "<path>" }]
}
```

The caller takes the receipt's `ref`/`path` and puts it in **its own** result envelope's `artifacts` — that is the link from the ephemeral work result to the durable record. Bulk is written once by the Scribe and read by ref; it never rides through the Orchestrator's context (Principle 9/10).

### The manifest is the trace entry point, maintained by the single writer

Because the Scribe writes every doc, it updates the run's `manifest.md` on every capture — doc_id, kind, path, producer, node, status, lineage — so the index is consistent *by construction*, not an aggregation step that can fall out of sync. One manifest per run points to every plan, ADR, guidance doc, and script; `log.md` (captured by the Orchestrator via the Scribe) records the dispatch sequence. The two together make a run navigable without replaying a single message. `lookup by=id` returns a full doc; `lookup by=type|topic|run|text` returns manifest entries (the small map) so a caller fetches detail by id on demand — and each entry carries its `base_ref`, so recorded knowledge can be judged for staleness. Current ground truth is still the Explorer's job, not the Scribe's.

## Caching discipline (Principle 12)

Each runtime prompt is split: a **stable prefix** (role, team, method, tool boundary, output contract) and a **volatile slot** at the very bottom where the dispatch envelope is injected per call. The stable prefix is byte-identical across dispatches of the same agent, so it is cache-hittable; the per-task objective lands last, in the recency window (Principle 4).
