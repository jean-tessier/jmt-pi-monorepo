/**
 * Anti-regression tests for pi-delegate extension API compatibility.
 *
 * These tests verify that both extensions (parent and delegate-provider) use
 * the correct ExtensionAPI surface (events, registerTool, registerCommand)
 * and that their activation remains compatible with pi's runtime expectations.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { activate } from '../../src/parent/delegate-tool.js';
import delegateProviderExtension from '../../src/delegate-provider/index.js';
import type { ExtensionAPI, ToolDefinition, BeforeAgentStartEvent, BeforeAgentStartEventResult, ExtensionHandler } from '@earendil-works/pi-coding-agent';

// ── Mock ExtensionAPI ─────────────────────────────────────────────────────────

/**
 * Creates a mock ExtensionAPI that records all registrations and event
 * subscriptions for later assertion.
 *
 * The mock also allows triggering captured event handlers in tests so we
 * can verify handler behavior (e.g., before_agent_start modifies systemPrompt).
 */
function createMockAPI(): {
  api: ExtensionAPI;
  /** Captured tool registrations */
  tools: ToolDefinition<any, any, any>[];
  /** Captured command registrations */
  commands: Array<{ name: string; description: string; handler: Function }>;
  /** Captured event subscriptions: event name → handler */
  eventHandlers: Record<string, ExtensionHandler<any, any>>;
  /** Active tools array (mutable, for getActiveTools) */
  activeTools: string[];
} {
  const tools: ToolDefinition<any, any, any>[] = [];
  const commands: Array<{ name: string; description: string; handler: Function }> = [];
  const eventHandlers: Record<string, ExtensionHandler<any, any>> = {};
  const activeTools: string[] = ['read', 'bash', 'write', 'edit', 'grep', 'find', 'ls'];

  const api: ExtensionAPI = {
    on(event: string, handler: ExtensionHandler<any, any>) {
      eventHandlers[event] = handler;
    },
    registerTool(tool: ToolDefinition<any, any, any>) {
      tools.push(tool);
    },
    registerCommand(name: string, options: any) {
      commands.push({ name, ...options });
    },
    getActiveTools() {
      return activeTools;
    },
    // Stub the remaining ExtensionAPI methods
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

// ── Helper: build a proper BeforeAgentStartEvent ──────────────────────────────

function createBeforeAgentStartEvent(systemPrompt = ''): BeforeAgentStartEvent {
  return {
    type: 'before_agent_start',
    prompt: 'test prompt',
    systemPrompt,
    systemPromptOptions: {
      selectedTools: [],
      toolSnippets: [],
      promptGuidelines: [],
      cwd: '/tmp',
    },
  };
}

// ── Tests: Parent Extension ───────────────────────────────────────────────────

describe('parent extension (delegate-tool)', () => {
  let mock: ReturnType<typeof createMockAPI>;

  beforeEach(() => {
    mock = createMockAPI();
    // Ensure clean env
    delete process.env.PI_DELEGATE_TOKEN;
  });

  afterEach(() => {
    delete process.env.PI_DELEGATE_TOKEN;
  });

  // ── Structural tests (anti-regression for factory shape) ──────────────────

  it('exports activate as a function', () => {
    expect(typeof activate).toBe('function');
  });

  it('activate accepts one argument (ExtensionAPI)', () => {
    expect(activate.length).toBeLessThanOrEqual(1);
  });

  // ── Registration tests (anti-regression for ExtensionAPI surface) ─────────

  it('registers the delegate tool when activated', () => {
    activate(mock.api);
    expect(mock.tools.length).toBe(1);
    expect(mock.tools[0].name).toBe('delegate');
    expect(mock.tools[0].label).toBe('Delegate');
    expect(typeof mock.tools[0].description).toBe('string');
    expect(mock.tools[0].description.length).toBeGreaterThan(0);
  });

  it('registers the delegate tool with TypeBox schema parameters', () => {
    activate(mock.api);
    const tool = mock.tools[0];
    expect(tool.parameters).toBeDefined();
    // TypeBox schemas have a static $id or type property
    expect(typeof tool.parameters).toBe('object');
  });

  it('registers the delegate tool with an execute function', () => {
    activate(mock.api);
    const tool = mock.tools[0];
    expect(typeof tool.execute).toBe('function');
  });

  it('registers the /delegate command when activated', () => {
    activate(mock.api);
    expect(mock.commands.length).toBe(1);
    expect(mock.commands[0].name).toBe('delegate');
    expect(typeof mock.commands[0].description).toBe('string');
    expect(typeof mock.commands[0].handler).toBe('function');
  });

  it('subscribes to before_agent_start event when activated', () => {
    activate(mock.api);
    expect(mock.eventHandlers['before_agent_start']).toBeDefined();
    expect(typeof mock.eventHandlers['before_agent_start']).toBe('function');
  });

  // ── Behavior tests ────────────────────────────────────────────────────────

  it('the before_agent_start handler appends delegate capability note to systemPrompt', async () => {
    activate(mock.api);
    const handler = mock.eventHandlers['before_agent_start'];
    const basePrompt = '# System instructions';
    const event = createBeforeAgentStartEvent(basePrompt);

    const result: BeforeAgentStartEventResult | undefined = await handler(event, {} as any);
    expect(result).toBeDefined();
    expect(result!.systemPrompt).toBeDefined();
    expect(result!.systemPrompt).toContain(basePrompt);
    expect(result!.systemPrompt).toContain('`delegate` tool');
    expect(result!.systemPrompt).toContain('child agents');
  });

  it('the delegate tool execute returns properly shaped result', async () => {
    activate(mock.api);
    const tool = mock.tools[0];

    // Minimal params — just task
    const params = { task: 'test task' };
    const abortController = new AbortController();

    const result = await tool.execute(
      'call-1',
      params,
      abortController.signal,
      undefined,
      {} as any,
    );

    // Tool results must have content array and details
    expect(result).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content[0]).toHaveProperty('type', 'text');
    expect(typeof result.content[0].text).toBe('string');
    expect(result.details).toBeDefined();
  });

  it('registers the tool with promptSnippet and promptGuidelines', () => {
    activate(mock.api);
    const tool = mock.tools[0];
    expect(tool.promptSnippet).toBeDefined();
    expect(typeof tool.promptSnippet).toBe('string');
    expect(tool.promptGuidelines).toBeDefined();
    expect(Array.isArray(tool.promptGuidelines)).toBe(true);
    expect(tool.promptGuidelines!.length).toBeGreaterThan(0);
  });
});

// ── Tests: Delegate-Provider Extension ───────────────────────────────────────

describe('delegate-provider extension', () => {
  let mock: ReturnType<typeof createMockAPI>;

  beforeEach(() => {
    mock = createMockAPI();
  });

  afterEach(() => {
    delete process.env.PI_DELEGATE_TOKEN;
  });

  // ── Structural tests ─────────────────────────────────────────────────────

  it('exports a factory function as default', () => {
    expect(typeof delegateProviderExtension).toBe('function');
    expect(delegateProviderExtension.length).toBeLessThanOrEqual(1);
  });

  // ── Capability gating (anti-regression for §Token gating) ─────────────────

  it('registers tool+command+event when PI_DELEGATE_TOKEN is set', () => {
    process.env.PI_DELEGATE_TOKEN = 'valid-token-123';
    delegateProviderExtension(mock.api);

    // Should forward to parent activate, which registers everything
    expect(mock.tools.length).toBe(1);
    expect(mock.tools[0].name).toBe('delegate');
    expect(mock.commands.length).toBe(1);
    expect(mock.commands[0].name).toBe('delegate');
    expect(mock.eventHandlers['before_agent_start']).toBeDefined();
  });

  it('does NOT register anything when PI_DELEGATE_TOKEN is empty', () => {
    process.env.PI_DELEGATE_TOKEN = '';
    delegateProviderExtension(mock.api);

    expect(mock.tools.length).toBe(0);
    expect(mock.commands.length).toBe(0);
    expect(Object.keys(mock.eventHandlers).length).toBe(0);
  });

  it('does NOT register anything when PI_DELEGATE_TOKEN is unset', () => {
    delete process.env.PI_DELEGATE_TOKEN;
    delegateProviderExtension(mock.api);

    expect(mock.tools.length).toBe(0);
    expect(mock.commands.length).toBe(0);
    expect(Object.keys(mock.eventHandlers).length).toBe(0);
  });

  it('treats whitespace PI_DELEGATE_TOKEN as a valid (truthy) token and registers the extension', () => {
    process.env.PI_DELEGATE_TOKEN = '   ';
    delegateProviderExtension(mock.api);

    // Whitespace is truthy, so the extension activates
    expect(mock.tools.length).toBe(1);
    expect(mock.tools[0].name).toBe('delegate');
    expect(mock.commands.length).toBe(1);
    expect(mock.commands[0].name).toBe('delegate');
  });

  // ── Behavior equivalence with parent ─────────────────────────────────────

  it('when authorized, registered tool has the same shape as parent', () => {
    process.env.PI_DELEGATE_TOKEN = 'valid-token-456';
    delegateProviderExtension(mock.api);

    const tool = mock.tools[0];
    expect(tool.name).toBe('delegate');
    expect(typeof tool.execute).toBe('function');
    expect(typeof tool.description).toBe('string');
    expect(tool.description.length).toBeGreaterThan(0);
  });

  it('when authorized, the before_agent_start handler appends capability note', async () => {
    process.env.PI_DELEGATE_TOKEN = 'valid-token-789';
    delegateProviderExtension(mock.api);

    const handler = mock.eventHandlers['before_agent_start'];
    const event = createBeforeAgentStartEvent('Base prompt');

    const result: BeforeAgentStartEventResult | undefined = await handler(event, {} as any);
    expect(result).toBeDefined();
    expect(result!.systemPrompt).toContain('Base prompt');
    expect(result!.systemPrompt).toContain('`delegate` tool');
  });
});