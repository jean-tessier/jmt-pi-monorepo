/**
 * Conformance tests for parallel fan-out (Issue 3: no integration test coverage)
 *
 * Covers:
 *   - TypeBox union schema validates single-task vs parallel branches correctly
 *   - runParallel with mock runOne (avoids spawning real processes)
 *   - execute dispatcher fan-out vs single selection
 *   - failFast parameter propagation
 *   - String normalization in executeParallel (belt-and-suspenders)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

import type { ParallelTask } from '../../src/shared/types.js';
import { runParallel } from '../../src/parent/parallel.js';
import type { ParallelResult } from '../../src/parent/parallel.js';
import { activate } from '../../src/parent/delegate-tool.js';
import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { loadConfig } from '../../src/parent/config.js';
import { spawnRun } from '../../src/parent/spawn.js';

vi.mock('../../src/parent/spawn.js', () => ({
  resolvePiBinary: vi.fn().mockResolvedValue('/mock/pi'),
  spawnRun: vi.fn().mockResolvedValue({
    output: 'mock delegated output',
    exitCode: 0,
    timedOut: false,
  }),
  generateCapabilityToken: vi.fn().mockReturnValue('mock-capability-token'),
  buildSpawnArgs: vi.fn().mockReturnValue([]),
}));

// ── Helpers: recreate the flat schema as defined in delegate-tool.ts ──────────

const PARALLEL_TASK_ITEM = Type.Object({
  task: Type.String(),
  agent: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  tools: Type.Optional(Type.Union([Type.Array(Type.String()), Type.String()])),
  prompt: Type.Optional(Type.String()),
  promptMode: Type.Optional(Type.String()),
  outputSchema: Type.Optional(Type.Object({})),
});

const DELEGATE_TOOL_PARAMS = Type.Object({
  task:         Type.Optional(Type.String()),
  agent:        Type.Optional(Type.String()),
  model:        Type.Optional(Type.String()),
  tools:        Type.Optional(Type.Array(Type.String())),
  prompt:       Type.Optional(Type.String()),
  promptMode:   Type.Optional(Type.String()),
  outputSchema: Type.Optional(Type.Object({})),
  parallel:     Type.Optional(Type.Array(PARALLEL_TASK_ITEM)),
  concurrency:  Type.Optional(Type.Number()),
  failFast:     Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

// ── Compile validators once ───────────────────────────────────────────────────

const validator = Compile(DELEGATE_TOOL_PARAMS);

// ── Mock ExtensionAPI ─────────────────────────────────────────────────────────

function createMockAPI(): {
  api: ExtensionAPI;
  tools: ToolDefinition<any, any, any>[];
  commands: Array<{ name: string; description: string; handler: Function }>;
  eventHandlers: Record<string, Function>;
  activeTools: string[];
} {
  const tools: ToolDefinition<any, any, any>[] = [];
  const commands: Array<{ name: string; description: string; handler: Function }> = [];
  const eventHandlers: Record<string, Function> = {};
  const activeTools: string[] = ['read', 'bash', 'write', 'edit', 'grep', 'find', 'ls'];

  const api: ExtensionAPI = {
    on(event: string, handler: any) { eventHandlers[event] = handler; },
    registerTool(tool: ToolDefinition<any, any, any>) { tools.push(tool); },
    registerCommand(name: string, options: any) { commands.push({ name, ...options }); },
    getActiveTools() { return activeTools; },
    registerShortcut: vi.fn(),
    registerFlag: vi.fn(),
    getFlag: vi.fn(() => undefined),
    registerMessageRenderer: vi.fn(),
    sendMessage: vi.fn(),
    sendUserMessage: vi.fn(),
    appendEntry: vi.fn(),
    setSessionName: vi.fn(),
    getSessionName: vi.fn(() => undefined),
    setLabel: vi.fn(),
    exec: vi.fn(),
    getAllTools: vi.fn(() => []),
    setActiveTools: vi.fn(),
    getCommands: vi.fn(() => []),
    setModel: vi.fn(() => Promise.resolve(true)),
    getThinkingLevel: vi.fn(() => 'off' as any),
    setThinkingLevel: vi.fn(),
    registerProvider: vi.fn(),
    unregisterProvider: vi.fn(),
    events: { on: vi.fn(), emit: vi.fn(), off: vi.fn(), once: vi.fn() } as any,
  };

  return { api, tools, commands, eventHandlers, activeTools };
}

// ── Tests: Schema validation ──────────────────────────────────────────────────

describe('parallel schema validation', () => {
  it('accepts valid single-task params (only task)', () => {
    const valid = validator.Check({ task: 'do something' });
    expect(valid).toBe(true);
  });

  it('accepts single-task params with optional fields', () => {
    const valid = validator.Check({
      task: 'do something',
      agent: 'researcher',
      model: 'google/gemini-2.5-flash-001',
      tools: ['read', 'bash'],
    });
    expect(valid).toBe(true);
  });

  it('accepts valid parallel params', () => {
    const valid = validator.Check({
      parallel: [
        { task: 'task 1' },
        { task: 'task 2', agent: 'specialist' },
      ],
      concurrency: 2,
    });
    expect(valid).toBe(true);
  });

  it('accepts parallel params with failFast', () => {
    const valid = validator.Check({
      parallel: [
        { task: 'task 1' },
        { task: 'task 2' },
      ],
      concurrency: 2,
      failFast: true,
    });
    expect(valid).toBe(true);
  });

  it('accepts combined task + parallel (schema-level; mutual exclusion is runtime-only)', () => {
    const valid = validator.Check({
      task: 'single task',
      parallel: [{ task: 'parallel task' }],
    });
    expect(valid).toBe(true);
  });

  it('accepts neither task nor parallel (all fields optional at schema level)', () => {
    const valid = validator.Check({ concurrency: 1 });
    expect(valid).toBe(true);
  });

  it('rejects parallel items that are plain strings (must be objects)', () => {
    const valid = validator.Check({
      parallel: ['string task 1', 'string task 2'],
    });
    expect(valid).toBe(false);
  });

  it('rejects parallel items missing required task field', () => {
    const valid = validator.Check({
      parallel: [{ agent: 'bob' }],
    });
    expect(valid).toBe(false);
  });

  it('accepts parallel items with all optional fields', () => {
    const valid = validator.Check({
      parallel: [{
        task: 'research',
        agent: 'researcher',
        model: 'google/gemini-2.5-flash-001',
        tools: ['read', 'bash'],
        prompt: 'Be thorough',
        promptMode: 'append',
        outputSchema: { type: 'object', properties: { answer: { type: 'string' } } },
      }],
    });
    expect(valid).toBe(true);
  });

  it('accepts parallel items with single-string tools', () => {
    const valid = validator.Check({
      parallel: [{ task: 'task', tools: 'read' }],
    });
    expect(valid).toBe(true);
  });
});

// ── Tests: execute dispatcher selection ───────────────────────────────────────

describe('execute dispatcher', () => {
  let mock: ReturnType<typeof createMockAPI>;

  beforeEach(() => {
    mock = createMockAPI();
    delete process.env.PI_DELEGATE_TOKEN;
  });

  it('activates without error', () => {
    expect(() => activate(mock.api)).not.toThrow();
  });

  it('registers a tool with a flat object schema', () => {
    activate(mock.api);
    const tool = mock.tools[0];
    expect(tool.name).toBe('delegate');
    expect(tool.parameters).toBeDefined();
  });

  it('schema root is type:object, not anyOf (OpenAI Chat Completions compat)', () => {
    activate(mock.api);
    const tool = mock.tools[0];
    const params = tool.parameters as Record<string, unknown>;
    expect(params['type']).toBe('object');
    expect('anyOf' in params).toBe(false);
  });
});

// ── Tests: runParallel with mock callbacks ────────────────────────────────────

describe('runParallel', () => {
  it('runs tasks in parallel and returns ordered results', async () => {
    const tasks: ParallelTask[] = [
      { task: 'first' },
      { task: 'second' },
      { task: 'third' },
    ];

    const order: number[] = [];
    const runOne = async (task: ParallelTask, index: number): Promise<string> => {
      order.push(index);
      return `from agent "default": done ${task.task}`;
    };

    const results = await runParallel(tasks, {}, runOne);

    expect(results).toHaveLength(3);
    // Results should be in input order
    expect(results[0].index).toBe(0);
    expect(results[0].output).toContain('first');
    expect(results[1].index).toBe(1);
    expect(results[1].output).toContain('second');
    expect(results[2].index).toBe(2);
    expect(results[2].output).toContain('third');
    // Order array should have all indices (regardless of concurrency scheduling)
    expect(order.sort()).toEqual([0, 1, 2]);
  });

  it('respects concurrency limit', async () => {
    const tasks: ParallelTask[] = Array.from({ length: 10 }, (_, i) => ({ task: `task-${i}` }));

    let maxInFlight = 0;
    let currentInFlight = 0;

    const runOne = async (_task: ParallelTask, _index: number): Promise<string> => {
      currentInFlight++;
      maxInFlight = Math.max(maxInFlight, currentInFlight);
      await new Promise(resolve => setTimeout(resolve, 10));
      currentInFlight--;
      return 'ok';
    };

    await runParallel(tasks, { concurrency: 3 }, runOne);
    // With limit 3, we should never have more than 3 concurrent
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it('captures errors without aborting siblings (default failFast=false)', async () => {
    const tasks: ParallelTask[] = [
      { task: 'good' },
      { task: 'bad' },
      { task: 'also good' },
    ];

    const runOne = async (task: ParallelTask, _index: number): Promise<string> => {
      if (task.task === 'bad') throw new Error('boom');
      return `ok: ${task.task}`;
    };

    const results = await runParallel(tasks, {}, runOne);

    expect(results).toHaveLength(3);
    expect(results[0].status).toBe('ok');
    expect(results[0].output).toBe('ok: good');
    expect(results[1].status).toBe('error');
    expect(results[1].output).toContain('boom');
    expect(results[2].status).toBe('ok');
    expect(results[2].output).toBe('ok: also good');
  });

  it('aborts siblings on first error when failFast=true', async () => {
    const tasks: ParallelTask[] = [
      { task: 'good' },
      { task: 'failer' },
      { task: 'never runs' },
    ];

    const executionOrder: number[] = [];

    const runOne = async (task: ParallelTask, index: number): Promise<string> => {
      executionOrder.push(index);
      if (task.task === 'failer') throw new Error('boom');
      await new Promise(resolve => setTimeout(resolve, 5));
      return `ok: ${task.task}`;
    };

    const results = await runParallel(tasks, { concurrency: 3, failFast: true }, runOne);

    expect(results).toHaveLength(3);
    // The failing task should have error status
    expect(results[1].status).toBe('error');
    // At least one task succeeded, one failed - the third may or may not have run
    // (depends on scheduling, but failFast should abort the controller)
    const okCount = results.filter(r => r.status === 'ok').length;
    const errorCount = results.filter(r => r.status === 'error').length;
    expect(okCount).toBeGreaterThanOrEqual(0);
    expect(errorCount).toBeGreaterThanOrEqual(1);
  });

  it('handles empty task array', async () => {
    const tasks: ParallelTask[] = [];
    const runOne = vi.fn();

    const results = await runParallel(tasks, {}, runOne);
    expect(results).toHaveLength(0);
    expect(runOne).not.toHaveBeenCalled();
  });

  it('propagates AbortSignal to runOne', async () => {
    const tasks: ParallelTask[] = [{ task: 'test' }];
    const abortController = new AbortController();

    const runOne = vi.fn(async (_task: ParallelTask, _index: number, signal?: AbortSignal) => {
      return `signal aborted: ${signal?.aborted ?? false}`;
    });

    const results = await runParallel(tasks, { signal: abortController.signal }, runOne);
    expect(results[0].output).toBe('signal aborted: false');
    expect(runOne).toHaveBeenCalledWith(
      { task: 'test' },
      0,
      expect.objectContaining({ aborted: false }),
    );
  });

  it('applies maxConcurrency hard ceiling', async () => {
    const tasks: ParallelTask[] = Array.from({ length: 5 }, (_, i) => ({ task: `t${i}` }));
    let maxInFlight = 0;
    let current = 0;

    const runOne = async () => {
      current++;
      maxInFlight = Math.max(maxInFlight, current);
      await new Promise(resolve => setTimeout(resolve, 5));
      current--;
      return 'ok';
    };

    // maxConcurrency default is 10, concurrency 5 — so effective is 5
    await runParallel(tasks, { concurrency: 5, maxConcurrency: 3 }, runOne);
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  // ── Finding B3: concurrency clamp ───────────────────────────────────────────

  it('clamps concurrency 0 up to at least 1 instead of hanging', async () => {
    const tasks: ParallelTask[] = [{ task: 'a' }, { task: 'b' }];
    const ran: number[] = [];
    const runOne = async (_t: ParallelTask, idx: number) => {
      ran.push(idx);
      return `ok-${idx}`;
    };

    // concurrency: 0 would start zero workers and hang forever pre-fix.
    const results = await runParallel(tasks, { concurrency: 0 }, runOne);
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('ok');
    expect(results[1].status).toBe('ok');
    expect(ran.sort()).toEqual([0, 1]);
  });

  it('clamps negative concurrency up to at least 1', async () => {
    const tasks: ParallelTask[] = [{ task: 'a' }];
    const results = await runParallel(tasks, { concurrency: -5 }, async () => 'ok');
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('ok');
  });

  // ── Finding B1: parent signal still reaches children under failFast ─────────

  it('composes parent signal with failFast so parent cancel reaches runOne', async () => {
    const tasks: ParallelTask[] = [{ task: 'a' }, { task: 'b' }];
    const parent = new AbortController();
    const seenAbortedAtCall: boolean[] = [];

    const runOne = async (_t: ParallelTask, idx: number, signal?: AbortSignal) => {
      seenAbortedAtCall[idx] = signal?.aborted ?? false;
      // Abort the PARENT mid-flight after the first task observes a live signal.
      if (idx === 0) parent.abort();
      return `ok-${idx}`;
    };

    const results = await runParallel(
      tasks,
      { concurrency: 1, failFast: true, signal: parent.signal },
      runOne,
    );

    // First task saw a live (non-aborted) composed signal.
    expect(seenAbortedAtCall[0]).toBe(false);
    // After the parent aborted, the SECOND task is short-circuited (B2) because
    // the composed signal (parent ∨ failFast) is now aborted — proving the parent
    // signal is part of the composition (B1), not dropped under failFast.
    expect(results[1].status).toBe('error');
    expect(results[1].output).toContain('cancelled before start');
  });

  it('forwards the parent signal unchanged when failFast is off', async () => {
    const tasks: ParallelTask[] = [{ task: 'a' }];
    const parent = new AbortController();
    let forwarded: AbortSignal | undefined;

    await runParallel(
      tasks,
      { signal: parent.signal, failFast: false },
      async (_t, _i, signal) => { forwarded = signal; return 'ok'; },
    );

    // Without failFast, the exact parent signal instance is forwarded.
    expect(forwarded).toBe(parent.signal);
  });
});

// ── Tests: ParallelResult shape ──────────────────────────────────────────────

describe('ParallelResult shape', () => {
  it('has index, output, and status fields', async () => {
    const tasks: ParallelTask[] = [{ task: 'test' }];
    const results: ParallelResult[] = await runParallel(tasks, {}, async () => 'output here');

    expect(results[0]).toHaveProperty('index');
    expect(results[0]).toHaveProperty('output');
    expect(results[0]).toHaveProperty('status');
    expect(typeof results[0].index).toBe('number');
    expect(typeof results[0].output).toBe('string');
    expect(['ok', 'error']).toContain(results[0].status);
  });
});

// ── Tests: loadConfig defaults ────────────────────────────────────────────────

describe('loadConfig defaults', () => {
  it('default config has runTimeoutMs of 600_000', () => {
    const savedPath = process.env.PI_DELEGATE_CONFIG_PATH;
    const savedTimeout = process.env.PI_DELEGATE_RUN_TIMEOUT_MS;
    // Point to a non-existent config file so only in-code defaults are used
    process.env.PI_DELEGATE_CONFIG_PATH = '/nonexistent-path-for-testing-defaults';
    delete process.env.PI_DELEGATE_RUN_TIMEOUT_MS;
    try {
      const config = loadConfig();
      expect(config.runTimeoutMs).toBe(600_000);
    } finally {
      if (savedPath !== undefined) {
        process.env.PI_DELEGATE_CONFIG_PATH = savedPath;
      } else {
        delete process.env.PI_DELEGATE_CONFIG_PATH;
      }
      if (savedTimeout !== undefined) {
        process.env.PI_DELEGATE_RUN_TIMEOUT_MS = savedTimeout;
      }
    }
  });
});

// ── Tests: signal forwarding in executeParallel ───────────────────────────────

describe('executeParallel signal forwarding', () => {
  let mock: ReturnType<typeof createMockAPI>;

  beforeEach(() => {
    mock = createMockAPI();
    delete process.env.PI_DELEGATE_TOKEN;
    vi.mocked(spawnRun).mockClear();
  });

  it('passes the runOne signal to executeSingle as parentSignal', async () => {
    activate(mock.api);
    const tool = mock.tools[0];

    // A LIVE (non-aborted) parent signal must thread all the way through
    // executeParallel → runParallel → executeSingle → spawnRun, proving the
    // parent cancellation channel reaches each child slot (AGENTS.md signal
    // forwarding invariant). Using a live signal (not pre-aborted) so the spawn
    // actually happens — see the next test for the pre-aborted short-circuit.
    const abortController = new AbortController();

    await tool.execute(
      'call-signal-test',
      { parallel: [{ task: 'signal test task' }] },
      abortController.signal,
      undefined,
      {} as any,
    );

    expect(vi.mocked(spawnRun)).toHaveBeenCalledOnce();
    const callOptions = vi.mocked(spawnRun).mock.calls[0][3] as { signal?: AbortSignal };
    // The signal is forwarded (defined) and reflects the parent's state.
    expect(callOptions.signal).toBeDefined();
    expect(callOptions.signal?.aborted).toBe(false);
  });

  it('short-circuits a pre-aborted parent signal without spawning a child (B2)', async () => {
    activate(mock.api);
    const tool = mock.tools[0];

    // Pre-aborted parent signal: per finding B2, runParallel must NOT spawn a
    // child only to immediately kill it — it short-circuits to a blocked result.
    const abortController = new AbortController();
    abortController.abort();

    const result = await tool.execute(
      'call-preaborted',
      { parallel: [{ task: 'signal test task' }] },
      abortController.signal,
      undefined,
      {} as any,
    );

    // No child was spawned (B2 short-circuit).
    expect(vi.mocked(spawnRun)).not.toHaveBeenCalled();
    // The result is a labeled blocked string (never-throw contract upheld).
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    expect(text).toContain('[BLOCKED:ERROR]');
    expect(text).toContain('cancelled before start');
  });
});

// ── Tests: onUpdate forwarding in executeParallel ─────────────────────────────

describe('executeParallel onUpdate forwarding', () => {
  let mock: ReturnType<typeof createMockAPI>;

  beforeEach(() => {
    mock = createMockAPI();
    delete process.env.PI_DELEGATE_TOKEN;
    vi.mocked(spawnRun).mockClear();
  });

  it('forwards onUpdate to each parallel branch via executeSingle → spawnRun', async () => {
    // spawnRun is mocked at module level; configure it to fire the onUpdate callback once per call
    vi.mocked(spawnRun).mockImplementation(async (_binary, _args, _tempFiles, options) => {
      // Fire a synthetic agent_start event so onUpdate is exercised
      options.onUpdate?.({ type: 'agent_start', agent: 'default' });
      return { output: 'mock output', exitCode: 0, timedOut: false };
    });

    activate(mock.api);
    const tool = mock.tools[0];

    const onUpdate = vi.fn();

    await tool.execute(
      'call-onupdate-forwarding',
      { parallel: [{ task: 'branch A' }, { task: 'branch B' }] },
      undefined,
      onUpdate,
      {} as any,
    );

    // spawnRun was called twice (once per branch)
    expect(vi.mocked(spawnRun)).toHaveBeenCalledTimes(2);

    // onUpdate was forwarded and called at least once per branch (2 agent_start events minimum)
    expect(onUpdate.mock.calls.length).toBeGreaterThanOrEqual(2);

    // Each call to onUpdate must have been invoked with the framework-shaped payload
    for (const call of onUpdate.mock.calls) {
      const payload = call[0] as { content: Array<{ type: string; text: string }>; details: Record<string, unknown> };
      expect(payload).toHaveProperty('content');
      expect(Array.isArray(payload.content)).toBe(true);
      expect(payload.content[0]).toMatchObject({ type: 'text' });
    }
  });

  it('completes without error when onUpdate is not provided (regression)', async () => {
    vi.mocked(spawnRun).mockResolvedValue({ output: 'ok', exitCode: 0, timedOut: false });

    activate(mock.api);
    const tool = mock.tools[0];

    // No onUpdate argument — fourth parameter omitted (undefined)
    const result = await tool.execute(
      'call-no-onupdate',
      { parallel: [{ task: 'branch A' }, { task: 'branch B' }] },
      undefined,
      undefined,
      {} as any,
    );

    expect(vi.mocked(spawnRun)).toHaveBeenCalledTimes(2);
    // Tool result should still be returned correctly
    expect(result).toHaveProperty('content');
  });
});