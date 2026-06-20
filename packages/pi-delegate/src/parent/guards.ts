/**
 * Preflight checks for delegate invocations (Task 9)
 *
 * Validates task parameters and depth before spawning a child process.
 * Returns a discriminated union: either fully allowed, or blocked with a code + message.
 */

import type { DelegateToolParams, DelegateConfig, AgentDefinition } from '../shared/types.js';

export interface PreflightContext {
  params: DelegateToolParams;
  config: DelegateConfig;
  agentDef: AgentDefinition | undefined;
  depth: number;
}

export type PreflightResult =
  | { blocked: false }
  | { blocked: true; code: 'DEPTH_BLOCKED' | 'INVALID_PARAMS'; message: string };

/** Ordered preflight checks (subset for Stage 1). Returns first failure. */
export function runPreflight(ctx: PreflightContext): PreflightResult {
  // Check 1: param shape — task must be a non-empty string
  if (!('task' in ctx.params) || typeof ctx.params.task !== 'string' || ctx.params.task.trim() === '') {
    return { blocked: true, code: 'INVALID_PARAMS', message: 'task must be a non-empty string' };
  }

  // Check 2: depth gate
  if (ctx.depth >= ctx.config.maxDepth) {
    return {
      blocked: true,
      code: 'DEPTH_BLOCKED',
      message: `Delegation depth ${ctx.depth} reached maxDepth ${ctx.config.maxDepth}`
    };
  }

  return { blocked: false };
}
