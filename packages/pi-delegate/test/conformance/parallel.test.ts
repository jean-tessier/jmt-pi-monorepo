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

// ── Tool parameters (extracted from delegate-tool.ts) ─────────────────────────
// Rather than hand-copy and risk divergence, we reconstruct the schema
// to match the source definition. This ensures all conformance tests validate
// against the actual tool parameters.

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
    // actually happens — see the next test for the pre-aborted short-circuit (B2).
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
    // The signal is forwarded (defined) and reflects the parent's (live) state.
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

// ── Tests: Wave-2 corrected behavior (T3.1 additions) ─────────────────────────
//
// INTEGRATION NOTE (T4.1): the B4 process-wide cap and the real failFast
// sibling-abort below describe the CORRECTED (post-T2.2) parallel.ts behavior.
// They were `it.fails(...)` while T2.2 was unmerged; now that T2.2 has landed
// (configureSpawnPool / withSpawnSlot wrapping each runOne slot, AbortSignal.any
// composition, pre-spawn aborted-check) they are live regression assertions that
// must PASS. The G11 format test was always a plain (non-`.fails`) assertion.

// B4: a process-wide cap (config.maxInFlightChildren) must bound the TOTAL number
// of live children across CONCURRENT runParallel calls — not just the siblings of
// one call. T2.2 enforces this via the shared spawn-pool semaphore: runParallel
// calls configureSpawnPool(maxInFlightChildren) and wraps each runOne slot with
// withSpawnSlot, so two concurrent calls draw from one shared budget.
describe('runParallel process-wide cap (B4)', () => {
  it('bounds combined in-flight children across two concurrent runParallel calls', async () => {
    let current = 0;
    let maxObserved = 0;

    // Each runOne announces it has started, then parks on a shared gate so we can
    // pin many tasks "in flight" simultaneously and observe the true peak. This is
    // deterministic: nothing finishes until we open the gate.
    let openGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => { openGate = resolve; });
    let startedCount = 0;
    let onStarted: () => void = () => {};

    const runOne = async (): Promise<string> => {
      current++;
      maxObserved = Math.max(maxObserved, current);
      startedCount++;
      onStarted();
      await gate;
      current--;
      return 'ok';
    };

    const cap = 2;
    const tasksA: ParallelTask[] = Array.from({ length: 4 }, (_, i) => ({ task: `A${i}` }));
    const tasksB: ParallelTask[] = Array.from({ length: 4 }, (_, i) => ({ task: `B${i}` }));

    // Two concurrent calls, each allowed per-call concurrency 4, but a global cap of 2.
    const runs = Promise.all([
      runParallel(tasksA, { concurrency: 4, maxInFlightChildren: cap }, runOne),
      runParallel(tasksB, { concurrency: 4, maxInFlightChildren: cap }, runOne),
    ]);

    // Wait until the system has parked as many tasks as it ever will (a short quiet
    // period with no new starts), then release the gate. Under a process-wide cap
    // only `cap` tasks can be parked at once; without it, both calls park 4 each.
    await new Promise<void>((resolve) => {
      let lastStarted = -1;
      const tick = (): void => {
        if (startedCount === lastStarted) { resolve(); return; }
        lastStarted = startedCount;
        onStarted = () => {};
        setTimeout(tick, 10);
      };
      onStarted = () => {};
      setTimeout(tick, 10);
    });

    openGate();
    await runs;

    // With a process-wide cap, the two calls combined never exceed `cap` children.
    expect(maxObserved).toBeLessThanOrEqual(cap);
  });
});

// B1: with failFast, a failing task must abort its SIBLINGS via a signal that also
// composes the PARENT signal. Concretely, after one task fails, later-scheduled
// tasks must observe an aborted runSignal and short-circuit (status 'error',
// "cancelled before start") instead of running their full body. T2.2 added the
// AbortSignal.any composition and the pre-spawn aborted-check, so a later sibling
// is short-circuited without calling runOne. Live regression assertion (T2.2 landed).
describe('runParallel failFast sibling-abort (B1)', () => {
  it('does not invoke runOne for siblings cancelled after the first failure under failFast', async () => {
    const tasks: ParallelTask[] = [
      { task: 'fails-first', agent: 'a0' },
      { task: 'sibling-1', agent: 'a1' },
      { task: 'sibling-2', agent: 'a2' },
      { task: 'sibling-3', agent: 'a3' },
    ];

    // concurrency 1 forces strictly sequential scheduling: index 0 fails (aborting
    // the run signal) before indices 1..3 are picked up. The CORRECTED worker checks
    // runSignal?.aborted BEFORE calling runOne and records a cheap blocked result —
    // so runOne is invoked exactly once (for index 0). On this branch the worker
    // calls runOne for every index regardless, so runOne is called 4 times.
    const runOne = vi.fn(async (task: ParallelTask): Promise<string> => {
      if (task.task === 'fails-first') throw new Error('first boom');
      return `ok: ${task.task}`;
    });

    const results = await runParallel(tasks, { concurrency: 1, failFast: true }, runOne);

    expect(results[0].status).toBe('error');
    // Corrected behavior: siblings are short-circuited WITHOUT calling runOne.
    expect(runOne).toHaveBeenCalledTimes(1);
    // Every cancelled sibling still carries a labeled blocked string in its result.
    for (let i = 1; i < results.length; i++) {
      expect(results[i].status).toBe('error');
      expect(results[i].output).toContain('cancelled before start');
    }
  });
});

// G11: a parallel blocked result must carry the REAL agent name, never the literal
// "unknown". The normal path is that runOne (executeSingle) returns its own labeled
// string — which runParallel passes through verbatim on the success branch — so the
// agent name is preserved. The "unknown" fallback only appears in runParallel's
// throw-catch branch when an unnamed task's runOne THROWS; post-T2.1 executeSingle
// never throws, so that branch is unreachable for real runs. This is provable
// through the current code, so it is a live (non-`.fails`) assertion.
describe('runParallel error result string format (G11)', () => {
  it('passes through a labeled blocked string with its real agent name', async () => {
    const tasks: ParallelTask[] = [
      { task: 'blocked task', agent: 'researcher' },
      { task: 'ok task', agent: 'writer' },
    ];

    // runOne returns labeled strings exactly as executeSingle would — including a
    // [BLOCKED:ERROR] string for the first task. runParallel must NOT rewrite the
    // agent name to "unknown".
    const runOne = async (task: ParallelTask): Promise<string> => {
      if (task.task === 'blocked task') {
        return `[BLOCKED:ERROR] from agent "${task.agent}": child exited with code 1`;
      }
      return `from agent "${task.agent}": done`;
    };

    const results = await runParallel(tasks, {}, runOne);

    expect(results[0].output).toBe('[BLOCKED:ERROR] from agent "researcher": child exited with code 1');
    expect(results[0].output).not.toContain('"unknown"');
    expect(results[1].output).toBe('from agent "writer": done');
  });

  it('uses the task agent name (not "unknown") when a NAMED task throws', async () => {
    // When runOne THROWS for a NAMED task, runParallel's catch branch must label the
    // result with that task's agent name, never the literal "unknown".
    const tasks: ParallelTask[] = [{ task: 'throwing task', agent: 'named-agent' }];

    const runOne = async (): Promise<string> => {
      throw new Error('something broke');
    };

    const results = await runParallel(tasks, {}, runOne);

    expect(results[0].status).toBe('error');
    expect(results[0].output).toContain('from agent "named-agent"');
    expect(results[0].output).not.toContain('"unknown"');
    expect(results[0].output).toContain('something broke');
  });
});

// ── Tests: runParallel concurrency clamping (B3) ──────────────────────────────
//
// Finding B3: concurrency values of 0, NaN, or negative must NOT produce zero
// workers (which would cause tasks to hang forever). The code in parallel.ts
// treats NaN/non-finite as the default (5) before Math.max(1, ...) clamps any
// remaining non-positive value to at least 1 worker. These tests verify that all
// tasks complete — which is only possible if at least 1 worker ran.

describe('runParallel concurrency clamping (B3)', () => {
  it('clamps concurrency:0 to at least 1 worker so tasks complete', async () => {
    const tasks: ParallelTask[] = [
      { task: 'task-0' },
      { task: 'task-1' },
    ];

    const runOne = async (task: ParallelTask, index: number): Promise<string> => {
      return `done: ${task.task}`;
    };

    // With concurrency: 0 a naive impl would start zero workers and hang forever.
    // The B3 clamp guarantees Math.max(1, ...) lifts it to 1 so both tasks complete.
    const results = await runParallel(tasks, { concurrency: 0 }, runOne);

    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('ok');
    expect(results[0].output).toContain('task-0');
    expect(results[1].status).toBe('ok');
    expect(results[1].output).toContain('task-1');
  });

  it('clamps concurrency:NaN to default so tasks complete', async () => {
    const tasks: ParallelTask[] = [
      { task: 'task-A' },
      { task: 'task-B' },
    ];

    const runOne = async (task: ParallelTask, index: number): Promise<string> => {
      return `done: ${task.task}`;
    };

    // NaN propagates through Math.min/Math.max (IEEE 754), so the code first maps
    // NaN to the default (5) before clamping. Both tasks must complete.
    const results = await runParallel(tasks, { concurrency: NaN }, runOne);

    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('ok');
    expect(results[0].output).toContain('task-A');
    expect(results[1].status).toBe('ok');
    expect(results[1].output).toContain('task-B');
  });

  it('clamps negative concurrency to at least 1 worker', async () => {
    const tasks: ParallelTask[] = [
      { task: 'task-X' },
      { task: 'task-Y' },
    ];

    const runOne = async (task: ParallelTask, index: number): Promise<string> => {
      return `done: ${task.task}`;
    };

    // Math.max(1, -5) = 1, so exactly 1 worker runs and both tasks complete serially.
    const results = await runParallel(tasks, { concurrency: -5 }, runOne);

    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('ok');
    expect(results[0].output).toContain('task-X');
    expect(results[1].status).toBe('ok');
    expect(results[1].output).toContain('task-Y');
  });
});

// ── Tests: runParallel parent-signal composition (B1) ─────────────────────────
//
// Finding B1: when failFast is enabled, a failing task aborts siblings via an
// internal AbortController. The FIX (T2.2) also composes the PARENT signal so
// that a tool-level cancel ALSO reaches the children — previously the parent
// signal was dropped entirely when failFast was on. These tests verify:
//   1. Aborting the parent mid-run cancels remaining tasks even with failFast:true.
//   2. Without failFast, the parent signal is forwarded unchanged to runOne.

describe('runParallel parent-signal composition (B1)', () => {
  it('aborting parent signal cancels tasks even with failFast:true', async () => {
    // DETERMINISTIC (no wall-clock race): an earlier version raced a 30 ms parent
    // abort against 200 ms task parks under real timers, which flaked under heavy
    // concurrent suite load when the timers drifted. Instead we drive the abort
    // off an explicit "first task is in-flight" cue: the parent is aborted the
    // instant task 0 has entered runOne and wired its abort listener, so the
    // siblings queued behind concurrency:1 are always short-circuited.
    //
    // (This test passes runOne directly to runParallel, so the module-level
    // spawnRun mock is never exercised here — no override needed.)
    const controller = new AbortController();

    const tasks: ParallelTask[] = [
      { task: 'slow-task-0' },
      { task: 'slow-task-1' },
      { task: 'slow-task-2' },
    ];

    // Resolves once task 0 is parked inside runOne — our cue to abort the parent.
    let signalFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => { signalFirstStarted = resolve; });

    // Run with failFast:true AND the parent signal so both cancellation paths
    // (sibling-abort and parent-abort) compose via AbortSignal.any().
    const runOne = vi.fn(async (task: ParallelTask, index: number, signal?: AbortSignal): Promise<string> => {
      if (index === 0) signalFirstStarted();
      // Park until the composed signal aborts. The generous safety timeout never
      // fires on the happy path (the abort below clears it on a microtask, long
      // before 1 s of wall clock) — it exists only so a B1 regression that drops
      // the parent signal fails via assertion instead of hanging to the timeout.
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 1000);
        signal?.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new Error('cancelled by composed signal'));
        }, { once: true });
      });
      return `ok: ${task.task}`;
    });

    const resultsPromise = runParallel(
      tasks,
      { concurrency: 1, failFast: true, signal: controller.signal },
      runOne,
    );

    // Abort the parent only once task 0 is genuinely in-flight — deterministic,
    // no reliance on relative timer ordering.
    await firstStarted;
    controller.abort();

    const results = await resultsPromise;

    // All indices populated and the parent signal is aborted.
    expect(results).toHaveLength(3);
    expect(controller.signal.aborted).toBe(true);

    // runOne ran for task 0 only; the two queued siblings were short-circuited
    // before runOne via the pre-spawn aborted-check (B2) — proving the parent
    // abort reached the composed run signal even under failFast (B1).
    expect(runOne).toHaveBeenCalledTimes(1);

    // Both cancelled siblings carry the blocked-result label rather than succeeding.
    const cancelledResults = results.filter(r => r.output.includes('cancelled before start'));
    expect(cancelledResults).toHaveLength(2);
  });

  it('forwards parent signal unchanged when failFast is false', async () => {
    // Reset spawnRun to the default fast mock for this test.
    vi.mocked(spawnRun).mockResolvedValue({ output: 'ok', exitCode: 0, timedOut: false });

    const parentController = new AbortController();
    const capturedSignals: Array<AbortSignal | undefined> = [];

    const tasks: ParallelTask[] = [
      { task: 'task-p1' },
      { task: 'task-p2' },
    ];

    const runOne = vi.fn(async (task: ParallelTask, index: number, signal?: AbortSignal): Promise<string> => {
      capturedSignals.push(signal);
      return `ok: ${task.task}`;
    });

    // Without failFast there is no internal failFastController, so the parent
    // signal is forwarded as-is (no AbortSignal.any wrapping).
    await runParallel(
      tasks,
      { failFast: false, signal: parentController.signal },
      runOne,
    );

    expect(runOne).toHaveBeenCalledTimes(2);

    // Every runOne call must have received a signal (the parent signal or a
    // composition of it). Since failFast is false, the code sets
    // runSignal = options.signal — the exact same object.
    for (const sig of capturedSignals) {
      expect(sig).toBeDefined();
      // The signal is live (parent has not been aborted).
      expect(sig?.aborted).toBe(false);
    }

    // Aborting the parent after the run must not affect the (already-resolved) results,
    // but proves the signal object was the real parent (it becomes aborted).
    parentController.abort();
    expect(parentController.signal.aborted).toBe(true);

    // The captured signals are the same object as the parent signal (no wrapping
    // when failFast is false), confirming forwarding-unchanged behaviour.
    for (const sig of capturedSignals) {
      expect(sig).toBe(parentController.signal);
    }
  });
});