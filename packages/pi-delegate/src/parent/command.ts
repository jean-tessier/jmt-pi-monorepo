/**
 * /delegate slash-command handler (Task 23)
 *
 * Provides `status` and `cancel` subcommands for delegation introspection and control.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { cancelRegistry } from './cancel-registry.js';
import { runDoctor } from './doctor.js';

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
export function registerDelegateCommand(pi: ExtensionAPI): void {
  pi.registerCommand('delegate', {
    description: 'Manage delegations: status, cancel, doctor',
    handler: async (args: string, ctx) => {
      const parts = args.split(/\s+/);
      const sub = parts[0] ?? 'status';
      switch (sub) {
        case 'status':
          ctx.ui.notify(getDelegationStatus(), 'info');
          break;
        case 'cancel':
          ctx.ui.notify(cancelAll(), 'info');
          break;
        case 'doctor': {
          const report = await runDoctor();
          ctx.ui.notify(report, 'info');
          break;
        }
        default:
          ctx.ui.notify(`Unknown subcommand "${sub}". Available: status, cancel, doctor`, 'warning');
          break;
      }
    },
  });
}
