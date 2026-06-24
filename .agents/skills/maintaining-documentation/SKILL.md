---
name: maintaining-documentation
description: "Keeps documentation fresh by orchestrating multiple independent reviewers and cross-checkers against the current codebase. Run aggressively (every commit touching source files) or conservatively (every merge to main). Stale docs are a cost; misleading docs are far more expensive — multi-agent verification prevents capture."
---

# Maintaining Documentation Freshness

Documentation drifts silently. The goal of this skill is not to rewrite docs — it is to detect and correct divergence between what the docs claim and what the code actually does, before the next reader is misled.

<HARD-GATE>
Do NOT accept "probably still accurate" as a conclusion. Every claim in documentation that touches code behavior, APIs, configuration, or architecture must be verified against the current source. Unverified sections must be flagged, not assumed correct.
</HARD-GATE>

## Why Multi-Agent Verification

A single reviewer reading docs then reading code will unconsciously reconcile small contradictions in favor of the docs (anchoring bias). Independent reviewers — each approaching a section cold, without having read the others' verdicts — catch contradictions the first reviewer normalizes away.

Misleading documentation is far more expensive than stale documentation:
- Stale: reader notices something is old, consults the code directly.
- Misleading: reader trusts the doc, builds on a wrong mental model, ships a bug.

The multi-agent pattern here is adversarial by design: each checker's job is to find where the docs are wrong, not to confirm they are right.

## Scope

**"Source files"** means files under `packages/`, `src/`, or equivalent runtime-code directories with recognized extensions (`.ts`, `.js`, `.py`, `.go`, `.json` schemas, etc.). Configuration files, CI definitions, and skill/agent files are source files for this purpose. Commits touching only `docs/`, `.agents/`, `.superpowers/`, or `node_modules/` do not trigger a review.

This skill covers all human-facing documentation in the repository:

- `README.md` files at any level
- `docs/` directories (design docs, specs, ADRs, guides)
- Inline code comments that make behavioral or contractual claims (extracted as virtual doc entries — see Step 1)
- `CHANGELOG.md` — **most recent entry only**; historical entries accurately described past behavior and intentional divergence from current source is expected
- Configuration reference docs
- API reference docs: if hand-written, verify against actual API shape; if generated from source, **verify generator configuration only** (not the output file itself, which is generated)
- Any `.md` or `.txt` file cited by other docs

It does NOT cover:
- Generated doc output files (re-run the generator instead; generated *config* is covered above)
- `node_modules/`, `.git/`, or other vendor directories
- Test fixtures or test descriptions (those are verified by the test suite)
- Inline comments in test files (`*.test.ts`, `*.spec.ts`, files under `__tests__/`) — those are validated by the test runner

**Versioning note:** docs for older API versions should be reviewed against their corresponding source commit, not HEAD. If multi-version docs exist, note this as out-of-scope for this pass and flag for manual review.

## Cadence

**Aggressive (recommended for fast-moving codebases):** run on every commit that touches source files (as defined above). The overhead is low when docs are already fresh; the cost of letting drift accumulate is not.

**Conservative (minimum viable):** run on every merge to the main branch before the merge completes, as a required gate.

**Do NOT run** on commits whose only changes are doc files produced by this skill in the same session — that would immediately re-review your own corrections.

The skill exits early with no agent spawns if the source diff is empty (see Step 2).

## Spawning Mechanism

Use TaskCreate to spawn each reviewer and cross-checker as an independent task, capturing results via TaskGet. If TaskCreate is unavailable, spawn reviewers as parallel tool calls in a single orchestrator turn. In either case, no reviewer may see another reviewer's task output before the cross-check phase.

## Checklist

Complete these tasks in order:

1. **Inventory documentation** — collect all in-scope doc files; extract inline comments as virtual entries
2. **Identify changed code** — git diff since last doc-review ref; exit early if empty
3. **Fan out reviewers** — one agent per doc entry (capped; prioritized), each working independently
4. **Health-check reviewers** — verify all reviewers returned valid output before proceeding
5. **Fan out cross-checkers** — separate agents that attack reviewer findings for conflicts, coverage gaps, and severity errors
6. **Synthesize findings** — collect all flagged divergences, deduplicate, adjudicate conflicts, rank by severity
7. **Report and confirm** — present findings report; wait for user acknowledgment before applying any fix
8. **Apply corrections** — fix confirmed divergences; surface ambiguous ones for user input
9. **Commit corrections** — commit all applied fixes with a standard message
10. **Mark the review** — update the doc-review marker so the next run knows where to start

## Process

### Step 1 — Inventory Documentation

**Validate the review ref first:**
```
git cat-file -e <last-review-ref> 2>/dev/null || echo "INVALID"
```
If the ref is invalid (rebase, force-push, garbage collection), fall back to treating all source files as changed, log a warning, and overwrite the stale ref after the review.

**Collect every in-scope doc file.** For each, record:
- Path
- Last-modified commit (from `git log -1 --format="%H %ai" -- <path>`)
- Whether any source file it references changed since that commit

**Extract inline comments as virtual doc entries.** For source files whose referenced doc changed, or which are themselves new since the last review:
```
grep -n "//\|#\s\|/\*\*" <source-file> | grep -i "must\|should\|always\|never\|note\|important\|invariant\|contract"
```
Surface each match as a virtual entry `<source-file>#L<line>-comments` for the reviewer phase. Inline comments in test files are excluded.

**If the inventory is empty** (no in-scope docs found), emit "No in-scope documentation found. Nothing to review." and stop immediately. Do not spawn any agents.

A doc whose referenced source has not changed since the last review is low priority: give it an **internal-consistency scan** only (no source files required — see reviewer briefing variants in Step 3).

**Cap and prioritize if the inventory exceeds 20 entries.** Prioritize by:
1. Docs whose referenced source changed since last review
2. Docs last reviewed more than 30 days ago
3. Docs with the highest commit churn

Log which entries were deferred to a subsequent run. Do not silently drop them.

### Step 2 — Identify Changed Code

```
git diff --name-only <last-review-ref>..HEAD
```

If no last-review ref exists, treat all source files as changed.

**Early exit:** if `git diff --name-only` returns no source files (as defined in the Scope section), emit "No source files changed since last review. Documentation review skipped." and stop. Do not spawn any agents.

Group changed files by the documentation sections most likely to reference them (by package, by feature area, by API surface). This grouping guides reviewer assignment.

### Step 3 — Fan Out Independent Reviewers

Spawn one agent per in-scope doc entry (after capping and prioritization from Step 1). Each reviewer receives:

- The doc file content (or extracted comment block for virtual entries)
- The source files most likely referenced by that section (see mapping heuristic below)
- The appropriate briefing (see variants below)

**Reviewers work in parallel. They do NOT see each other's findings until the cross-check phase.**

**Source-file mapping heuristic:** extract code fences, explicit file path mentions, symbol names, import paths, and package names from the doc text, then resolve against the repo tree. For docs that reference no resolvable source (ADRs, philosophy docs, historical design notes), use the zero-reference briefing below.

**Reviewer briefing variants:**

*Standard briefing (doc references source files):*
> "Your job is to find where the documentation is wrong or outdated. Do not confirm claims — challenge them. For every behavioral claim, configuration example, code snippet, API signature, or architectural description, check it against the provided source. Report each divergence with: (a) the exact quote from the doc, (b) what the source actually says, (c) severity [blocking | misleading | stale | cosmetic]. If a claim references a module, function, or config key not present in your provided source files, report it as an unverifiable claim with severity misleading."

*Zero-reference briefing (doc makes no direct code claims — ADRs, philosophy docs, etc.):*
> "This doc makes no direct code claims. Your job is: (1) check for broken links or references to removed concepts by name; (2) check for consistency with any cross-referenced docs mentioned; (3) check for internal logical contradictions within the doc itself. Report each issue with: (a) the exact quote, (b) the nature of the problem, (c) severity [misleading | stale | cosmetic]. Do not hallucinate source code to verify against."

*Internal-consistency briefing (low-priority doc whose referenced source has not changed):*
> "This doc's referenced source has not changed since the last review. Your job is narrow: (1) check cross-references and links; (2) check terminology consistency within the doc; (3) check structural coherence (does the doc's structure match what it claims to cover?). Do NOT re-verify code claims against source — that is deferred. Report only structural and consistency issues with: (a) the exact quote, (b) the problem, (c) severity [stale | cosmetic]."

### Step 4 — Health-Check Reviewers

Before spawning any cross-checker, verify that every reviewer returned a structurally valid response. A valid response must contain at least one of: a non-empty findings list, or an explicit "no issues found" statement.

If a reviewer response is missing or malformed:
1. Retry that reviewer once with the same briefing.
2. If the retry also fails, mark that doc entry as **UNREVIEWED** in the findings table with severity `unknown`.
3. Log which entries are unreviewed so the coverage cross-checker knows which gaps are structural (failed reviewer) versus substantive (no findings).

Do not spawn cross-checkers until all reviewers have either returned valid output or been marked UNREVIEWED.

### Step 5 — Fan Out Cross-Checkers

Spawn cross-checker agents in parallel. Each receives the full set of reviewer findings, the list of UNREVIEWED entries, and the original docs and source. Their job is to attack the reviewer findings — not to re-review the docs from scratch.

- **Consistency cross-checker:** "Do any two reviewer findings contradict each other? Does one reviewer mark something correct that another marks wrong? Surface each conflict: name both reviewers, quote what each said, and propose the most defensible resolution given the skill text."

- **Coverage cross-checker:** "What did the reviewers miss? For each doc, identify claims that appear in no reviewer's findings. For each unchecked claim: flag it as 'unchecked — needs human review' with the exact quote and the section it appears in. Do NOT independently confirm claims against source — that is not your role. UNREVIEWED entries are already marked; focus on claims within successfully reviewed docs that were quietly skipped."

- **Severity cross-checker:** "Are any findings mis-classified? Upgrade a finding if: a 'cosmetic' finding actually changes observable behavior or constitutes a security exposure (→ misleading). Downgrade a finding if: a 'blocking' finding is actually easily worked around and has no data-loss or security consequence (→ misleading or stale). Apply the tiebreaker rule: use misleading if following the documented pattern would produce incorrect runtime behavior or a security exposure; use stale only if the documented pattern still works correctly even though it is no longer recommended."

### Step 6 — Synthesize Findings

Merge all reviewer and cross-checker output.

**Deduplication:** deduplicate by claim identity (same doc file + same behavioral claim), not by line number. Tiebreaker: keep the higher-severity finding; record both locations in the merged entry.

**Conflict adjudication:** when a consistency cross-checker surfaces a null/positive conflict (Reviewer A clears a claim, Reviewer B marks it wrong), treat the positive finding as provisional. Flag it as "conflict — reviewer disagreement" in the report. Do not auto-fix conflicted findings; surface them for user confirmation.

**Final severity:** the highest severity assigned by any agent wins. Group by doc file for reporting.

**Severity definitions:**

| Severity | Meaning | Action |
|---|---|---|
| `blocking` | Doc actively contradicts current behavior in a way that will cause data loss, security issues, or broken integrations | Fix before any merge |
| `misleading` | Doc describes behavior, API shape, or configuration that no longer exists or works differently | Fix before any merge |
| `stale` | Doc references removed concepts, old paths, or deprecated patterns, but doesn't make a wrong claim | Fix before next release |
| `cosmetic` | Typos, outdated version numbers, dead links that don't affect correctness | Fix opportunistically |

Only surface `cosmetic` findings if the run has no higher-severity findings; otherwise batch them for a cleanup pass.

### Step 7 — Report and Confirm

Produce a summary report and **wait for explicit user acknowledgment before applying any fix**:

```
## Documentation Review — <date>

Changed since last review: <N> source files, <M> doc entries

### Unreviewed Entries (reviewer agent failures)
- <path> — retry failed; claims unverified

### Findings

| File | Location | Severity | Issue | Source Evidence |
|------|----------|----------|-------|----------------|
| README.md:42 | Installation | misleading | Step 3 references `npm install` but package uses pnpm | `package.json` line 3: `"packageManager": "pnpm@..."` |
| docs/API.md:118 | `createAgent` signature | blocking | Param `timeout` renamed to `timeoutMs` in v2.1 | `src/agent.ts:34: timeoutMs: number` |

### Conflicts (require user confirmation before fixing)
- README.md:72 — Reviewer A: correct. Reviewer B: stale. Resolution: [proposed resolution]

### Gaps (undocumented features)
- `packages/pi-delegate/src/retry.ts` — retry logic with no documentation

### Unchecked Claims (flagged by coverage checker — human review needed)
- README.md:88 — "...": not verified by primary reviewer

Auto-fixing <K> confirmed findings (blocking + misleading). Surfacing <J> conflicts and <L> ambiguous findings for user review.
```

In unattended mode (CI gate with no interactive user): auto-apply only `blocking` and `misleading` findings that are not flagged as conflicts. Surface all others as PR comments or a review artifact.

### Step 8 — Apply Corrections

After user acknowledges the report (or in the CI auto-apply path above):

For each confirmed, non-conflicted finding:
- **Auto-fix:** update the doc to match the code. Prefer minimal edits — change the claim, not the surrounding prose. Do not rewrite sections that are not flagged.
- **Conflicted findings:** surface both interpretations to the user and wait for their decision before editing.
- **Structural gaps:** flag as a gap. Do not write new docs in this pass — that is a separate authoring task.

**Editing mechanics:**
- Apply fixes in reverse line-number order within each file to avoid offset drift.
- Before patching, check `git status` for uncommitted changes to the path; surface conflicts to the user rather than overwriting.
- After applying all fixes to a file, run the full-file reviewer once more (not just changed sections) to catch cross-section ripple effects. Fix any new issues found; if after a second pass new issues still appear in the same section, escalate to the user rather than looping further.

### Step 9 — Commit Corrections

After all fixes are applied:

```
git add <all modified doc files>
git commit -m "docs: correct divergences found in doc-review pass"
```

Do not tag until this commit exists. The tag must point to the commit containing the fixes, not the pre-fix HEAD.

### Step 10 — Mark the Review

After Step 9's commit is confirmed:

```
git tag doc-review-<YYYY-MM-DD> HEAD
```

**Tag collision:** if a tag for today's date already exists (same-day re-run), append the short SHA to disambiguate:
```
git tag doc-review-<YYYY-MM-DD>-$(git rev-parse --short HEAD) HEAD
```

Alternatively, write the commit SHA to `.doc-review-ref` at the repo root (preferred for repos that prefer not to use tags):
```
git rev-parse HEAD > .doc-review-ref
git add .doc-review-ref && git commit --amend --no-edit
```

This ref is what Step 2 reads in the next run to scope the diff.

## Agent Assignment Guidance

When spawning reviewer agents, brief each one with (choose the appropriate variant from Step 3):

**Standard reviewer brief:**
> "You are reviewing `<path>` for accuracy against the codebase. Your only job is to find divergences. Do NOT summarize what the doc says correctly. Do NOT confirm correct claims. Report ONLY what is wrong, missing, or outdated, with: (a) the exact quote from the doc, (b) what the source actually says, (c) severity [blocking | misleading | stale | cosmetic]. If a claim references a symbol not present in your provided source, report it as an unverifiable claim with severity misleading."

When spawning cross-checker agents, brief each one with the role-specific mandate:

> "You are a skeptic reviewing other agents' findings about `<path>`. Find:
> (a) claims that two reviewers contradict each other on — name both reviewers and propose a resolution;
> (b) claims within successfully-reviewed docs that no reviewer examined — flag each as 'unchecked, needs human review' (do NOT independently confirm against source);
> (c) findings that no reviewer checked — flag unchecked claims;
> (d) findings that are mis-classified — a cosmetic finding that changes observable behavior or creates a security exposure should be re-rated misleading; a blocking finding with no data-loss or security consequence should be re-rated misleading or stale.
> The original doc and source are attached. Do not generate new findings from scratch for covered sections."

This adversarial framing prevents the common failure mode where agents unconsciously confirm rather than challenge.

## Output Format

See Step 7 for the full report template. Key fields:

- **File**: path and line number
- **Location**: human-readable section name
- **Severity**: blocking | misleading | stale | cosmetic
- **Issue**: the claim and why it is wrong
- **Source Evidence**: the exact excerpt from the source that contradicts the doc

Every finding must include Source Evidence. A finding without source evidence is not actionable and must not be auto-fixed.

## Key Principles

- **Adversarial by default** — every reviewer's mandate is to find what is wrong, not what is right
- **Independence before synthesis** — reviewers never see each other's work until the cross-check phase
- **Health-check before escalating** — never spawn cross-checkers over incomplete reviewer output; mark failures explicitly
- **Confirm before fixing** — the report is always shown to the user before any file is modified
- **Commit before tagging** — the review tag must point to the commit containing the corrections
- **Minimal edits** — fix the claim, not the prose around it
- **No new docs in this pass** — gaps are reported, not filled; filling gaps is a separate authoring task
- **Two re-run limit** — if a section still has issues after two full-file fix-and-verify passes, escalate rather than loop
- **Scope discipline** — only touch files that are in scope; do not opportunistically improve adjacent docs
- **No silent caps** — if entries are deferred due to the 20-file cap, log what was dropped and when it will be reviewed
