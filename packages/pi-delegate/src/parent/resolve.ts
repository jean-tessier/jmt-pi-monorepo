/**
 * Resolution + precedence for pi-delegate (Task 4)
 *
 * Given an AgentDefinition and per-call overrides, compute the final
 * model, tool allowlist, system prompt, and outputSchema to use when
 * spawning a child pi process — applying §8 precedence rules.
 *
 * Precedence (later wins):
 *   1. Global defaults (hardcoded)
 *   2. Agent definition fields
 *   3. Per-call overrides (callParams)
 */

import type { AgentDefinition } from '../shared/types.js';

/** The fully-resolved invocation parameters for spawning a child pi process */
export interface ResolvedParams {
  model?: string;
  tools: string[];
  systemPrompt?: string;
  promptMode: 'replace' | 'append';
  outputSchema?: object;
}

/** Input to resolveParams */
export interface ResolveInput {
  agentDef: AgentDefinition;
  callParams: {
    model?: string;
    tools?: string[];
    prompt?: string;
    promptMode?: 'replace' | 'append';
    outputSchema?: object;
  };
  /** Parent's active tool list — used as a ceiling for child tools */
  activeTools?: string[];
}

/**
 * Apply the builtins-only ceiling:
 *   - Remove 'delegate' from requested (child never auto-inherits it)
 *   - If activeTools is non-empty, intersect with it
 */
function applyToolCeiling(requested: string[], activeTools: string[]): string[] {
  // Remove 'delegate' from requested (never auto-inherit)
  const filtered = requested.filter((t) => t !== 'delegate');
  // If no ceiling provided, return filtered as-is
  if (activeTools.length === 0) return filtered;
  // Intersect: only tools in both lists
  return filtered.filter((t) => activeTools.includes(t));
}

/**
 * Check that every requested tool is within the ceiling (activeTools).
 * Returns the name of the first out-of-ceiling tool, or null if all OK.
 * Only called when activeTools is non-empty (i.e., a ceiling exists).
 */
export function checkToolCeiling(
  requestedTools: string[],
  ceiling: string[]
): string | null {
  for (const tool of requestedTools) {
    if (!ceiling.includes(tool)) return tool;
  }
  return null;
}

/** §8.4 lever 1: soft output directive appended when an outputSchema is present */
export const SOFT_OUTPUT_DIRECTIVE =
  '\n\nWhen you have completed the task, call the structured_output tool with your result matching the provided schema.';

/**
 * Resolve the effective maxDepth for a child agent, applying min-clamp.
 * The child's ceiling is the minimum of parent's configured depth and agent's override.
 *
 * @param configMaxDepth - The parent's configured maximum depth
 * @param agentMaxDepth - The agent definition's optional depth override
 * @returns The effective maximum depth (never exceeds configMaxDepth)
 */
export function resolveMaxDepth(
  configMaxDepth: number,
  agentMaxDepth: number | undefined
): number {
  if (agentMaxDepth === undefined) return configMaxDepth;
  return Math.min(configMaxDepth, agentMaxDepth);
}

/**
 * Resolve the final invocation parameters for a child pi process.
 *
 * Precedence (later wins):
 *   agent-def defaults → agent-def fields → per-call fields
 */
export function resolveParams(input: ResolveInput): ResolvedParams {
  const { agentDef, callParams, activeTools = [] } = input;

  // ── model ──────────────────────────────────────────────────────────────────
  // agentDef.model → overridden by callParams.model
  const model: string | undefined = callParams.model ?? agentDef.model;

  // ── tools ──────────────────────────────────────────────────────────────────
  // agentDef.tools → overridden by callParams.tools
  // Then apply ceiling (remove 'delegate', intersect with activeTools if provided)
  const requestedTools: string[] = callParams.tools ?? agentDef.tools ?? [];
  const tools: string[] = applyToolCeiling(requestedTools, activeTools);

  // ── promptMode ────────────────────────────────────────────────────────────
  // Default is 'replace'; caller can pass 'append' to append to agent def's prompt
  const promptMode: 'replace' | 'append' = callParams.promptMode ?? 'replace';

  // ── systemPrompt ──────────────────────────────────────────────────────────
  // §8.3 prompt composition:
  //   promptMode === 'replace': callParams.prompt replaces agent def's prompt
  //   promptMode === 'append': callParams.prompt is appended to agent def's prompt
  let systemPrompt: string | undefined;

  if (callParams.prompt !== undefined) {
    if (promptMode === 'append') {
      // Append callParams.prompt after agent def's prompt
      if (agentDef.systemPrompt !== undefined) {
        systemPrompt = agentDef.systemPrompt + '\n\n' + callParams.prompt;
      } else {
        systemPrompt = callParams.prompt;
      }
    } else {
      // 'replace': per-call prompt replaces agent def's prompt entirely
      systemPrompt = callParams.prompt;
    }
  } else {
    // No per-call prompt; use agent def's prompt as-is
    systemPrompt = agentDef.systemPrompt;
  }

  // ── outputSchema ──────────────────────────────────────────────────────────
  // agentDef.outputSchema → overridden by callParams.outputSchema
  // No validation here (Task 17)
  const outputSchema: object | undefined =
    callParams.outputSchema ?? agentDef.outputSchema;

  // ── §8.4 soft output directive ────────────────────────────────────────────
  // If outputSchema is set, append the soft directive to the system prompt
  if (outputSchema !== undefined) {
    if (systemPrompt !== undefined) {
      systemPrompt = systemPrompt + SOFT_OUTPUT_DIRECTIVE;
    } else {
      systemPrompt = SOFT_OUTPUT_DIRECTIVE.trimStart();
    }
  }

  return { model, tools, systemPrompt, promptMode, outputSchema };
}
