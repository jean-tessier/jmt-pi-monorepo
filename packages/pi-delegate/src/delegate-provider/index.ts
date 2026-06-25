/**
 * Child-side delegate provider (Task 14)
 *
 * Registers the delegate tool in child processes, but only if the child has a
 * valid PI_DELEGATE_TOKEN. This implements capability gating by token presence.
 *
 * Only the tool is registered here — not the /delegate command or the
 * before_agent_start hook, which are parent-only side effects.  The import is
 * from parent/register.ts (a neutral module), not from parent/index.ts (the
 * parent entry point), preserving the "no cross-side entry-point imports"
 * invariant from AGENTS.md.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerDelegateTool } from '../parent/register.js';

export default function (pi: ExtensionAPI): void {
  const token = process.env.PI_DELEGATE_TOKEN ?? '';
  if (!token) {
    // Not authorized — don't register the delegate tool
    return;
  }
  // Authorized — register the delegate tool only (no command, no hook)
  registerDelegateTool(pi);
}
