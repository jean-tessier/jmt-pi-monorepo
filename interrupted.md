# Handoff — Debugging Delegation: Three Bugs Found and Fixed

## Session Summary

We debugged why the `delegate` tool consistently returned `(no output)` for child agent results. **Three separate bugs** were found and fixed.

## Bug 1: Wrong CLI flag — `--extensions` should be `-e`

**File:** `packages/pi-delegate/src/parent/spawn.ts`
**Status:** ✅ Fixed

`pi 0.79.10` uses `--extension, -e <path>` (singular, repeatable). The code was passing `--extensions <path1> <path2>`, which produced:
```
Error: Unknown option: --extensions
```

**Fix:** Changed from `argv.push('--extensions', ...paths)` to a loop pushing `-e` for each path.

## Bug 2: Broken pnpm symlinks in extension `node_modules`

**File:** `install.mjs`
**Status:** ✅ Fixed

When `npm install --production` ran inside the extension directory (copied from a pnpm monorepo), the `package-lock.json` contained symlinks to the monorepo's `.pnpm` store, which don't exist at the installed path:
```
yaml -> ../../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml  ❌ BROKEN
```

This caused:
```
Error: Cannot find module 'yaml'
```

**Fix:**
1. Excluded `package-lock.json` from the `fs.cp()` copy so npm doesn't reuse pnpm-style lock files
2. Added `rm -rf node_modules` before install to start clean
3. Use `--install-strategy=nested` to get real directories instead of pnpm symlinks

## Bug 3: Wrong relative path in `resolveSoProvider()` (ROOT CAUSE)

**File:** `packages/pi-delegate/src/parent/delegate-tool.ts`
**Status:** ✅ Fixed

The function computed the path to `pi-structured-output/src/index.ts` by going **4 levels up** from `delegate-tool.ts`:

```
delegate-tool.ts @ .../extensions/pi-delegate/src/parent/
../../../../ → .../.config/pi/  ← WRONG
```

It should go **3 levels up** to reach `extensions/`:

```
delegate-tool.ts @ .../extensions/pi-delegate/src/parent/
../../.. → .../extensions/  ← CORRECT
```

This produced an invalid path:
```
/Users/jeantessier/.config/pi/pi-structured-output/src/index.ts   ❌ missing /extensions/
```

**Fix:** Changed `'../../../../pi-structured-output/...'` to `'../../../pi-structured-output/...'`.

## Verified Working

Both fixes applied + Pi restart = delegation works:

```
from agent "default": Hi! How can I help you today?
```

The debug log confirmed:
- `message_end (assistant)` extraction: ✅ produces "Hi! How can I help you today?"
- `agent_end messages` extraction: ✅ also captured the text
- Exit code: `0`
- No stderr errors

## Debug Logging Added/Removed

Added temporary debug logging to `spawn.ts` (stderr and `/tmp/pidebug/delegate_debug.log`) during investigation, then reverted. The installed file now matches the source (essential fixes only, no debug logging).

## Files Changed

| File | Change |
|------|--------|
| `packages/pi-delegate/src/parent/spawn.ts` | `--extensions` → `-e` loop; message_end/agent_end output extraction fix |
| `packages/pi-delegate/src/parent/delegate-tool.ts` | `resolveSoProvider()`: `../../../../` → `../../../` |
| `install.mjs` | Exclude `package-lock.json` from copy; `rm -rf node_modules` before `npm install --install-strategy=nested` |
| `interrupted.md` | This file (new) |

## Next Steps

The user needs to:
1. **Re-run `install.mjs`** to reinstall with the updated install script, OR manually:
   - Copy the updated `delegate-tool.ts` to `~/.config/pi/extensions/pi-delegate/src/parent/`
   - Delete `~/.config/pi/extensions/pi-delegate/package-lock.json` and `node_modules/`
   - Run `npm install --install-strategy=nested --production` in the extension directory
2. **Restart Pi**
3. Test delegation. It should now return child agent output instead of `(no output)`.

## Key Paths

- Extension source: `~/Projects/my-pi-monorepo/packages/pi-delegate/`
- Installed extensions: `~/.config/pi/extensions/pi-delegate/`
- Install script: `~/Projects/my-pi-monorepo/install.mjs`
- Config: `~/.config/pi/pi-delegate/config.json` (does not exist yet, uses defaults)
- Settings: `~/.config/pi/settings.json`