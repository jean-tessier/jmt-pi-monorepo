import { describe, it, expect } from 'vitest';
import {
  sanitizeAgentName,
  detectCycle,
  appendToPath,
  encodeLineagePath,
  decodeLineagePath,
} from '../../src/shared/lineage.js';

describe('lineage', () => {
  it('sanitizeAgentName strips colons', () => {
    expect(sanitizeAgentName('bad:name')).not.toContain(':');
  });

  it('sanitizeAgentName strips path separators', () => {
    expect(sanitizeAgentName('../evil')).not.toContain('..');
  });

  it('detectCycle returns true when agent already in path', () => {
    expect(detectCycle('agent-a', ['root', 'agent-a', 'child'])).toBe(true);
  });

  it('detectCycle returns false when agent not in path', () => {
    expect(detectCycle('new-agent', ['root', 'agent-a', 'child'])).toBe(false);
  });

  it('appendToPath adds agent to path', () => {
    const result = appendToPath(['root', 'agent-a'], 'new-agent');
    expect(result).toContain('new-agent');
  });

  it('encode/decode round-trip', () => {
    const entries = ['root', 'child', 'grandchild'];
    const encoded = encodeLineagePath(entries);
    const decoded = decodeLineagePath(encoded);
    expect(decoded).toEqual(entries);
  });
});
