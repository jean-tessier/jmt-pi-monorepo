/**
 * Conformance tests for the spawn layer (T3.1 — regression net for Theme-A fixes).
 *
 * Two distinct concerns are covered here:
 *
 *   1. buildSpawnArgs — the REAL builder (NOT mocked). This is a pure function
 *      with no spawn side-effects, so we exercise it directly to lock down the
 *      child argv order (G1/D1) and the env map (G1). To keep buildSpawnArgs real
 *      while still mocking the spawn boundary for the executeSingle tests below,
 *      the vi.mock factory spreads vi.importActual and overrides ONLY the
 *      side-effecting exports (resolvePiBinary / spawnRun / generateCapabilityToken).
 *
 *   2. executeSingle contract — driven through the registered `delegate` tool with
 *      the spawn boundary mocked (AGENTS.md: "mock at the spawn boundary"). These
 *      assert the corrected never-throw mappings: TIMEOUT (A1), ERROR on non-zero
 *      exit (A3), SPAWN_FAILED on missing binary (A2/A4), and a labeled string on
 *      a malformed PI_DELEGATE_AGENTS env (A2).
 *
 * INTEGRATION NOTE (T4.1): the assertions below describe the CORRECTED (post-T2.1)
 * contract — TIMEOUT (A1), ERROR on non-zero exit (A3), SPAWN_FAILED on a missing
 * binary (A2/A4), a labeled string on a malformed PI_DELEGATE_AGENTS env (A2), and
 * the removal of the --output-file flag (D2/X5). These were previously marked
 * `it.fails(...)` while T2.1 was unmerged; now that T2.1 has landed they are plain,
 * live regression assertions and must PASS.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { buildSpawnArgs } from '../../src/parent/spawn.js';
import type { SpawnContext } from '../../src/parent/spawn.js';
import type { ResolvedParams } from '../../src/parent/resolve.js';
import { activate } from '../../src/parent/delegate-tool.js';
import { resolvePiBinary, spawnRun } from '../../src/parent/spawn.js';
import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent';

// Mock ONLY the side-effecting spawn-boundary exports; keep buildSpawnArgs (a pure
// arg/env builder) and mapExitCode real by spreading the actual module.
vi.mock('../../src/parent/spawn.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/parent/spawn.js')>(
    '../../src/parent/spawn.js',
  );
  return {
    ...actual,
    resolvePiBinary: vi.fn().mockResolvedValue('/mock/pi'),
    spawnRun: vi.fn().mockResolvedValue({ output: 'mock output', exitCode: 0, timedOut: false }),
    generateCapabilityToken: vi.fn().mockReturnValue('mock-capability-token'),
  };
});

// ── Mock ExtensionAPI ─────────────────────────────────────────────────────────

function createMockAPI(): {
  api: ExtensionAPI;
  tools: ToolDefinition<any, any, any>[];
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

  return { api, tools, activeTools };
}

/** Drive the registered delegate tool's execute() and return the text result. */
async function runDelegate(
  mock: ReturnType<typeof createMockAPI>,
  params: Record<string, unknown>,
): Promise<string> {
  activate(mock.api);
  const tool = mock.tools[0];
  const res = await tool.execute('call-spawn-test', params, undefined, undefined, {} as any);
  return (res as { content: Array<{ type: string; text: string }> }).content[0].text;
}

// ── Fixtures for buildSpawnArgs ───────────────────────────────────────────────

const RESOLVED: ResolvedParams = {
  model: 'google/gemini-2.5-flash-001',
  tools: ['read', 'bash'],
  systemPrompt: 'you are helpful',
  promptMode: 'replace',
  outputSchema: undefined,
};

function makeContext(overrides: Partial<SpawnContext> = {}): SpawnContext {
  return {
    taskId: 'task-abc',
    depth: 0,
    maxDepth: 2,
    lineagePath: 'root>parent',
    promptFile: '/tmp/pi-delegate/task-abc/prompt.md',
    task: 'do the thing',
    promptMode: 'replace',
    delegateToken: 'tok-123',
    extensionPaths: ['/ext/so.ts', '/ext/delegate.ts'],
    ...overrides,
  };
}

// ── G1/D1: buildSpawnArgs argv order (REAL builder) ───────────────────────────

describe('buildSpawnArgs argv order (G1/D1)', () => {
  it('emits --mode json first', () => {
    const { argv } = buildSpawnArgs(RESOLVED, makeContext());
    expect(argv[0]).toBe('--mode');
    expect(argv[1]).toBe('json');
  });

  it('places --model <model> immediately after --mode json', () => {
    const { argv } = buildSpawnArgs(RESOLVED, makeContext());
    const modelIdx = argv.indexOf('--model');
    expect(modelIdx).toBe(2);
    expect(argv[modelIdx + 1]).toBe('google/gemini-2.5-flash-001');
  });

  it('places --tools <t1,t2> after --model', () => {
    const { argv } = buildSpawnArgs(RESOLVED, makeContext());
    const toolsIdx = argv.indexOf('--tools');
    const modelIdx = argv.indexOf('--model');
    expect(toolsIdx).toBeGreaterThan(modelIdx);
    expect(argv[toolsIdx + 1]).toBe('read,bash');
  });

  it('uses --system-prompt + prompt file in replace mode (after --tools)', () => {
    const { argv } = buildSpawnArgs(RESOLVED, makeContext({ promptMode: 'replace' }));
    const spIdx = argv.indexOf('--system-prompt');
    expect(spIdx).toBeGreaterThan(argv.indexOf('--tools'));
    expect(argv[spIdx + 1]).toBe('/tmp/pi-delegate/task-abc/prompt.md');
    expect(argv).not.toContain('--append-system-prompt');
  });

  it('uses --append-system-prompt in append mode', () => {
    const { argv } = buildSpawnArgs(RESOLVED, makeContext({ promptMode: 'append' }));
    expect(argv).toContain('--append-system-prompt');
    expect(argv).not.toContain('--system-prompt');
  });

  it('emits --no-skills --no-context-files --no-session --no-extensions in order after the prompt flag', () => {
    const { argv } = buildSpawnArgs(RESOLVED, makeContext());
    const skills = argv.indexOf('--no-skills');
    const ctxFiles = argv.indexOf('--no-context-files');
    const session = argv.indexOf('--no-session');
    const noExt = argv.indexOf('--no-extensions');
    const promptFlag = argv.indexOf('--system-prompt');
    expect(skills).toBeGreaterThan(promptFlag);
    expect(ctxFiles).toBe(skills + 1);
    expect(session).toBe(ctxFiles + 1);
    // --no-extensions is the baseline before any -e providers
    expect(noExt).toBeGreaterThan(session);
  });

  it('emits one -e per provider path, after --no-extensions', () => {
    const { argv } = buildSpawnArgs(
      RESOLVED,
      makeContext({ extensionPaths: ['/ext/a.ts', '/ext/b.ts'] }),
    );
    const noExt = argv.indexOf('--no-extensions');
    // collect every (-e, path) pair
    const ePairs: string[] = [];
    for (let i = 0; i < argv.length - 1; i++) {
      if (argv[i] === '-e') ePairs.push(argv[i + 1]);
    }
    expect(ePairs).toEqual(['/ext/a.ts', '/ext/b.ts']);
    // every -e flag comes after the --no-extensions baseline
    argv.forEach((tok, i) => {
      if (tok === '-e') expect(i).toBeGreaterThan(noExt);
    });
    // plural --extensions must NOT be used (AGENTS.md: use -e singular)
    expect(argv).not.toContain('--extensions');
  });

  it('passes the task string as the LAST positional element', () => {
    const { argv } = buildSpawnArgs(RESOLVED, makeContext({ task: 'FINAL-TASK-STRING' }));
    expect(argv[argv.length - 1]).toBe('FINAL-TASK-STRING');
  });

  it('omits --model and --tools when not provided', () => {
    const minimal: ResolvedParams = {
      tools: [],
      promptMode: 'replace',
    };
    const { argv } = buildSpawnArgs(minimal, makeContext());
    expect(argv).not.toContain('--model');
    expect(argv).not.toContain('--tools');
    // task is still last
    expect(argv[argv.length - 1]).toBe('do the thing');
  });

  // D2/X5: --output-file is NOT a real pi flag and must NOT appear in argv. T2.1
  // removed it; buildSpawnArgs no longer pushes it even when outputFile is set —
  // structured output is passed via the PI_OUTPUT_FILE env var instead. Live
  // regression assertion now that T2.1 has landed.
  it('does NOT emit --output-file even when outputFile is set (D2/X5)', () => {
    const { argv } = buildSpawnArgs(
      RESOLVED,
      makeContext({ outputFile: '/tmp/pi-delegate/task-abc/output.json' }),
    );
    expect(argv).not.toContain('--output-file');
  });
});

// ── G1: buildSpawnArgs env map (REAL builder) ─────────────────────────────────

describe('buildSpawnArgs env map (G1)', () => {
  it('sets PI_DELEGATE_DEPTH to child depth (parent depth + 1)', () => {
    const { env } = buildSpawnArgs(RESOLVED, makeContext({ depth: 1 }));
    expect(env.PI_DELEGATE_DEPTH).toBe('2');
  });

  it('threads PI_DELEGATE_MAX_DEPTH from context.maxDepth', () => {
    const { env } = buildSpawnArgs(RESOLVED, makeContext({ maxDepth: 3 }));
    expect(env.PI_DELEGATE_MAX_DEPTH).toBe('3');
  });

  it('sets PI_DELEGATE_PATH (lineage) and PI_DELEGATE_TASK_ID', () => {
    const { env } = buildSpawnArgs(
      RESOLVED,
      makeContext({ lineagePath: 'root>a>b', taskId: 'tid-xyz' }),
    );
    expect(env.PI_DELEGATE_PATH).toBe('root>a>b');
    expect(env.PI_DELEGATE_TASK_ID).toBe('tid-xyz');
  });

  it('sets PI_DELEGATE_TOKEN from the capability token', () => {
    const { env } = buildSpawnArgs(RESOLVED, makeContext({ delegateToken: 'super-secret' }));
    expect(env.PI_DELEGATE_TOKEN).toBe('super-secret');
  });

  it('sets PI_OUTPUT_FILE to the output.json path when an outputFile is supplied', () => {
    const outPath = '/tmp/pi-delegate/task-abc/output.json';
    const { env } = buildSpawnArgs(RESOLVED, makeContext({ outputFile: outPath }));
    expect(env.PI_OUTPUT_FILE).toBe(outPath);
  });

  it('sets PI_OUTPUT_SCHEMA to the schema.json path when a schemaFile is supplied', () => {
    const schemaPath = '/tmp/pi-delegate/task-abc/schema.json';
    const { env } = buildSpawnArgs(RESOLVED, makeContext({ schemaFile: schemaPath }));
    expect(env.PI_OUTPUT_SCHEMA).toBe(schemaPath);
  });

  it('defaults PI_OUTPUT_FILE / PI_OUTPUT_SCHEMA to empty strings when absent', () => {
    const { env } = buildSpawnArgs(RESOLVED, makeContext());
    expect(env.PI_OUTPUT_FILE).toBe('');
    expect(env.PI_OUTPUT_SCHEMA).toBe('');
  });

  it('serializes PI_DELEGATE_AGENTS allowlist as JSON, empty string when absent', () => {
    const withAllow = buildSpawnArgs(
      RESOLVED,
      makeContext({ delegateAgents: ['alpha', 'beta'] }),
    ).env;
    expect(withAllow.PI_DELEGATE_AGENTS).toBe(JSON.stringify(['alpha', 'beta']));

    const without = buildSpawnArgs(RESOLVED, makeContext()).env;
    expect(without.PI_DELEGATE_AGENTS).toBe('');
  });

  it('includes all 8 PI_DELEGATE_*/PI_OUTPUT_* keys', () => {
    const { env } = buildSpawnArgs(RESOLVED, makeContext());
    for (const key of [
      'PI_DELEGATE_DEPTH',
      'PI_DELEGATE_MAX_DEPTH',
      'PI_DELEGATE_PATH',
      'PI_DELEGATE_TASK_ID',
      'PI_DELEGATE_TOKEN',
      'PI_OUTPUT_SCHEMA',
      'PI_OUTPUT_FILE',
      'PI_DELEGATE_AGENTS',
    ]) {
      expect(key in env).toBe(true);
    }
  });
});

// ── executeSingle never-throw contract (spawn boundary mocked) ────────────────

describe('executeSingle never-throw contract', () => {
  let mock: ReturnType<typeof createMockAPI>;
  let savedAgentsEnv: string | undefined;

  beforeEach(() => {
    mock = createMockAPI();
    savedAgentsEnv = process.env.PI_DELEGATE_AGENTS;
    delete process.env.PI_DELEGATE_AGENTS;
    delete process.env.PI_DELEGATE_TOKEN;
    delete process.env.PI_DELEGATE_PATH;
    vi.mocked(spawnRun).mockReset();
    vi.mocked(resolvePiBinary).mockReset();
    vi.mocked(resolvePiBinary).mockResolvedValue('/mock/pi');
  });

  afterEach(() => {
    if (savedAgentsEnv !== undefined) process.env.PI_DELEGATE_AGENTS = savedAgentsEnv;
    else delete process.env.PI_DELEGATE_AGENTS;
  });

  // A1: a timed-out child resolves { timedOut: true } and maps to [BLOCKED:TIMEOUT].
  // This is provable through the mock layer today (executeSingle already inspects
  // runResult.timedOut), so it passes now and stays a live regression assertion.
  it('maps a timed-out run to [BLOCKED:TIMEOUT] (A1)', async () => {
    vi.mocked(spawnRun).mockResolvedValue({ output: '', exitCode: -1, timedOut: true });
    const out = await runDelegate(mock, { task: 'slow task' });
    expect(out.startsWith('[BLOCKED:TIMEOUT]')).toBe(true);
    expect(out).toContain('from agent "default"');
  });

  // A3: a non-zero child exit must surface as [BLOCKED:ERROR], not a success label.
  // T2.1 added the mapExitCode gate in executeSingle, so a non-zero exit now yields
  // a blocked string with a stderr summary. Live regression assertion (T2.1 landed).
  it('maps a non-zero exit code to [BLOCKED:ERROR] (A3)', async () => {
    vi.mocked(spawnRun).mockResolvedValue({
      output: 'partial output',
      exitCode: 1,
      timedOut: false,
      stderr: 'boom: something failed',
    } as any);
    const out = await runDelegate(mock, { task: 'failing task' });
    expect(out.startsWith('[BLOCKED:ERROR]')).toBe(true);
  });

  // A2/A4: a missing binary (resolvePiBinary rejects) must surface as
  // [BLOCKED:SPAWN_FAILED] and never escape as a throw. T2.1 wraps resolvePiBinary
  // in a try/catch inside executeSingle and maps the failure to SPAWN_FAILED, so the
  // call resolves a labeled string instead of rejecting. Live assertion (T2.1 landed).
  it('maps a missing binary to [BLOCKED:SPAWN_FAILED] without throwing (A2/A4)', async () => {
    vi.mocked(resolvePiBinary).mockRejectedValue(new Error('pi binary not found in PATH'));
    const out = await runDelegate(mock, { task: 'task needing binary' });
    expect(out.startsWith('[BLOCKED:SPAWN_FAILED]')).toBe(true);
  });

  // A2: a malformed PI_DELEGATE_AGENTS env must be caught and returned as a labeled
  // blocked string, never thrown. T2.1 moved the JSON.parse under the never-throw
  // guard, so executeSingle resolves a labeled blocked string. Live assertion now.
  it('returns a labeled blocked string on malformed PI_DELEGATE_AGENTS env (A2)', async () => {
    process.env.PI_DELEGATE_AGENTS = 'not-valid-json';
    const out = await runDelegate(mock, { task: 'task with bad env' });
    expect(out.startsWith('[BLOCKED:')).toBe(true);
  });
});

// ── spawn-pool semaphore (B4/C4) ──────────────────────────────────────────────
//
// The canonical process-wide spawn pool (T2.2) exposes a class-based API:
// configureSpawnPool / withSpawnSlot / Semaphore. spawnRun no longer acquires a
// slot itself — the slot is acquired exactly once per child by the caller
// (single mode: delegate-tool.ts execute(); parallel mode: parallel.ts). Here we
// exercise the module directly to confirm it is wired and behaves: no cap is a
// passthrough, and a configured cap bounds the global in-flight count FIFO.

describe('spawn-pool semaphore (B4/C4)', () => {
  it('is a passthrough when uncapped, and bounds in-flight count when capped', async () => {
    const {
      configureSpawnPool,
      withSpawnSlot,
      getConfiguredSpawnCap,
      __resetSpawnPoolForTests,
    } = await import('../../src/parent/spawn-pool.js');

    __resetSpawnPoolForTests();

    // Uncapped: no cap configured → straight passthrough, all run at once.
    expect(getConfiguredSpawnCap()).toBeUndefined();
    let current = 0;
    let observedMax = 0;
    const uncappedTask = async (): Promise<string> => {
      current++;
      observedMax = Math.max(observedMax, current);
      await new Promise((r) => setTimeout(r, 5));
      current--;
      return 'ok';
    };
    await Promise.all(Array.from({ length: 4 }, () => withSpawnSlot(uncappedTask)));
    expect(observedMax).toBe(4);

    // Capped at 1: only one slot at a time, queued FIFO.
    __resetSpawnPoolForTests();
    configureSpawnPool(1);
    expect(getConfiguredSpawnCap()).toBe(1);

    let releaseFirst!: () => void;
    const gate = new Promise<void>((r) => { releaseFirst = r; });

    let secondRan = false;
    const held = withSpawnSlot(async () => { await gate; return 'held'; });
    const queued = withSpawnSlot(async () => { secondRan = true; return 'queued'; });

    // The single slot is held; the second call must still be blocked.
    await Promise.resolve();
    expect(secondRan).toBe(false);

    // Release the held slot; the queued waiter now acquires and runs.
    releaseFirst();
    await Promise.all([held, queued]);
    expect(secondRan).toBe(true);

    __resetSpawnPoolForTests();
  });
});
