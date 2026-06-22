import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Regression: the default export must be a factory function, not an object
// wrapping an `activate` method (see `pi doctor` error).
// ---------------------------------------------------------------------------
import extensionFactory from '../../src/index.js';

type ToolDefinition = {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute: (
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: ((update: { content: Array<{ type: string; text: string }> }) => void) | undefined,
    ctx: unknown,
  ) => Promise<{ content: Array<{ type: string; text: string }>; details: Record<string, unknown>; isError?: boolean }>;
};

function mockExtensionAPI(): { registerTool: ReturnType<typeof vi.fn>; registeredTools: ToolDefinition[] } {
  const registeredTools: ToolDefinition[] = [];
  const registerTool = vi.fn((def: ToolDefinition) => {
    registeredTools.push(def);
  });
  return { registerTool, registeredTools };
}

describe('pi-structured-output extension', () => {
  // ---- Regression: export shape ----

  it('exports a function as default', () => {
    expect(extensionFactory).toBeTypeOf('function');
  });

  // ---- Registration when PI_OUTPUT_SCHEMA is absent ----

  it('does NOT register the tool when PI_OUTPUT_SCHEMA is not set', () => {
    delete process.env.PI_OUTPUT_SCHEMA;
    const { registerTool, registeredTools } = mockExtensionAPI();
    extensionFactory({ registerTool } as never);
    expect(registerTool).not.toHaveBeenCalled();
    expect(registeredTools).toHaveLength(0);
  });

  // ---- Registration when PI_OUTPUT_SCHEMA is set ----

  it('registers the structured_output tool when PI_OUTPUT_SCHEMA is set', () => {
    process.env.PI_OUTPUT_SCHEMA = '{"type":"object"}';
    const { registerTool, registeredTools } = mockExtensionAPI();
    extensionFactory({ registerTool } as never);
    expect(registerTool).toHaveBeenCalledTimes(1);
    expect(registeredTools).toHaveLength(1);
    expect(registeredTools[0].name).toBe('structured_output');
    expect(registeredTools[0].label).toBe('Structured Output');
    expect(registeredTools[0].description).toContain('output schema');
  });

  // ---- Execute handler ----

  describe('execute handler', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'pi-structured-output-test-'));
      process.env.PI_OUTPUT_SCHEMA = '{"type":"object"}';
    });

    afterEach(() => {
      delete process.env.PI_OUTPUT_SCHEMA;
      delete process.env.PI_OUTPUT_FILE;
      if (tmpDir && existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('writes output to PI_OUTPUT_FILE when set', async () => {
      const outputPath = join(tmpDir, 'result.json');
      process.env.PI_OUTPUT_FILE = outputPath;

      const { registeredTools } = mockExtensionAPI();
      extensionFactory({ registerTool: ((def: ToolDefinition) => { registeredTools.push(def); }) } as never);
      const tool = registeredTools[0];

      const result = await tool.execute('call-1', { output: { summary: 'hello' } }, undefined, undefined, undefined);

      expect(result.content[0].text).toContain('Output written successfully');
      expect(result.isError).toBeFalsy();
      expect(existsSync(outputPath)).toBe(true);

      const written = JSON.parse(readFileSync(outputPath, 'utf-8'));
      expect(written).toEqual({ summary: 'hello' });
    });

    it('writes output when called without output wrapper', async () => {
      const outputPath = join(tmpDir, 'result.json');
      process.env.PI_OUTPUT_FILE = outputPath;

      const { registeredTools } = mockExtensionAPI();
      extensionFactory({ registerTool: ((def: ToolDefinition) => { registeredTools.push(def); }) } as never);
      const tool = registeredTools[0];

      const result = await tool.execute('call-2', { summary: 'bare' }, undefined, undefined, undefined);

      expect(result.content[0].text).toContain('Output written successfully');
      const written = JSON.parse(readFileSync(outputPath, 'utf-8'));
      expect(written).toEqual({ summary: 'bare' });
    });

    it('returns an error message when PI_OUTPUT_FILE is not set', async () => {
      delete process.env.PI_OUTPUT_FILE;

      const { registeredTools } = mockExtensionAPI();
      extensionFactory({ registerTool: ((def: ToolDefinition) => { registeredTools.push(def); }) } as never);
      const tool = registeredTools[0];

      const result = await tool.execute('call-3', { output: { x: 1 } }, undefined, undefined, undefined);

      expect(result.content[0].text).toContain('PI_OUTPUT_FILE not set');
      expect(result.isError).toBe(true);
    });

    it('handles file write errors gracefully', async () => {
      // Point to a directory that doesn't exist
      process.env.PI_OUTPUT_FILE = join(tmpDir, 'nonexistent', 'out.json');

      const { registeredTools } = mockExtensionAPI();
      extensionFactory({ registerTool: ((def: ToolDefinition) => { registeredTools.push(def); }) } as never);
      const tool = registeredTools[0];

      const result = await tool.execute('call-4', { output: { x: 1 } }, undefined, undefined, undefined);

      expect(result.content[0].text).toContain('Error writing output');
      expect(result.isError).toBe(true);
    });
  });
});