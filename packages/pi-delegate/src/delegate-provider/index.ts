/**
 * Child-side delegate provider (Task 14)
 *
 * Registers the delegate tool in child processes, but only if the child has a
 * valid PI_DELEGATE_TOKEN. This implements capability gating by token presence.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { activate as parentActivate } from '../parent/delegate-tool.js';

export default function (pi: ExtensionAPI): void {
  const token = process.env.PI_DELEGATE_TOKEN ?? '';
  if (!token) {
    // Not authorized — don't register the delegate tool
    return;
  }
  // Authorized — register full delegate tool (re-use parent's activate)
  parentActivate(pi);
}
