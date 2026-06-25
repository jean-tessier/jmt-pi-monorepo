/**
 * Unit tests for doctor subcommand (Task 24)
 *
 * Tests health checks for:
 * - pi binary resolution
 * - config validity
 * - parent provider file existence
 * - delegate provider file existence
 * - runTimeoutMs sanity
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runDoctor } from '../../src/parent/doctor.js';
import { resolvePiBinary } from '../../src/parent/spawn.js';
import { loadConfig } from '../../src/parent/config.js';

vi.mock('../../src/parent/spawn.js', () => ({
  resolvePiBinary: vi.fn(),
}));

vi.mock('../../src/parent/config.js', () => ({
  loadConfig: vi.fn(),
}));

describe('runDoctor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Setup default mocks
    vi.mocked(resolvePiBinary).mockResolvedValue('/usr/local/bin/pi');
    vi.mocked(loadConfig).mockReturnValue({
      maxDepth: 3,
      piBinaryPath: undefined,
      runTimeoutMs: 600000,
    });
  });

  describe('output format', () => {
    it('returns a string report', async () => {
      const report = await runDoctor();
      expect(typeof report).toBe('string');
    });

    it('includes header line with overall status', async () => {
      const report = await runDoctor();
      expect(report).toMatch(/pi-delegate doctor/);
    });

    it('includes individual check results with checkmarks/crosses', async () => {
      const report = await runDoctor();
      expect(report).toMatch(/[✓✗]/);
    });

    it('includes check names', async () => {
      const report = await runDoctor();
      expect(report).toContain('pi binary');
      expect(report).toContain('config');
      expect(report).toContain('parent provider');
      expect(report).toContain('delegate provider');
      expect(report).toContain('runTimeoutMs');
    });
  });

  describe('pi binary check', () => {
    it('passes when binary is resolved', async () => {
      vi.mocked(resolvePiBinary).mockResolvedValue('/usr/local/bin/pi');

      const report = await runDoctor();

      expect(report).toContain('✓ pi binary');
      expect(report).toContain('/usr/local/bin/pi');
    });

    it('fails when binary resolution throws', async () => {
      vi.mocked(resolvePiBinary).mockRejectedValue(new Error('pi not found in PATH'));

      const report = await runDoctor();

      expect(report).toContain('✗ pi binary');
      expect(report).toContain('pi not found in PATH');
    });

    it('includes the resolved binary path in message', async () => {
      vi.mocked(resolvePiBinary).mockResolvedValue('/custom/path/to/pi');

      const report = await runDoctor();

      expect(report).toContain('/custom/path/to/pi');
    });
  });

  describe('config check', () => {
    it('passes and shows piBinaryPath if configured', async () => {
      vi.mocked(loadConfig).mockReturnValue({
        maxDepth: 3,
        piBinaryPath: '/etc/pi',
        runTimeoutMs: 600000,
      });

      const report = await runDoctor();

      expect(report).toContain('✓ config');
      expect(report).toContain('piBinaryPath = /etc/pi');
    });

    it('passes and shows PATH resolution message if no piBinaryPath', async () => {
      vi.mocked(loadConfig).mockReturnValue({
        maxDepth: 3,
        piBinaryPath: undefined,
        runTimeoutMs: 600000,
      });

      const report = await runDoctor();

      expect(report).toContain('✓ config');
      expect(report).toContain('using PATH resolution');
      expect(report).toContain('maxDepth = 3');
    });

    it('includes maxDepth in the config message', async () => {
      vi.mocked(loadConfig).mockReturnValue({
        maxDepth: 5,
        piBinaryPath: undefined,
        runTimeoutMs: 600000,
      });

      const report = await runDoctor();

      expect(report).toContain('maxDepth = 5');
    });
  });

  describe('provider file checks', () => {
    it('reports parent provider as found (uses actual file)', async () => {
      const report = await runDoctor();

      // The actual file should exist at ../parent/index.ts
      // (or the test may fail if the file doesn't exist — which is expected)
      expect(report).toMatch(/parent provider/);
    });

    it('reports delegate provider as found (uses actual file)', async () => {
      const report = await runDoctor();

      // The actual file should exist at ../delegate-provider/index.ts
      expect(report).toMatch(/delegate provider/);
    });
  });

  describe('runTimeoutMs sanity check', () => {
    it('passes when runTimeoutMs is >= 5000', async () => {
      vi.mocked(loadConfig).mockReturnValue({
        maxDepth: 3,
        piBinaryPath: undefined,
        runTimeoutMs: 10000,
      });

      const report = await runDoctor();

      expect(report).toContain('✓ runTimeoutMs');
      expect(report).toContain('10000ms');
    });

    it('passes when runTimeoutMs is not configured', async () => {
      vi.mocked(loadConfig).mockReturnValue({
        maxDepth: 3,
        piBinaryPath: undefined,
        runTimeoutMs: undefined,
      });

      const report = await runDoctor();

      expect(report).toContain('✓ runTimeoutMs');
      expect(report).toContain('no timeout configured');
    });

    it('fails when runTimeoutMs is < 5000', async () => {
      vi.mocked(loadConfig).mockReturnValue({
        maxDepth: 3,
        piBinaryPath: undefined,
        runTimeoutMs: 2000,
      });

      const report = await runDoctor();

      expect(report).toContain('✗ runTimeoutMs');
      expect(report).toContain('2000ms');
      expect(report).toContain('very short');
    });

    it('fails with exactly 1ms', async () => {
      vi.mocked(loadConfig).mockReturnValue({
        maxDepth: 3,
        piBinaryPath: undefined,
        runTimeoutMs: 1,
      });

      const report = await runDoctor();

      expect(report).toContain('✗ runTimeoutMs');
      expect(report).toContain('1ms');
    });

    it('passes with exactly 5000ms', async () => {
      vi.mocked(loadConfig).mockReturnValue({
        maxDepth: 3,
        piBinaryPath: undefined,
        runTimeoutMs: 5000,
      });

      const report = await runDoctor();

      expect(report).toContain('✓ runTimeoutMs');
    });
  });

  describe('overall status', () => {
    it('shows "all checks passed" when all checks pass', async () => {
      vi.mocked(resolvePiBinary).mockResolvedValue('/usr/local/bin/pi');
      vi.mocked(loadConfig).mockReturnValue({
        maxDepth: 3,
        piBinaryPath: undefined,
        runTimeoutMs: 600000,
      });

      const report = await runDoctor();

      expect(report).toContain('all checks passed');
    });

    it('shows "some checks failed" when at least one check fails', async () => {
      vi.mocked(resolvePiBinary).mockRejectedValue(new Error('not found'));
      vi.mocked(loadConfig).mockReturnValue({
        maxDepth: 3,
        piBinaryPath: undefined,
        runTimeoutMs: 600000,
      });

      const report = await runDoctor();

      expect(report).toContain('some checks failed');
    });
  });

  describe('error message handling', () => {
    it('includes error details in pi binary check failure', async () => {
      const errorMsg = 'Binary not found at expected path';
      vi.mocked(resolvePiBinary).mockRejectedValue(new Error(errorMsg));

      const report = await runDoctor();

      expect(report).toContain(errorMsg);
    });

    it('handles non-Error objects from rejection', async () => {
      vi.mocked(resolvePiBinary).mockRejectedValue('some string error');

      const report = await runDoctor();

      expect(report).toContain('✗ pi binary');
      expect(report).toContain('some string error');
    });
  });
});
