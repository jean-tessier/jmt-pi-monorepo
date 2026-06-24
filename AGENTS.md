# AGENTS.md — Notes for AI Agents Working in This Repo

## TypeBox

This monorepo uses the [`typebox`](https://www.npmjs.com/package/typebox) npm package — **not** `@sinclair/typebox`.

```typescript
import { Type } from "typebox";          // correct
import { Type } from "@sinclair/typebox"; // wrong — not installed
```

The official `@earendil-works/pi-coding-agent` extension docs use `typebox` throughout. All existing packages (`pi-delegate`, `pi-structured-output`) import from `"typebox"`. Any new package in this repo should do the same.

### Enums in tool schemas

Do **not** use `Type.Enum` for tool parameters — it generates `anyOf/const` patterns that Pi's tool-call layer rejects with an `anyOf`-at-root error. Use `StringEnum` from `@earendil-works/pi-ai` instead:

```typescript
import { StringEnum } from "@earendil-works/pi-ai";

parameters: Type.Object({
  mode: StringEnum(["fast", "slow"] as const),
})
```

### Tool schema root

Pi requires tool `parameters` to be a flat `Type.Object(...)` at the root — no wrapping, no `anyOf`. This was the bug fixed in commit `fce5be0`.
