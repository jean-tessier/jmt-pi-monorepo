# my-pi-monorepo

Personal extensions, plugins, and customizations for [Pi](https://pi.ai) — my day-to-day AI assistant.

This repository is where I develop, version, and install the Pi extensions I rely on. Each package under `packages/` is an independently installable Pi extension.

## Packages

| Package | Description |
|---------|-------------|
| [`pi-delegate`](packages/pi-delegate/README.md) | Spawn child Pi agents as tool calls, with parallel fan-out, typed output, depth limits, and cycle detection. |
| [`pi-structured-output`](packages/pi-structured-output/README.md) | Register a `structured_output` tool in child processes so they can return validated JSON instead of freeform text. |

## Installing everything

Clone the repo and run the install script:

```bash
git clone <repo-url> my-pi-monorepo
cd my-pi-monorepo
node install.mjs
```

For each package under `packages/`, the script:
1. Copies the package into `~/.config/pi/extensions/<package-name>`
2. Runs `npm install --install-strategy=nested --production` in the destination to fetch runtime dependencies
3. Registers the extension path in `~/.config/pi/settings.json` under the `extensions` key

See [QUICK-START.md](QUICK-START.md) for a guided walkthrough of the core features.

## Development

This is a [pnpm](https://pnpm.io) workspace. To install dependencies and run all tests:

```bash
pnpm install
pnpm test
```

To typecheck all packages:

```bash
pnpm typecheck
```
