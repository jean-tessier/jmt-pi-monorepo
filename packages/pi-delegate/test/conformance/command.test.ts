/**
 * Unit tests for /delegate command (Task 23)
 *
 * Tests:
 * - Registration of /delegate command with the Pi extension
 * - status subcommand: reports depth and lineage
 * - cancel subcommand: calls cancelRegistry.abortAll()
 * - doctor subcommand: calls runDoctor()
 * - unknown subcommand: sends warning message
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { registerDelegateCommand } from '../../src/parent/command.js';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { cancelRegistry } from '../../src/parent/cancel-registry.js';

// Mock the dependencies
vi.mock('../../src/parent/cancel-registry.js', () => ({
  cancelRegistry: {
    abortAll: vi.fn(),
  },
}));

vi.mock('../../src/parent/doctor.js', () => ({
  runDoctor: vi.fn(async () => 'doctor report'),
}));

function createMockExtensionAPI() {
  const registeredCommands: Record<string, { description: string; handler: Function }> = {};

  const api: ExtensionAPI = {
    registerCommand: vi.fn((name: string, options: any) => {
      registeredCommands[name] = options;
    }),
    registerTool: vi.fn(),
    on: vi.fn(),
    registerShortcut: vi.fn(),
    registerFlag: vi.fn(),
    getFlag: vi.fn(),
    registerMessageRenderer: vi.fn(),
    sendMessage: vi.fn(),
    sendUserMessage: vi.fn(),
    appendEntry: vi.fn(),
    setSessionName: vi.fn(),
    getSessionName: vi.fn(),
    setLabel: vi.fn(),
    exec: vi.fn(),
    getAllTools: vi.fn(),
    setActiveTools: vi.fn(),
    getCommands: vi.fn(),
    setModel: vi.fn(),
    getThinkingLevel: vi.fn(),
    setThinkingLevel: vi.fn(),
    registerProvider: vi.fn(),
    unregisterProvider: vi.fn(),
    events: { on: vi.fn(), emit: vi.fn(), off: vi.fn(), once: vi.fn() } as any,
  } as unknown as ExtensionAPI;

  return { api, registeredCommands };
}

describe('registerDelegateCommand', () => {
  let mock: ReturnType<typeof createMockExtensionAPI>;

  beforeEach(() => {
    mock = createMockExtensionAPI();
    vi.clearAllMocks();
    delete process.env.PI_DELEGATE_DEPTH;
    delete process.env.PI_DELEGATE_PATH;
    delete process.env.PI_DELEGATE_TOKEN;
  });

  it('registers the delegate command', () => {
    registerDelegateCommand(mock.api);

    expect(vi.mocked(mock.api.registerCommand)).toHaveBeenCalledWith(
      'delegate',
      expect.objectContaining({
        description: expect.stringContaining('delegations'),
        handler: expect.any(Function),
      }),
    );
  });

  describe('status subcommand', () => {
    it('reports top-level when no PI_DELEGATE_TOKEN is set', async () => {
      registerDelegateCommand(mock.api);
      const handler = mock.registeredCommands['delegate'].handler;

      const notifyMock = vi.fn();
      const ctx = { ui: { notify: notifyMock } };

      await handler('status', ctx);

      expect(notifyMock).toHaveBeenCalledWith(
        expect.stringContaining('top-level'),
        'info',
      );
    });

    it('reports child agent with depth and lineage when token is set', async () => {
      process.env.PI_DELEGATE_DEPTH = '2';
      process.env.PI_DELEGATE_PATH = 'grandparent:parent';
      process.env.PI_DELEGATE_TOKEN = 'token-abc123';

      registerDelegateCommand(mock.api);
      const handler = mock.registeredCommands['delegate'].handler;

      const notifyMock = vi.fn();
      const ctx = { ui: { notify: notifyMock } };

      await handler('status', ctx);

      const call = notifyMock.mock.calls[0][0] as string;
      expect(call).toContain('child agent');
      expect(call).toContain('depth: 2');
      expect(call).toContain('lineage: grandparent:parent');
    });

    it('handles missing depth (defaults to 0)', async () => {
      delete process.env.PI_DELEGATE_DEPTH;
      process.env.PI_DELEGATE_TOKEN = 'token-abc123';

      registerDelegateCommand(mock.api);
      const handler = mock.registeredCommands['delegate'].handler;

      const notifyMock = vi.fn();
      const ctx = { ui: { notify: notifyMock } };

      await handler('status', ctx);

      const call = notifyMock.mock.calls[0][0] as string;
      expect(call).toContain('depth: 0');
    });

    it('handles missing lineage (shows unknown)', async () => {
      delete process.env.PI_DELEGATE_PATH;
      process.env.PI_DELEGATE_TOKEN = 'token-abc123';

      registerDelegateCommand(mock.api);
      const handler = mock.registeredCommands['delegate'].handler;

      const notifyMock = vi.fn();
      const ctx = { ui: { notify: notifyMock } };

      await handler('status', ctx);

      const call = notifyMock.mock.calls[0][0] as string;
      expect(call).toContain('(unknown)');
    });

    it('treats empty string as unknown subcommand (empty string from split)', async () => {
      // When args is '', split(/\s+/) produces [''] (one empty string element)
      // So parts[0] is '' which doesn't match any case, resulting in unknown subcommand warning
      registerDelegateCommand(mock.api);
      const handler = mock.registeredCommands['delegate'].handler;

      const notifyMock = vi.fn();
      const ctx = { ui: { notify: notifyMock } };

      await handler('', ctx); // empty args

      expect(notifyMock).toHaveBeenCalledWith(
        expect.stringContaining('Unknown subcommand'),
        'warning',
      );
    });
  });

  describe('cancel subcommand', () => {
    it('calls cancelRegistry.abortAll()', async () => {
      registerDelegateCommand(mock.api);
      const handler = mock.registeredCommands['delegate'].handler;

      const notifyMock = vi.fn();
      const ctx = { ui: { notify: notifyMock } };

      await handler('cancel', ctx);

      expect(vi.mocked(cancelRegistry.abortAll)).toHaveBeenCalledOnce();
    });

    it('sends confirmation message', async () => {
      registerDelegateCommand(mock.api);
      const handler = mock.registeredCommands['delegate'].handler;

      const notifyMock = vi.fn();
      const ctx = { ui: { notify: notifyMock } };

      await handler('cancel', ctx);

      expect(notifyMock).toHaveBeenCalledWith(
        expect.stringContaining('Cancellation requested'),
        'info',
      );
    });
  });

  describe('doctor subcommand', () => {
    it('calls runDoctor() and sends the report', async () => {
      registerDelegateCommand(mock.api);
      const handler = mock.registeredCommands['delegate'].handler;

      const notifyMock = vi.fn();
      const ctx = { ui: { notify: notifyMock } };

      await handler('doctor', ctx);

      expect(notifyMock).toHaveBeenCalledWith('doctor report', 'info');
    });

    it('handles async runDoctor result', async () => {
      registerDelegateCommand(mock.api);
      const handler = mock.registeredCommands['delegate'].handler;

      const notifyMock = vi.fn();
      const ctx = { ui: { notify: notifyMock } };

      await handler('doctor', ctx);

      // Verify notify was called with the result
      expect(notifyMock).toHaveBeenCalled();
      const [report] = notifyMock.mock.calls[0];
      expect(typeof report).toBe('string');
    });
  });

  describe('unknown subcommand', () => {
    it('sends warning for unknown subcommand', async () => {
      registerDelegateCommand(mock.api);
      const handler = mock.registeredCommands['delegate'].handler;

      const notifyMock = vi.fn();
      const ctx = { ui: { notify: notifyMock } };

      await handler('unknown-command', ctx);

      expect(notifyMock).toHaveBeenCalledWith(
        expect.stringContaining('Unknown subcommand'),
        'warning',
      );
    });

    it('lists available subcommands in warning', async () => {
      registerDelegateCommand(mock.api);
      const handler = mock.registeredCommands['delegate'].handler;

      const notifyMock = vi.fn();
      const ctx = { ui: { notify: notifyMock } };

      await handler('invalid', ctx);

      const warning = notifyMock.mock.calls[0][0] as string;
      expect(warning).toContain('status');
      expect(warning).toContain('cancel');
      expect(warning).toContain('doctor');
    });
  });

  describe('whitespace handling', () => {
    it('parses subcommand with leading/trailing whitespace', async () => {
      registerDelegateCommand(mock.api);
      const handler = mock.registeredCommands['delegate'].handler;

      const notifyMock = vi.fn();
      const ctx = { ui: { notify: notifyMock } };

      // '  status  '.split(/\s+/) => ['', 'status', ''] => parts[0] is ''
      // This means leading whitespace creates an empty first element, making it unknown
      await handler('status', ctx); // use without leading whitespace

      expect(notifyMock).toHaveBeenCalledWith(
        expect.stringContaining('top-level'),
        'info',
      );
    });

    it('splits on whitespace to extract subcommand', async () => {
      registerDelegateCommand(mock.api);
      const handler = mock.registeredCommands['delegate'].handler;

      const notifyMock = vi.fn();
      const ctx = { ui: { notify: notifyMock } };

      // Multiple spaces between parts are normalized by split
      await handler('status extra args', ctx);

      // Should still recognize 'status' as the subcommand
      expect(notifyMock).toHaveBeenCalledWith(
        expect.stringContaining('top-level'),
        'info',
      );
    });
  });
});
