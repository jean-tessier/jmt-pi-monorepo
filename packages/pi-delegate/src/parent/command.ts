/**
 * /delegate slash-command handler (Task 23)
 *
 * Provides `status` and `cancel` subcommands for delegation introspection and control.
 */

import type { PiExtensionContext } from './delegate-tool.js';
import { cancelRegistry } from './cancel-registry.js';

/**
 * Get current delegation status.
 * Shows depth and lineage if running as a child agent, otherwise indicates top-level.
 */
function getDelegationStatus(): string {
  const depth = parseInt(process.env.PI_DELEGATE_DEPTH ?? '0', 10);
  const path = process.env.PI_DELEGATE_PATH ?? '';
  const token = process.env.PI_DELEGATE_TOKEN ?? '';

  if (!token) {
    return 'pi-delegate: running as top-level (not a child agent)';
  }
  return [
    'pi-delegate: running as child agent',
    `  depth: ${depth}`,
    `  lineage: ${path || '(unknown)'}`,
  ].join('\n');
}

/**
 * Cancel all in-flight delegations (best effort).
 */
function cancelAll(): string {
  cancelRegistry.abortAll();
  return 'Cancellation requested for all in-flight delegations.';
}

/**
 * Register the /delegate command with the Pi extension.
 */
export function registerDelegateCommand(pi: PiExtensionContext): void {
  pi.registerCommand?.('delegate', async (args: string[]) => {
    const sub = args[0] ?? 'status';
    switch (sub) {
      case 'status':
        return getDelegationStatus();
      case 'cancel':
        return cancelAll();
      default:
        return `Unknown subcommand "${sub}". Available: status, cancel`;
    }
  });
}
