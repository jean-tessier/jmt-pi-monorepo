/**
 * Conformance tests for config.ts (finding G3 — 0% covered, CRITICAL/HIGH)
 *
 * Covers:
 *   - Default values when no env vars or config file set
 *   - PI_DELEGATE_MAX_DEPTH env override (valid number, malformed → uses default)
 *   - PI_DELEGATE_RUN_TIMEOUT_MS env override (valid, malformed → default)
 *   - PI_DELEGATE_BINARY_PATH env override
 *   - PI_DELEGATE_CHILD_CWD env override
 *   - Invalid JSON config file → silently treated as empty (defaults apply)
 *   - Config file location precedence:
 *       PI_DELEGATE_CONFIG_PATH → $PI_CONFIG_DIR/pi-delegate/config.json
 *         → ~/.config/pi/pi-delegate/config.json
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../../src/parent/config.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Snapshot and clear ALL env vars touched by loadConfig */
function snapshotEnv() {
  return {
    PI_DELEGATE_CONFIG_PATH: process.env.PI_DELEGATE_CONFIG_PATH,
    PI_CONFIG_DIR: process.env.PI_CONFIG_DIR,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    PI_DELEGATE_MAX_DEPTH: process.env.PI_DELEGATE_MAX_DEPTH,
    PI_DELEGATE_BINARY_PATH: process.env.PI_DELEGATE_BINARY_PATH,
    PI_DELEGATE_RUN_TIMEOUT_MS: process.env.PI_DELEGATE_RUN_TIMEOUT_MS,
    PI_DELEGATE_CHILD_CWD: process.env.PI_DELEGATE_CHILD_CWD,
  };
}

function restoreEnv(snapshot: ReturnType<typeof snapshotEnv>) {
  const keys = Object.keys(snapshot) as Array<keyof typeof snapshot>;
  for (const key of keys) {
    if (snapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = snapshot[key] as string;
    }
  }
}

/** Create a temp dir and write a config.json file with the given content */
function makeTempConfig(content: string): { dir: string; filePath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-delegate-config-test-'));
  const filePath = path.join(dir, 'config.json');
  fs.writeFileSync(filePath, content, 'utf-8');
  return { dir, filePath };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('loadConfig — defaults', () => {
  let snapshot: ReturnType<typeof snapshotEnv>;

  beforeEach(() => {
    snapshot = snapshotEnv();
    // Point to a non-existent file so no config file is loaded
    process.env.PI_DELEGATE_CONFIG_PATH = '/nonexistent-config-path-for-test-defaults';
    delete process.env.PI_DELEGATE_MAX_DEPTH;
    delete process.env.PI_DELEGATE_BINARY_PATH;
    delete process.env.PI_DELEGATE_RUN_TIMEOUT_MS;
    delete process.env.PI_DELEGATE_CHILD_CWD;
  });

  afterEach(() => restoreEnv(snapshot));

  it('returns maxDepth of 2 by default', () => {
    const config = loadConfig();
    expect(config.maxDepth).toBe(2);
  });

  it('returns runTimeoutMs of 600_000 by default', () => {
    const config = loadConfig();
    expect(config.runTimeoutMs).toBe(600_000);
  });

  it('returns piBinaryPath as undefined by default', () => {
    const config = loadConfig();
    expect(config.piBinaryPath).toBeUndefined();
  });

  it('returns childCwd as undefined by default', () => {
    const config = loadConfig();
    expect(config.childCwd).toBeUndefined();
  });
});

describe('loadConfig — PI_DELEGATE_MAX_DEPTH env override', () => {
  let snapshot: ReturnType<typeof snapshotEnv>;

  beforeEach(() => {
    snapshot = snapshotEnv();
    process.env.PI_DELEGATE_CONFIG_PATH = '/nonexistent-config-path-for-test-defaults';
    delete process.env.PI_DELEGATE_MAX_DEPTH;
  });

  afterEach(() => restoreEnv(snapshot));

  it('overrides maxDepth when env var is a valid positive integer', () => {
    process.env.PI_DELEGATE_MAX_DEPTH = '5';
    const config = loadConfig();
    expect(config.maxDepth).toBe(5);
  });

  it('uses default when PI_DELEGATE_MAX_DEPTH is non-numeric string', () => {
    process.env.PI_DELEGATE_MAX_DEPTH = 'abc';
    const config = loadConfig();
    expect(config.maxDepth).toBe(2);
  });

  it('uses default when PI_DELEGATE_MAX_DEPTH is 0', () => {
    process.env.PI_DELEGATE_MAX_DEPTH = '0';
    const config = loadConfig();
    expect(config.maxDepth).toBe(2);
  });

  it('uses default when PI_DELEGATE_MAX_DEPTH is negative', () => {
    process.env.PI_DELEGATE_MAX_DEPTH = '-3';
    const config = loadConfig();
    expect(config.maxDepth).toBe(2);
  });

  it('uses default when PI_DELEGATE_MAX_DEPTH is float-only string', () => {
    // parseInt('3.7') === 3 which is > 0, so this actually IS accepted
    // Documenting actual behavior: parseInt truncates to integer
    process.env.PI_DELEGATE_MAX_DEPTH = '3.7';
    const config = loadConfig();
    // parseInt('3.7') = 3, which is > 0 → accepted as 3
    expect(config.maxDepth).toBe(3);
  });
});

describe('loadConfig — PI_DELEGATE_RUN_TIMEOUT_MS env override', () => {
  let snapshot: ReturnType<typeof snapshotEnv>;

  beforeEach(() => {
    snapshot = snapshotEnv();
    process.env.PI_DELEGATE_CONFIG_PATH = '/nonexistent-config-path-for-test-defaults';
    delete process.env.PI_DELEGATE_RUN_TIMEOUT_MS;
  });

  afterEach(() => restoreEnv(snapshot));

  it('overrides runTimeoutMs when env var is a valid positive integer', () => {
    process.env.PI_DELEGATE_RUN_TIMEOUT_MS = '30000';
    const config = loadConfig();
    expect(config.runTimeoutMs).toBe(30000);
  });

  it('uses default when PI_DELEGATE_RUN_TIMEOUT_MS is malformed', () => {
    process.env.PI_DELEGATE_RUN_TIMEOUT_MS = 'not-a-number';
    const config = loadConfig();
    expect(config.runTimeoutMs).toBe(600_000);
  });

  it('uses default when PI_DELEGATE_RUN_TIMEOUT_MS is 0', () => {
    process.env.PI_DELEGATE_RUN_TIMEOUT_MS = '0';
    const config = loadConfig();
    expect(config.runTimeoutMs).toBe(600_000);
  });

  it('uses default when PI_DELEGATE_RUN_TIMEOUT_MS is negative', () => {
    process.env.PI_DELEGATE_RUN_TIMEOUT_MS = '-1000';
    const config = loadConfig();
    expect(config.runTimeoutMs).toBe(600_000);
  });
});

describe('loadConfig — PI_DELEGATE_BINARY_PATH env override', () => {
  let snapshot: ReturnType<typeof snapshotEnv>;

  beforeEach(() => {
    snapshot = snapshotEnv();
    process.env.PI_DELEGATE_CONFIG_PATH = '/nonexistent-config-path-for-test-defaults';
    delete process.env.PI_DELEGATE_BINARY_PATH;
  });

  afterEach(() => restoreEnv(snapshot));

  it('sets piBinaryPath from env var', () => {
    process.env.PI_DELEGATE_BINARY_PATH = '/usr/local/bin/pi';
    const config = loadConfig();
    expect(config.piBinaryPath).toBe('/usr/local/bin/pi');
  });

  it('env var takes precedence over config file value', () => {
    const { filePath } = makeTempConfig(JSON.stringify({ piBinaryPath: '/from/file/pi' }));
    process.env.PI_DELEGATE_CONFIG_PATH = filePath;
    process.env.PI_DELEGATE_BINARY_PATH = '/from/env/pi';
    const config = loadConfig();
    expect(config.piBinaryPath).toBe('/from/env/pi');
    fs.unlinkSync(filePath);
  });
});

describe('loadConfig — PI_DELEGATE_CHILD_CWD env override', () => {
  let snapshot: ReturnType<typeof snapshotEnv>;

  beforeEach(() => {
    snapshot = snapshotEnv();
    process.env.PI_DELEGATE_CONFIG_PATH = '/nonexistent-config-path-for-test-defaults';
    delete process.env.PI_DELEGATE_CHILD_CWD;
  });

  afterEach(() => restoreEnv(snapshot));

  it('sets childCwd from env var', () => {
    process.env.PI_DELEGATE_CHILD_CWD = '/some/work/dir';
    const config = loadConfig();
    expect(config.childCwd).toBe('/some/work/dir');
  });
});

describe('loadConfig — config file loading', () => {
  let snapshot: ReturnType<typeof snapshotEnv>;

  beforeEach(() => {
    snapshot = snapshotEnv();
    delete process.env.PI_DELEGATE_MAX_DEPTH;
    delete process.env.PI_DELEGATE_BINARY_PATH;
    delete process.env.PI_DELEGATE_RUN_TIMEOUT_MS;
    delete process.env.PI_DELEGATE_CHILD_CWD;
  });

  afterEach(() => restoreEnv(snapshot));

  it('reads maxDepth from a valid config file', () => {
    const { filePath } = makeTempConfig(JSON.stringify({ maxDepth: 7 }));
    process.env.PI_DELEGATE_CONFIG_PATH = filePath;
    const config = loadConfig();
    expect(config.maxDepth).toBe(7);
    fs.unlinkSync(filePath);
  });

  it('reads runTimeoutMs from a valid config file', () => {
    const { filePath } = makeTempConfig(JSON.stringify({ runTimeoutMs: 120000 }));
    process.env.PI_DELEGATE_CONFIG_PATH = filePath;
    const config = loadConfig();
    expect(config.runTimeoutMs).toBe(120000);
    fs.unlinkSync(filePath);
  });

  it('reads piBinaryPath from a valid config file', () => {
    const { filePath } = makeTempConfig(JSON.stringify({ piBinaryPath: '/opt/pi/bin/pi' }));
    process.env.PI_DELEGATE_CONFIG_PATH = filePath;
    const config = loadConfig();
    expect(config.piBinaryPath).toBe('/opt/pi/bin/pi');
    fs.unlinkSync(filePath);
  });

  it('ignores non-positive maxDepth from config file (falls back to default)', () => {
    const { filePath } = makeTempConfig(JSON.stringify({ maxDepth: -1 }));
    process.env.PI_DELEGATE_CONFIG_PATH = filePath;
    const config = loadConfig();
    expect(config.maxDepth).toBe(2);
    fs.unlinkSync(filePath);
  });

  it('ignores non-integer maxDepth from config file', () => {
    const { filePath } = makeTempConfig(JSON.stringify({ maxDepth: 1.5 }));
    process.env.PI_DELEGATE_CONFIG_PATH = filePath;
    const config = loadConfig();
    expect(config.maxDepth).toBe(2);
    fs.unlinkSync(filePath);
  });

  it('treats invalid JSON config file as empty (uses defaults)', () => {
    const { filePath } = makeTempConfig('{ this is not json }');
    process.env.PI_DELEGATE_CONFIG_PATH = filePath;
    const config = loadConfig();
    expect(config.maxDepth).toBe(2);
    expect(config.runTimeoutMs).toBe(600_000);
    fs.unlinkSync(filePath);
  });

  it('treats empty JSON object config file as empty (uses defaults)', () => {
    const { filePath } = makeTempConfig('{}');
    process.env.PI_DELEGATE_CONFIG_PATH = filePath;
    const config = loadConfig();
    expect(config.maxDepth).toBe(2);
    expect(config.runTimeoutMs).toBe(600_000);
    fs.unlinkSync(filePath);
  });
});

describe('loadConfig — config file location precedence', () => {
  let snapshot: ReturnType<typeof snapshotEnv>;
  let tmpDir: string;

  beforeEach(() => {
    snapshot = snapshotEnv();
    delete process.env.PI_DELEGATE_MAX_DEPTH;
    delete process.env.PI_DELEGATE_BINARY_PATH;
    delete process.env.PI_DELEGATE_RUN_TIMEOUT_MS;
    delete process.env.PI_DELEGATE_CHILD_CWD;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-delegate-precedence-test-'));
  });

  afterEach(() => {
    restoreEnv(snapshot);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('PI_DELEGATE_CONFIG_PATH takes precedence over PI_CONFIG_DIR', () => {
    // Write config at explicit path with maxDepth=10
    const explicitPath = path.join(tmpDir, 'explicit-config.json');
    fs.writeFileSync(explicitPath, JSON.stringify({ maxDepth: 10 }), 'utf-8');

    // Write config at PI_CONFIG_DIR location with maxDepth=20
    const piConfigDir = path.join(tmpDir, 'pi-config-dir');
    const piConfigSubDir = path.join(piConfigDir, 'pi-delegate');
    fs.mkdirSync(piConfigSubDir, { recursive: true });
    fs.writeFileSync(path.join(piConfigSubDir, 'config.json'), JSON.stringify({ maxDepth: 20 }), 'utf-8');

    process.env.PI_DELEGATE_CONFIG_PATH = explicitPath;
    process.env.PI_CONFIG_DIR = piConfigDir;

    const config = loadConfig();
    // PI_DELEGATE_CONFIG_PATH wins → maxDepth should be 10
    expect(config.maxDepth).toBe(10);
  });

  it('PI_CONFIG_DIR is used when PI_DELEGATE_CONFIG_PATH is not set', () => {
    delete process.env.PI_DELEGATE_CONFIG_PATH;

    // Write config at PI_CONFIG_DIR location with maxDepth=15
    const piConfigDir = path.join(tmpDir, 'pi-config-dir');
    const piConfigSubDir = path.join(piConfigDir, 'pi-delegate');
    fs.mkdirSync(piConfigSubDir, { recursive: true });
    fs.writeFileSync(path.join(piConfigSubDir, 'config.json'), JSON.stringify({ maxDepth: 15 }), 'utf-8');

    process.env.PI_CONFIG_DIR = piConfigDir;
    // Set HOME to a non-existent location to prevent accidentally loading a real config
    process.env.HOME = path.join(tmpDir, 'fakehome-no-config');

    const config = loadConfig();
    expect(config.maxDepth).toBe(15);
  });

  it('falls back to ~/.config/pi/pi-delegate/config.json when no explicit paths set', () => {
    delete process.env.PI_DELEGATE_CONFIG_PATH;
    delete process.env.PI_CONFIG_DIR;

    // Set HOME to a temp dir and create config there
    const fakeHome = path.join(tmpDir, 'fakehome');
    const configSubDir = path.join(fakeHome, '.config', 'pi', 'pi-delegate');
    fs.mkdirSync(configSubDir, { recursive: true });
    fs.writeFileSync(path.join(configSubDir, 'config.json'), JSON.stringify({ maxDepth: 8 }), 'utf-8');

    process.env.HOME = fakeHome;

    const config = loadConfig();
    expect(config.maxDepth).toBe(8);
  });

  it('uses defaults when no config file exists at any location', () => {
    delete process.env.PI_DELEGATE_CONFIG_PATH;
    delete process.env.PI_CONFIG_DIR;

    // Set HOME to a temp dir with no config file
    const fakeHome = path.join(tmpDir, 'fakehome-empty');
    fs.mkdirSync(fakeHome, { recursive: true });
    process.env.HOME = fakeHome;

    const config = loadConfig();
    expect(config.maxDepth).toBe(2);
    expect(config.runTimeoutMs).toBe(600_000);
  });
});
