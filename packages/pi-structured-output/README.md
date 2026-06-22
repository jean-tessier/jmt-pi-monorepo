# pi-structured-output

> Pi extension: registers a `structured_output` tool for child Pi agents to emit structured JSON results.

This extension is used automatically by `pi-delegate` when a caller supplies an `outputSchema`, but it can also be loaded independently.

## How it works

1. On activation, the extension checks the `PI_OUTPUT_SCHEMA` environment variable. If absent or empty, the extension does **nothing** — no tool is registered.
2. When `PI_OUTPUT_SCHEMA` is set, the `structured_output` tool is registered and made available to the agent.
3. The agent calls `structured_output({ output: { ... } })` with its result.
4. The extension writes the result as formatted JSON to the path in `PI_OUTPUT_FILE`.
5. The extension does **not** validate the output against the schema — validation is the caller's (e.g. `pi-delegate`) responsibility.

### Error conditions

The `structured_output` tool returns `isError: true` when:

- `PI_OUTPUT_FILE` is not set — the output cannot be written anywhere.
- Writing to `PI_OUTPUT_FILE` fails (e.g. permission denied, disk full).

On success, the tool returns a plain text confirmation message.

### Fallback for raw params

If the agent calls the tool with parameters that don't have an `output` wrapper (e.g. a flat object), the extension writes the raw `params` as-is. This handles edge cases where the LLM invokes the tool without the expected nesting.

## Installation

Clone the monorepo and run the install script from the root:

```bash
node install.mjs
```

This copies the extension into `~/.config/pi/extensions/pi-structured-output/`.

Then add it to your Pi config (`~/.config/pi/pi.yaml`):

```yaml
extensions:
  - ~/.config/pi/extensions/pi-structured-output/src/index.ts
```

## Environment variables

| Variable | Purpose |
|----------|---------|
| `PI_OUTPUT_SCHEMA` | When set (any non-empty string), the `structured_output` tool is registered. The value is **not** used for validation — it only gates registration. |
| `PI_OUTPUT_FILE` | Path where the tool writes its JSON payload. Must be writable by the child process. If unset, the tool returns an error. |

Both variables are set by `pi-delegate` before spawning a child. You only need to set them manually if you are using this extension without `pi-delegate`.

## Standalone usage

Use `pi-structured-output` without `pi-delegate` by setting the environment variables before running Pi:

```bash
export PI_OUTPUT_SCHEMA='{"type":"object","properties":{"summary":{"type":"string"}}}'
export PI_OUTPUT_FILE=/tmp/pi-output.json
pi run --agent my-agent "Extract a summary from this document."
cat /tmp/pi-output.json
```

The child agent will have a `structured_output` tool available. When it calls the tool, the result is written to `/tmp/pi-output.json`. Note that the schema string is only used to trigger tool registration — it is not parsed or validated by this extension.