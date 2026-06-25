/**
 * Conformance tests for guards.ts boundary conditions (finding G7 — HIGH)
 *
 * Tests boundary cases NOT covered by guards.test.ts:
 *   - Lineage cap: depth 49 entries → passes Check 3; 50 entries → DEPTH_BLOCKED
 *   - Depth boundary: depth == maxDepth - 1 → passes; depth == maxDepth → DEPTH_BLOCKED
 *   - First-failure ordering: multiple conditions would block, only earliest check fires
 */

import { describe, it, expect } from 'vitest';
import { runPreflight } from '../../src/parent/guards.js';
import type { PreflightContext } from '../../src/parent/guards.js';
import type { DelegateConfig, AgentDefinition } from '../../src/shared/types.js';
import { LINEAGE_PATH_CAP, encodeLineagePath } from '../../src/shared/lineage.js';

// ── Shared fixtures ───────────────────────────────────────────────────────────

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
};

const BASE_CTX: PreflightContext = {
  params: { task: 'do something' },
  config: DEFAULT_CONFIG,
  agentDef: DEFAULT_AGENT,
  depth: 0,
  lineagePath: '',
};

// ── Lineage cap boundary (Check 3) ────────────────────────────────────────────

describe('guards — lineage cap boundary (Check 3)', () => {
  it('passes when lineage path has exactly cap-1 (49) entries', () => {
    // 49 entries → not at cap → Check 3 passes
    const entries = Array.from({ length: LINEAGE_PATH_CAP - 1 }, (_, i) => `agent-${i}`);
    const lineagePath = encodeLineagePath(entries);

    const result = runPreflight({
      ...BASE_CTX,
      // depth must be within maxDepth to reach Check 3
      config: { ...DEFAULT_CONFIG, maxDepth: 100 },
      depth: 0,
      // Use an agent name not in the path to avoid cycle detection (Check 4)
      agentDef: { name: 'unique-agent-xyz', filePath: '/tmp/test.md' },
      lineagePath,
    });
    expect(result.blocked).toBe(false);
  });

  it('blocks with DEPTH_BLOCKED when lineage path has exactly cap (50) entries', () => {
    // 50 entries → at cap → Check 3 fires
    const entries = Array.from({ length: LINEAGE_PATH_CAP }, (_, i) => `agent-${i}`);
    const lineagePath = encodeLineagePath(entries);

    const result = runPreflight({
      ...BASE_CTX,
      config: { ...DEFAULT_CONFIG, maxDepth: 100 },
      depth: 0,
      lineagePath,
    });
    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.code).toBe('DEPTH_BLOCKED');
      expect(result.message).toContain(`${LINEAGE_PATH_CAP}`);
    }
  });

  it('blocks when lineage path exceeds cap (more than 50 entries)', () => {
    const entries = Array.from({ length: LINEAGE_PATH_CAP + 5 }, (_, i) => `agent-${i}`);
    const lineagePath = encodeLineagePath(entries);

    const result = runPreflight({
      ...BASE_CTX,
      config: { ...DEFAULT_CONFIG, maxDepth: 100 },
      depth: 0,
      lineagePath,
    });
    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.code).toBe('DEPTH_BLOCKED');
    }
  });
});

// ── Depth boundary (Check 2) ──────────────────────────────────────────────────

describe('guards — depth boundary (Check 2)', () => {
  it('passes when depth is exactly maxDepth - 1', () => {
    const config: DelegateConfig = { ...DEFAULT_CONFIG, maxDepth: 5 };
    const result = runPreflight({
      ...BASE_CTX,
      config,
      depth: 4, // maxDepth - 1 = 4 → should pass
    });
    expect(result.blocked).toBe(false);
  });

  it('blocks with DEPTH_BLOCKED when depth equals maxDepth', () => {
    const config: DelegateConfig = { ...DEFAULT_CONFIG, maxDepth: 5 };
    const result = runPreflight({
      ...BASE_CTX,
      config,
      depth: 5, // depth >= maxDepth → blocked
    });
    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.code).toBe('DEPTH_BLOCKED');
    }
  });

  it('blocks with DEPTH_BLOCKED when depth exceeds maxDepth', () => {
    const config: DelegateConfig = { ...DEFAULT_CONFIG, maxDepth: 3 };
    const result = runPreflight({
      ...BASE_CTX,
      config,
      depth: 10, // well above maxDepth
    });
    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.code).toBe('DEPTH_BLOCKED');
    }
  });

  it('passes at depth 0 with maxDepth 1', () => {
    const config: DelegateConfig = { ...DEFAULT_CONFIG, maxDepth: 1 };
    const result = runPreflight({
      ...BASE_CTX,
      config,
      depth: 0,
    });
    expect(result.blocked).toBe(false);
  });

  it('blocks at depth 1 with maxDepth 1', () => {
    const config: DelegateConfig = { ...DEFAULT_CONFIG, maxDepth: 1 };
    const result = runPreflight({
      ...BASE_CTX,
      config,
      depth: 1,
    });
    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.code).toBe('DEPTH_BLOCKED');
    }
  });
});

// ── First-failure ordering ────────────────────────────────────────────────────

describe('guards — first-failure ordering', () => {
  it('Check 1 fires before Check 2: empty task + depth blocked → INVALID_PARAMS returned', () => {
    // Both Check 1 (empty task) and Check 2 (depth >= maxDepth) would block.
    // Check 1 is first, so INVALID_PARAMS should be returned.
    const result = runPreflight({
      ...BASE_CTX,
      params: { task: '' },      // Check 1 triggers
      depth: 100,                // Check 2 would also trigger if we reached it
      config: { ...DEFAULT_CONFIG, maxDepth: 2 },
    });
    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.code).toBe('INVALID_PARAMS');
    }
  });

  it('Check 1 fires before Check 3: empty task + lineage at cap → INVALID_PARAMS returned', () => {
    const entries = Array.from({ length: LINEAGE_PATH_CAP }, (_, i) => `agent-${i}`);
    const lineagePath = encodeLineagePath(entries);

    const result = runPreflight({
      ...BASE_CTX,
      params: { task: '' },      // Check 1 triggers
      config: { ...DEFAULT_CONFIG, maxDepth: 100 },
      depth: 0,
      lineagePath,               // Check 3 would also trigger
    });
    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.code).toBe('INVALID_PARAMS');
    }
  });

  it('Check 2 fires before Check 4: depth blocked + agent in path → DEPTH_BLOCKED returned', () => {
    // depth >= maxDepth (Check 2) and agent already in path (Check 4 — cycle).
    // Check 2 comes before Check 4, so DEPTH_BLOCKED should be returned.
    const result = runPreflight({
      ...BASE_CTX,
      params: { task: 'some task' },
      depth: 2,                  // Check 2 triggers (depth >= maxDepth=2)
      config: { ...DEFAULT_CONFIG, maxDepth: 2 },
      lineagePath: 'root:test-agent', // Check 4 would also trigger
      agentDef: DEFAULT_AGENT,
    });
    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.code).toBe('DEPTH_BLOCKED');
    }
  });

  it('Check 3 fires before Check 4: cap reached + agent in path → DEPTH_BLOCKED returned', () => {
    // Lineage at cap (Check 3) and agent-0 is already in path (Check 4 — cycle).
    // Check 3 comes before Check 4.
    const entries = Array.from({ length: LINEAGE_PATH_CAP }, (_, i) => `agent-${i}`);
    const lineagePath = encodeLineagePath(entries);

    const result = runPreflight({
      ...BASE_CTX,
      params: { task: 'some task' },
      config: { ...DEFAULT_CONFIG, maxDepth: 100 },
      depth: 0,
      lineagePath,               // Check 3 triggers (at cap)
      agentDef: { name: 'agent-0', filePath: '/tmp/test.md' }, // would trigger Check 4 cycle
    });
    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.code).toBe('DEPTH_BLOCKED'); // Check 3 fires first
    }
  });

  it('Check 4 fires before Check 5: cycle + invalid schema → CYCLE_DETECTED returned', () => {
    // Cycle detection (Check 4) and invalid outputSchema (Check 5).
    // Check 4 comes before Check 5.
    const result = runPreflight({
      ...BASE_CTX,
      params: { task: 'some task' },
      depth: 1,
      config: { ...DEFAULT_CONFIG, maxDepth: 100 },
      lineagePath: 'root:test-agent', // Check 4 triggers (test-agent in path)
      agentDef: DEFAULT_AGENT,
      outputSchema: 'not-an-object' as unknown as object, // Check 5 would trigger
    });
    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.code).toBe('CYCLE_DETECTED'); // Check 4 fires first
    }
  });

  it('Check 5 fires before Check 6: invalid schema + unknown agent → SCHEMA_INVALID returned', () => {
    // Invalid outputSchema (Check 5) and missing agent (Check 6).
    // Check 5 comes before Check 6.
    const result = runPreflight({
      ...BASE_CTX,
      params: { task: 'some task', agent: 'missing-agent' },
      agentDef: undefined,       // Check 6 would trigger
      outputSchema: 'not-an-object' as unknown as object, // Check 5 triggers
    });
    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.code).toBe('SCHEMA_INVALID'); // Check 5 fires first
    }
  });

  it('Check 6 fires before Check 7: unknown agent + allowlist restriction → INVALID_PARAMS returned', () => {
    // Agent specified but not found (Check 6), and allowlist would also block (Check 7).
    // Check 6 comes before Check 7.
    const result = runPreflight({
      ...BASE_CTX,
      params: { task: 'some task', agent: 'missing-agent' },
      agentDef: undefined,       // Check 6 triggers
      allowedAgentNames: ['other-agent'], // Check 7 would also trigger
    });
    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.code).toBe('INVALID_PARAMS'); // Check 6 fires first
    }
  });
});
