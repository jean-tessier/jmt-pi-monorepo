/**
 * Preflight checks for delegate invocations (Task 9, expanded in Task 19)
 *
 * Validates task parameters and depth before spawning a child process.
 * Returns a discriminated union: either fully allowed, or blocked with a code + message.
 * All 8 checks run in strict order; returns on first failure (no accumulation).
 */

import type { DelegateToolParams, DelegateConfig, AgentDefinition } from '../shared/types.js';
import { decodeLineagePath, isPathAtCap, detectCycle, LINEAGE_PATH_CAP } from '../shared/lineage.js';
import { compileSchema, isJsonSchemaObject } from '../shared/schema.js';

export type PreflightCode =
  | 'INVALID_PARAMS'
  | 'DEPTH_BLOCKED'
  | 'CYCLE_DETECTED'
  | 'TOOL_NOT_PERMITTED'
  | 'SCHEMA_INVALID';

export interface PreflightContext {
  params: DelegateToolParams;
  config: DelegateConfig;
  agentDef: AgentDefinition | undefined;
  depth: number;
  lineagePath: string;           // colon-separated lineage path from PI_DELEGATE_PATH
  outputSchema?: object;         // resolved outputSchema (if any)
  allowedAgentNames?: string[];  // delegateAgents allowlist from parent env
}

export type PreflightResult =
  | { blocked: false }
  | { blocked: true; code: PreflightCode; message: string };

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

  // Check 5: schema object check — if outputSchema provided, must be a plain object
  if (ctx.outputSchema && !isJsonSchemaObject(ctx.outputSchema)) {
    return { blocked: true, code: 'SCHEMA_INVALID', message: 'outputSchema must be a JSON Schema object' };
  }

  // Check 6: agent resolution — if agentName was specified but agentDef is undefined
  if (ctx.params.agentName && !ctx.agentDef) {
    return { blocked: true, code: 'INVALID_PARAMS', message: `Agent "${ctx.params.agentName}" not found` };
  }

  // Check 7: delegateAgents allowlist
  if (ctx.allowedAgentNames && ctx.allowedAgentNames.length > 0) {
    const targetName = ctx.agentDef?.name ?? ctx.params.agentName ?? 'default';
    if (!ctx.allowedAgentNames.includes(targetName)) {
      return { blocked: true, code: 'TOOL_NOT_PERMITTED', message: `Agent "${targetName}" not in delegateAgents allowlist` };
    }
  }

  // Check 8: schema compilability — if outputSchema is provided, try to compile it with TypeBox
  if (ctx.outputSchema) {
    try { compileSchema(ctx.outputSchema); } catch {
      return { blocked: true, code: 'SCHEMA_INVALID', message: 'outputSchema cannot be compiled by TypeBox' };
    }
  }

  return { blocked: false };
}
