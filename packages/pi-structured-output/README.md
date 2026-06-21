# pi-structured-output

> Pi extension: structured output capture for child Pi agents.

`pi-structured-output` registers a `structured_output` tool inside child Pi processes, enabling them to return validated JSON data instead of freeform text. It is used automatically by `pi-delegate` when a caller supplies an `outputSchema`, but can also be loaded independently.

## How it works

When the extension activates in a child process:

1. It checks for the `PI_OUTPUT_SCHEMA` environment variable. If absent, the tool is **not registered** — the extension is a no-op in processes that don't expect structured output.
2. When `PI_OUTPUT_SCHEMA` is set, the `structured_output` tool is registered and available to the child agent.
3. The child calls `structured_output({ output: { ... } })` when it has a result.
4. The extension writes the output as JSON to the path in `PI_OUTPUT_FILE`.
5. The parent (e.g. `pi-delegate`) reads that file, validates it against the schema, and returns the structured object to the caller.

This keeps the validation boundary at the parent — the child just writes its best answer; the parent decides whether it conforms.

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

This extension is also included automatically when you install `pi-delegate`.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `PI_OUTPUT_SCHEMA` | JSON Schema string. When set, the `structured_output` tool is registered. |
| `PI_OUTPUT_FILE` | Path where the tool writes its JSON payload. Must be writable by the child process. |

Both variables are set by `pi-delegate` before spawning a child — you rarely need to set them manually unless you are integrating this extension without `pi-delegate`.

## Standalone usage

If you want to use `pi-structured-output` outside of `pi-delegate`, set the environment variables before running Pi:

```bash
export PI_OUTPUT_SCHEMA='{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"]}'
export PI_OUTPUT_FILE=/tmp/pi-output.json
pi run --agent my-agent "Extract a summary from this document."
cat /tmp/pi-output.json
```

The child agent will have a `structured_output` tool available. When it calls the tool, the result appears in `/tmp/pi-output.json`.
