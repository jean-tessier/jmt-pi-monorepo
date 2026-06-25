import { describe, it, expect } from 'vitest';
import { resolveMaxDepth, resolveParams, checkToolCeiling, SOFT_OUTPUT_DIRECTIVE } from '../../src/parent/resolve.js';
import type { AgentDefinition } from '../../src/shared/types.js';

describe('resolveMaxDepth', () => {
  it('returns configMaxDepth when agentMaxDepth is undefined', () => {
    expect(resolveMaxDepth(5, undefined)).toBe(5);
  });

  it('returns agentMaxDepth when lower than config', () => {
    expect(resolveMaxDepth(5, 2)).toBe(2);
  });

  it('returns configMaxDepth when agentMaxDepth is higher', () => {
    expect(resolveMaxDepth(2, 10)).toBe(2);
  });
});

// ── Shared fixtures ───────────────────────────────────────────────────────────

const BARE_AGENT: AgentDefinition = {
  name: 'bare-agent',
  filePath: '/tmp/bare-agent.md',
};

const FULL_AGENT: AgentDefinition = {
  name: 'full-agent',
  filePath: '/tmp/full-agent.md',
  model: 'agent-model',
  tools: ['read', 'bash', 'write'],
  systemPrompt: 'Agent system prompt.',
  outputSchema: { type: 'object', properties: { answer: { type: 'string' } } },
};

/** Like FULL_AGENT but without outputSchema, so soft directive is NOT appended */
const AGENT_NO_SCHEMA: AgentDefinition = {
  name: 'no-schema-agent',
  filePath: '/tmp/no-schema-agent.md',
  model: 'agent-model',
  tools: ['read', 'bash', 'write'],
  systemPrompt: 'Agent system prompt.',
};

// ── resolveParams: precedence ─────────────────────────────────────────────────

describe('resolveParams — model precedence', () => {
  it('uses agentDef.model when no callParams.model', () => {
    const result = resolveParams({ agentDef: FULL_AGENT, callParams: {} });
    expect(result.model).toBe('agent-model');
  });

  it('per-call model overrides agentDef.model', () => {
    const result = resolveParams({ agentDef: FULL_AGENT, callParams: { model: 'call-model' } });
    expect(result.model).toBe('call-model');
  });

  it('model is undefined when neither agentDef nor callParams provides one', () => {
    const result = resolveParams({ agentDef: BARE_AGENT, callParams: {} });
    expect(result.model).toBeUndefined();
  });
});

describe('resolveParams — tools precedence', () => {
  it('uses agentDef.tools when no callParams.tools', () => {
    const result = resolveParams({ agentDef: FULL_AGENT, callParams: {} });
    expect(result.tools).toEqual(['read', 'bash', 'write']);
  });

  it('per-call tools override agentDef.tools', () => {
    const result = resolveParams({ agentDef: FULL_AGENT, callParams: { tools: ['grep', 'find'] } });
    // applyToolCeiling with no activeTools returns filtered list
    expect(result.tools).toEqual(['grep', 'find']);
  });

  it('returns empty array when neither agentDef nor callParams provides tools', () => {
    const result = resolveParams({ agentDef: BARE_AGENT, callParams: {} });
    expect(result.tools).toEqual([]);
  });

  it('"delegate" is always removed from the tools list', () => {
    const result = resolveParams({
      agentDef: BARE_AGENT,
      callParams: { tools: ['read', 'delegate', 'bash'] },
    });
    expect(result.tools).not.toContain('delegate');
    expect(result.tools).toContain('read');
    expect(result.tools).toContain('bash');
  });

  it('intersects tools with activeTools ceiling when activeTools is provided', () => {
    const result = resolveParams({
      agentDef: BARE_AGENT,
      callParams: { tools: ['read', 'bash', 'write', 'grep'] },
      activeTools: ['read', 'bash'], // ceiling: only read and bash allowed
    });
    expect(result.tools).toEqual(['read', 'bash']);
  });

  it('returns empty tools when none pass the activeTools ceiling', () => {
    const result = resolveParams({
      agentDef: BARE_AGENT,
      callParams: { tools: ['write', 'grep'] },
      activeTools: ['read', 'bash'], // ceiling: write and grep not allowed
    });
    expect(result.tools).toEqual([]);
  });
});

describe('resolveParams — systemPrompt precedence', () => {
  it('uses agentDef.systemPrompt when no callParams.prompt (no schema, no directive appended)', () => {
    // Use agent without outputSchema so soft directive is not appended
    const result = resolveParams({ agentDef: AGENT_NO_SCHEMA, callParams: {} });
    expect(result.systemPrompt).toBe('Agent system prompt.');
  });

  it('per-call prompt replaces agentDef.systemPrompt in replace mode (no schema)', () => {
    // Use agent without outputSchema so soft directive is not appended
    const result = resolveParams({
      agentDef: AGENT_NO_SCHEMA,
      callParams: { prompt: 'Per-call prompt.', promptMode: 'replace' },
    });
    expect(result.systemPrompt).toBe('Per-call prompt.');
  });

  it('per-call prompt appends to agentDef.systemPrompt in append mode (no schema)', () => {
    // Use agent without outputSchema so soft directive is not appended
    const result = resolveParams({
      agentDef: AGENT_NO_SCHEMA,
      callParams: { prompt: 'Extra instruction.', promptMode: 'append' },
    });
    expect(result.systemPrompt).toBe('Agent system prompt.\n\nExtra instruction.');
  });

  it('per-call prompt in append mode without agentDef.systemPrompt becomes the whole prompt', () => {
    const result = resolveParams({
      agentDef: BARE_AGENT,
      callParams: { prompt: 'Only prompt.', promptMode: 'append' },
    });
    expect(result.systemPrompt).toBe('Only prompt.');
  });

  it('systemPrompt is undefined when neither agentDef nor callParams provides one', () => {
    const result = resolveParams({ agentDef: BARE_AGENT, callParams: {} });
    // No outputSchema, so no soft directive either
    expect(result.systemPrompt).toBeUndefined();
  });
});

describe('resolveParams — outputSchema precedence', () => {
  it('uses agentDef.outputSchema when no callParams.outputSchema', () => {
    const result = resolveParams({ agentDef: FULL_AGENT, callParams: {} });
    expect(result.outputSchema).toEqual(FULL_AGENT.outputSchema);
  });

  it('per-call outputSchema overrides agentDef.outputSchema', () => {
    const callSchema = { type: 'object', properties: { count: { type: 'number' } } };
    const result = resolveParams({ agentDef: FULL_AGENT, callParams: { outputSchema: callSchema } });
    expect(result.outputSchema).toEqual(callSchema);
  });

  it('outputSchema is undefined when neither provides one', () => {
    const result = resolveParams({ agentDef: BARE_AGENT, callParams: {} });
    expect(result.outputSchema).toBeUndefined();
  });
});

describe('resolveParams — soft output directive', () => {
  it('appends soft directive to systemPrompt when outputSchema is present', () => {
    const result = resolveParams({
      agentDef: FULL_AGENT,
      callParams: {},
    });
    // FULL_AGENT has both systemPrompt and outputSchema
    expect(result.systemPrompt).toContain(SOFT_OUTPUT_DIRECTIVE.trim());
  });

  it('sets systemPrompt to trimmed soft directive when outputSchema present but no prompt', () => {
    const agentWithSchema: AgentDefinition = {
      ...BARE_AGENT,
      outputSchema: { type: 'object' },
    };
    const result = resolveParams({ agentDef: agentWithSchema, callParams: {} });
    expect(result.systemPrompt).toBe(SOFT_OUTPUT_DIRECTIVE.trimStart());
  });

  it('does not add soft directive when no outputSchema', () => {
    const result = resolveParams({ agentDef: BARE_AGENT, callParams: {} });
    expect(result.systemPrompt).toBeUndefined();
  });
});

describe('resolveParams — promptMode default', () => {
  it('defaults to "replace" promptMode', () => {
    const result = resolveParams({ agentDef: BARE_AGENT, callParams: {} });
    expect(result.promptMode).toBe('replace');
  });

  it('returns "append" when callParams.promptMode is "append"', () => {
    const result = resolveParams({ agentDef: BARE_AGENT, callParams: { promptMode: 'append' } });
    expect(result.promptMode).toBe('append');
  });
});

// ── checkToolCeiling ──────────────────────────────────────────────────────────

describe('checkToolCeiling', () => {
  it('returns null when all requested tools are within ceiling', () => {
    const result = checkToolCeiling(['read', 'bash'], ['read', 'bash', 'write']);
    expect(result).toBeNull();
  });

  it('returns null for empty requested tools', () => {
    const result = checkToolCeiling([], ['read', 'bash']);
    expect(result).toBeNull();
  });

  it('returns the first out-of-ceiling tool when one tool is not in ceiling', () => {
    const result = checkToolCeiling(['read', 'bash', 'write'], ['read', 'bash']);
    expect(result).toBe('write');
  });

  it('returns the first offender in order when multiple tools are not in ceiling', () => {
    const result = checkToolCeiling(['write', 'grep', 'find'], ['read', 'bash']);
    expect(result).toBe('write');
  });

  it('returns first requested tool when ceiling is empty (all tools fail)', () => {
    // checkToolCeiling checks each requested tool against the ceiling array.
    // When ceiling is empty, no tool is "in" it, so the first requested tool is returned.
    // NOTE: callers should not call checkToolCeiling with an empty ceiling (use
    // applyToolCeiling for the "no ceiling" case); this documents the actual behavior.
    const result = checkToolCeiling(['read', 'bash', 'write'], []);
    expect(result).toBe('read');
  });

  it('returns null when tool list matches ceiling exactly', () => {
    const result = checkToolCeiling(['read', 'bash'], ['read', 'bash']);
    expect(result).toBeNull();
  });

  it('first failure returned even when later tools in list are valid', () => {
    // 'bash' is not in ceiling, but 'read' comes after — first failure is 'bash'
    const result = checkToolCeiling(['bash', 'read'], ['read']);
    expect(result).toBe('bash');
  });
});
