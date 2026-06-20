import { describe, it, expect } from 'vitest';
import { resolveMaxDepth } from '../../src/parent/resolve.js';

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
