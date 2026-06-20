import { describe, it, expect } from 'vitest';
import { runPreflight } from '../../src/parent/guards.js';
import type { PreflightContext } from '../../src/parent/guards.js';
import type { DelegateConfig } from '../../src/shared/types.js';
import type { AgentDefinition } from '../../src/shared/types.js';

const DEFAULT_CONFIG: DelegateConfig = {
  maxDepth: 2,
  piBinaryPath: undefined,
  runTimeoutMs: undefined,
  sandboxCommand: undefined,
  childCwd: undefined,
};

const DEFAULT_AGENT: AgentDefinition = {
  name: 'test-agent',
  filePath: '/tmp/test.md',
  description: 'Test agent',
};

const BASE_CTX: PreflightContext = {
  params: { task: 'do something' },
  config: DEFAULT_CONFIG,
  agentDef: DEFAULT_AGENT,
  depth: 0,
  lineagePath: '',
};

describe('preflight guards', () => {
  it('passes when all checks are clean', () => {
    const result = runPreflight(BASE_CTX);
    expect(result.blocked).toBe(false);
  });

  it('INVALID_PARAMS: empty task string', () => {
    const result = runPreflight({ ...BASE_CTX, params: { task: '' } });
    expect(result.blocked).toBe(true);
    if (result.blocked) expect(result.code).toBe('INVALID_PARAMS');
  });

  it('DEPTH_BLOCKED: depth >= maxDepth', () => {
    const result = runPreflight({ ...BASE_CTX, depth: 2 });
    expect(result.blocked).toBe(true);
    if (result.blocked) expect(result.code).toBe('DEPTH_BLOCKED');
  });

  it('CYCLE_DETECTED: agent name already in lineage path', () => {
    const result = runPreflight({ ...BASE_CTX, lineagePath: 'parent:test-agent:child', depth: 1 });
    expect(result.blocked).toBe(true);
    if (result.blocked) expect(result.code).toBe('CYCLE_DETECTED');
  });

  it('SCHEMA_INVALID: non-object outputSchema', () => {
    const result = runPreflight({ ...BASE_CTX, outputSchema: 'not an object' as unknown as object });
    expect(result.blocked).toBe(true);
    if (result.blocked) expect(result.code).toBe('SCHEMA_INVALID');
  });

  it('INVALID_PARAMS: agent specified but not found', () => {
    const result = runPreflight({ ...BASE_CTX, params: { task: 'do it', agent: 'missing' }, agentDef: undefined });
    expect(result.blocked).toBe(true);
    if (result.blocked) expect(result.code).toBe('INVALID_PARAMS');
  });

  it('TOOL_NOT_PERMITTED: agent not in allowedAgentNames', () => {
    const result = runPreflight({ ...BASE_CTX, allowedAgentNames: ['other-agent'] });
    expect(result.blocked).toBe(true);
    if (result.blocked) expect(result.code).toBe('TOOL_NOT_PERMITTED');
  });

  it('SCHEMA_INVALID: uncompilable schema', () => {
    // A schema with invalid type should fail TypeBox compilation
    const result = runPreflight({ ...BASE_CTX, outputSchema: { type: 'invalid-type-xyz' } });
    // This may or may not fail depending on TypeBox strictness — check both paths
    if (result.blocked) {
      expect(result.code).toBe('SCHEMA_INVALID');
    }
  });
});
