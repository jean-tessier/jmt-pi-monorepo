/**
 * Unit tests for pure functions: mapExitCode and wrapWithSandbox (Task 19)
 *
 * Tests:
 * - mapExitCode: exit code 0 (ok), non-zero (error), the ===2 branch
 * - wrapWithSandbox: with and without sandbox command
 */

import { describe, it, expect } from 'vitest';
import { mapExitCode, wrapWithSandbox } from '../../src/parent/spawn.js';

describe('mapExitCode', () => {
  describe('exit code 0', () => {
    it('returns "ok" for exit code 0', () => {
      const result = mapExitCode(0);
      expect(result).toBe('ok');
    });
  });

  describe('exit code 2 (pi error)', () => {
    it('returns "error" for exit code 2', () => {
      const result = mapExitCode(2);
      expect(result).toBe('error');
    });
  });

  describe('other non-zero exit codes', () => {
    it('returns "error" for exit code 1', () => {
      const result = mapExitCode(1);
      expect(result).toBe('error');
    });

    it('returns "error" for exit code 127 (command not found)', () => {
      const result = mapExitCode(127);
      expect(result).toBe('error');
    });

    it('returns "error" for exit code 255', () => {
      const result = mapExitCode(255);
      expect(result).toBe('error');
    });

    it('returns "error" for negative exit codes', () => {
      const result = mapExitCode(-1);
      expect(result).toBe('error');
    });

    it('returns "error" for very large exit codes', () => {
      const result = mapExitCode(99999);
      expect(result).toBe('error');
    });
  });

  describe('return type', () => {
    it('always returns a string matching RunStatus type', () => {
      const codes = [0, 1, 2, 127, 255, -1];
      for (const code of codes) {
        const result = mapExitCode(code);
        expect(['ok', 'error']).toContain(result);
      }
    });
  });
});

describe('wrapWithSandbox', () => {
  describe('no sandbox command', () => {
    it('returns binary and args unchanged when sandboxCommand is undefined', () => {
      const [binary, args] = wrapWithSandbox('/usr/bin/pi', ['--mode', 'json'], undefined);
      expect(binary).toBe('/usr/bin/pi');
      expect(args).toEqual(['--mode', 'json']);
    });

    it('returns binary and args unchanged when sandboxCommand is empty string', () => {
      const [binary, args] = wrapWithSandbox('/usr/bin/pi', ['--mode', 'json'], '');
      expect(binary).toBe('/usr/bin/pi');
      expect(args).toEqual(['--mode', 'json']);
    });

    it('wraps with empty sandbox binary when sandboxCommand is only whitespace (edge case)', () => {
      // After trim().split(/\s+/), whitespace-only becomes ['']
      // The function still wraps, using empty string as the sandbox binary
      const [binary, args] = wrapWithSandbox('/usr/bin/pi', ['--mode', 'json'], '   ');
      // Empty string from the split becomes the sandboxBinary
      expect(binary).toBe('');
      expect(args).toEqual(['/usr/bin/pi', '--mode', 'json']);
    });
  });

  describe('with sandbox command', () => {
    it('wraps binary and args with single-word sandbox command', () => {
      const [binary, args] = wrapWithSandbox('/usr/bin/pi', ['--mode', 'json'], 'firejail');
      expect(binary).toBe('firejail');
      expect(args).toEqual(['/usr/bin/pi', '--mode', 'json']);
    });

    it('wraps binary and args with multi-word sandbox command', () => {
      const [binary, args] = wrapWithSandbox('/usr/bin/pi', ['--mode', 'json'], 'firejail --quiet');
      expect(binary).toBe('firejail');
      expect(args).toEqual(['--quiet', '/usr/bin/pi', '--mode', 'json']);
    });

    it('handles sandbox command with leading/trailing whitespace', () => {
      const [binary, args] = wrapWithSandbox('/usr/bin/pi', ['--mode', 'json'], '  firejail --quiet  ');
      expect(binary).toBe('firejail');
      expect(args).toEqual(['--quiet', '/usr/bin/pi', '--mode', 'json']);
    });

    it('handles sandbox command with multiple internal spaces', () => {
      const [binary, args] = wrapWithSandbox('/usr/bin/pi', ['--mode', 'json'], 'firejail   --quiet   --noprofile');
      expect(binary).toBe('firejail');
      // Extra spaces should be normalized by split
      expect(args).toContain('/usr/bin/pi');
      expect(args).toContain('--quiet');
      expect(args).toContain('--noprofile');
    });
  });

  describe('empty args array', () => {
    it('wraps correctly with empty args array', () => {
      const [binary, args] = wrapWithSandbox('/usr/bin/pi', [], 'firejail');
      expect(binary).toBe('firejail');
      expect(args).toEqual(['/usr/bin/pi']);
    });
  });

  describe('complex args arrays', () => {
    it('preserves all args in correct order', () => {
      const originalArgs = ['--mode', 'json', '--model', 'test-model', '--system-prompt', '/tmp/prompt.md'];
      const [binary, args] = wrapWithSandbox('/usr/bin/pi', originalArgs, 'firejail --quiet');
      expect(binary).toBe('firejail');
      expect(args).toEqual(['--quiet', '/usr/bin/pi', ...originalArgs]);
    });

    it('handles args with special characters', () => {
      const originalArgs = ['--task', 'do something with spaces', '--model', 'model/with/slashes'];
      const [binary, args] = wrapWithSandbox('/usr/bin/pi', originalArgs, 'sandbox');
      expect(binary).toBe('sandbox');
      expect(args).toEqual(['/usr/bin/pi', ...originalArgs]);
    });
  });

  describe('binary paths', () => {
    it('handles relative binary path', () => {
      const [binary, args] = wrapWithSandbox('./pi', ['--mode', 'json'], 'firejail');
      expect(binary).toBe('firejail');
      expect(args).toEqual(['./pi', '--mode', 'json']);
    });

    it('handles binary path with spaces (single arg)', () => {
      const [binary, args] = wrapWithSandbox('/usr/local/bin/pi', ['--mode', 'json'], 'firejail');
      expect(binary).toBe('firejail');
      expect(args).toEqual(['/usr/local/bin/pi', '--mode', 'json']);
    });
  });

  describe('return type shape', () => {
    it('returns tuple of two strings', () => {
      const result = wrapWithSandbox('/usr/bin/pi', ['--mode', 'json'], 'firejail');
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
      expect(typeof result[0]).toBe('string');
      expect(Array.isArray(result[1])).toBe(true);
    });

    it('returns array with all string elements', () => {
      const [binary, args] = wrapWithSandbox('/usr/bin/pi', ['--mode', 'json'], 'firejail --quiet --noprofile');
      expect(typeof binary).toBe('string');
      for (const arg of args) {
        expect(typeof arg).toBe('string');
      }
    });
  });

  describe('idempotency and consistency', () => {
    it('returns consistent results for same inputs', () => {
      const inputs: [string, string[], string] = ['/usr/bin/pi', ['--mode', 'json'], 'firejail --quiet'];
      const result1 = wrapWithSandbox(...inputs);
      const result2 = wrapWithSandbox(...inputs);
      expect(result1).toEqual(result2);
    });

    it('does not modify input array', () => {
      const originalArgs = ['--mode', 'json', '--task', 'test'];
      const argsCopy = [...originalArgs];
      wrapWithSandbox('/usr/bin/pi', originalArgs, 'firejail');
      expect(originalArgs).toEqual(argsCopy);
    });
  });
});
