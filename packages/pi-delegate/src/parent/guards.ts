/**
 * Preflight checks for delegate invocations (Task 9)
 *
 * Validates task parameters and depth before spawning a child process.
 * Returns a discriminated union: either fully allowed, or blocked with a code + message.
 */

import type { DelegateToolParams, DelegateConfig, AgentDefinition } from '../shared/types.js';
import { decodeLineagePath, isPathAtCap, detectCycle, LINEAGE_PATH_CAP } from '../shared/lineage.js';

export interface PreflightContext {
  params: DelegateToolParams;
  config: DelegateConfig;
  agentDef: AgentDefinition | undefined;
  depth: number;
  lineagePath: string;  // colon-separated lineage path from PI_DELEGATE_PATH
}

export type PreflightResult =
  | { blocked: false }
  | { blocked: true; code: 'DEPTH_BLOCKED' | 'INVALID_PARAMS' | 'CYCLE_DETECTED' | 'SCHEMA_INVALID'; message: string };

/** Ordered preflight checks. Returns first failure. */
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

  // Check 3: lineage path cap backstop
  const pathEntries = decodeLineagePath(ctx.lineagePath ?? '');
  if (isPathAtCap(pathEntries)) {
    return {
      blocked: true,
      code: 'DEPTH_BLOCKED',  // reuse DEPTH_BLOCKED for cap (it's a depth-related backstop)
      message: `Lineage path cap (${LINEAGE_PATH_CAP}) reached`
    };
  }

  // Check 4: cycle detection
  if (ctx.agentDef && detectCycle(ctx.agentDef.name, pathEntries)) {
    return {
      blocked: true,
      code: 'CYCLE_DETECTED',
      message: `Cycle detected: agent "${ctx.agentDef.name}" already in path [${ctx.lineagePath}]`
    };
  }

  return { blocked: false };
}
