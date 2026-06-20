import { describe, it, expect } from 'vitest';
import { formatBlockedResult, formatOkResult, formatStructuredResult } from '../../src/parent/result.js';

describe('result formatters', () => {
  it('formatOkResult labels output with agent name', () => {
    const r = formatOkResult('my-agent', 'task done');
    expect(r).toBe('from agent "my-agent": task done');
  });

  it('formatOkResult handles empty output', () => {
    const r = formatOkResult('my-agent', '(no output)');
    expect(r).toContain('from agent "my-agent"');
  });

  it('formatBlockedResult labels blocked result', () => {
    const r = formatBlockedResult('DEPTH_BLOCKED', 'too deep', 'my-agent');
    expect(r).toBe('[BLOCKED:DEPTH_BLOCKED] from agent "my-agent": too deep');
  });

  it('formatStructuredResult serializes output as JSON', () => {
    const r = formatStructuredResult('my-agent', { count: 42 });
    expect(r).toContain('"count":42');
    expect(r).toContain('from agent "my-agent"');
  });
});
