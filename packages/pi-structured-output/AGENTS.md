# AGENTS.md — pi-structured-output

> Scoped guidance for AI agents working in `packages/pi-structured-output/`. The root `AGENTS.md` applies here too; this file adds package-specific rules.

---

## What this package is

`pi-structured-output` is a **child-side-only Pi extension**. It is never loaded in the parent (user's) Pi process. It is loaded inside child Pi subprocesses spawned by `pi-delegate` when the caller provides an `outputSchema`.

The entire package is **one file**: `src/index.ts`. Do not add more files unless there is a concrete reason.

---

## Registration is conditional

The extension checks `PI_OUTPUT_SCHEMA` on activation:
- If the env var is **absent or empty** → do nothing; no tool is registered; the extension is a no-op.
- If `PI_OUTPUT_SCHEMA` is **set (any non-empty string)** → register the `structured_output` tool.

The value of `PI_OUTPUT_SCHEMA` is **not used for validation** — it only gates registration. Validation of the output against the schema is handled parent-side by `pi-delegate`.

---

## Invariants

### No validation logic here

`pi-structured-output` writes output to `PI_OUTPUT_FILE` and returns. It does **not** parse or validate the schema. Validation belongs to the parent (`pi-delegate`). If you find yourself adding schema validation code here, it belongs in `pi-delegate/src/parent/schema.ts` instead.

### Raw-params fallback

If the LLM calls the tool with a flat object (without the `{ output: ... }` wrapper), the extension writes `params` directly. This is intentional — it handles the case where the model omits the wrapper. Do not remove this fallback.

### Error conditions

The tool returns `isError: true` (not an exception) in exactly two cases:
1. `PI_OUTPUT_FILE` is not set.
2. Writing to `PI_OUTPUT_FILE` fails (e.g. permission error, disk full).

All other errors from the LLM (wrong schema shape, etc.) are handled parent-side.

---

## Environment variables

| Variable | Role |
|----------|------|
| `PI_OUTPUT_SCHEMA` | Non-empty string → registers the tool. Value is ignored otherwise. |
| `PI_OUTPUT_FILE` | Absolute path where the tool writes its JSON payload. Must be writable. |

Both are set by `pi-delegate` before spawning the child. If using this extension standalone (without `pi-delegate`), you must set both manually.

---

## Development

Typecheck: `pnpm --filter pi-structured-output typecheck`

There is no dedicated test suite for this package — it is exercised through `pi-delegate`'s conformance tests. If adding tests, use `vitest` (already a devDependency).
