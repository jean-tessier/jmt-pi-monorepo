/**
 * Schema compilation tests for pi-delegate (TDD task)
 *
 * Tests that compileSchema works correctly and that the module can be loaded
 * using the same module resolution strategy that pi uses (typebox v1.1 via jiti).
 *
 * The RED phase demonstrates that the current `@sinclair/typebox/compiler`
 * (with "er") import path fails when resolved against pi's bundled `typebox` v1.1
 * package which only has `./compile` (without "er").
 */

import { describe, it, expect } from 'vitest';
import { compileSchema, isJsonSchemaObject } from '../../src/shared/schema.js';

// ---------------------------------------------------------------------------
// RED test: loading via jiti with pi-compatible aliases (typebox v1.1)
// ---------------------------------------------------------------------------
describe('schema module resolution under pi', () => {
  // This test does a real jiti dynamic import with requireCache:false, which
  // transpiles TS on the fly — a CPU-heavy ~1 s operation. It sits comfortably
  // under the 5 s default in isolation, but the on-the-fly transform can exceed
  // it under heavy concurrent load (e.g. multiple suites oversubscribing the CPU),
  // causing a spurious timeout. A generous explicit timeout (30 s, ~20-30x normal)
  // tolerates that load while still failing fast if the import genuinely hangs.
  it('loads schema module via jiti with pi-compatible typebox v1.1 aliases', async () => {
    // This simulates how pi's extension loader resolves @sinclair/typebox
    // using jiti aliases that point to typebox v1.1 (which has ./compile, not ./compiler)
    const typeboxDir = '/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/typebox';

    const { default: jiti } = await import('jiti') as unknown as { default: (filename: string, opts?: import('jiti').JITIOptions) => import('jiti').JITI };
    const _jiti = jiti(import.meta.url, {
      requireCache: false,
      alias: {
        '@sinclair/typebox': typeboxDir,
        '@sinclair/typebox/compile': typeboxDir + '/build/compile/index.mjs',
      },
    });

    const mod = await _jiti.import(new URL('../../src/shared/schema.ts', import.meta.url).href, {}) as Record<string, unknown>;
    expect(mod.compileSchema).toBeDefined();
    expect(mod.isJsonSchemaObject).toBeDefined();
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Functional tests (should pass with both old and new typebox)
// ---------------------------------------------------------------------------
describe('compileSchema', () => {
  it('compiles a valid JSON Schema and validates values correctly', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name'],
    };
    const validator = compileSchema(schema);
    expect(validator.validate({ name: 'Alice', age: 30 })).toBe(true);
    expect(validator.validate({ name: 'Bob' })).toBe(true);
    expect(validator.validate({ name: 123 })).toBe(false);
    expect(validator.validate({})).toBe(false);
  });

  it('compiles an array schema', () => {
    const schema = { type: 'array', items: { type: 'number' } };
    const validator = compileSchema(schema);
    expect(validator.validate([1, 2, 3])).toBe(true);
    expect(validator.validate(['a', 'b'])).toBe(false);
  });

  it('throws on null input (after isJsonSchemaObject would pass)', () => {
    // null would normally be caught by isJsonSchemaObject,
    // but if it slips through, compileSchema should throw
    expect(() => compileSchema(null as unknown as object)).toThrow('Invalid JSON Schema');
  });

  it('throws on undefined input (after isJsonSchemaObject would pass)', () => {
    expect(() => compileSchema(undefined as unknown as object)).toThrow('Invalid JSON Schema');
  });
});

describe('isJsonSchemaObject', () => {
  it('returns true for plain objects', () => {
    expect(isJsonSchemaObject({})).toBe(true);
    expect(isJsonSchemaObject({ type: 'string' })).toBe(true);
  });

  it('returns false for non-objects', () => {
    expect(isJsonSchemaObject(null)).toBe(false);
    expect(isJsonSchemaObject('string')).toBe(false);
    expect(isJsonSchemaObject(42)).toBe(false);
    expect(isJsonSchemaObject([])).toBe(false);
  });
});