/**
 * Conformance tests for agents.ts (finding G4 — 0% covered)
 *
 * Covers:
 *   - Agent discovery from user scope ($PI_CONFIG_DIR/agents or ~/.config/pi/agents)
 *   - Agent discovery from project scope (PI_PROJECT_AGENTS_DIR or .pi/agents walk)
 *   - Project scope shadows user scope (same name → project wins)
 *   - Frontmatter parsing (agentDef fields: model, tools, systemPrompt, etc.)
 *   - Agent name validation (must match /^[a-z0-9][a-z0-9-]*$/)
 *   - Missing/empty agents directory → returns empty list
 *   - Invalid frontmatter fields → agent skipped silently
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { discoverAgents, findAgent } from '../../src/parent/agents.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

type EnvSnapshot = {
  PI_CONFIG_DIR: string | undefined;
  PI_PROJECT_AGENTS_DIR: string | undefined;
  HOME: string | undefined;
  USERPROFILE: string | undefined;
};

function snapshotEnv(): EnvSnapshot {
  return {
    PI_CONFIG_DIR: process.env.PI_CONFIG_DIR,
    PI_PROJECT_AGENTS_DIR: process.env.PI_PROJECT_AGENTS_DIR,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
  };
}

function restoreEnv(snapshot: EnvSnapshot): void {
  const keys = Object.keys(snapshot) as Array<keyof EnvSnapshot>;
  for (const key of keys) {
    if (snapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = snapshot[key] as string;
    }
  }
}

/**
 * Create a temp directory tree for testing.
 * Returns the root temp dir path.
 */
function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pi-delegate-agents-test-'));
}

/** Write a .md agent file with optional frontmatter and body */
function writeAgentFile(dir: string, name: string, frontmatter?: Record<string, unknown>, body?: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${name}.md`);
  let content = '';
  if (frontmatter && Object.keys(frontmatter).length > 0) {
    content += '---\n';
    for (const [key, value] of Object.entries(frontmatter)) {
      if (Array.isArray(value)) {
        content += `${key}:\n`;
        for (const item of value) {
          content += `  - ${item}\n`;
        }
      } else if (typeof value === 'object' && value !== null) {
        content += `${key}:\n`;
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          content += `  ${k}: ${JSON.stringify(v)}\n`;
        }
      } else {
        content += `${key}: ${JSON.stringify(value)}\n`;
      }
    }
    content += '---\n';
  }
  if (body !== undefined) {
    content += body;
  }
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('discoverAgents — user scope', () => {
  let tmpDir: string;
  let snapshot: EnvSnapshot;

  beforeEach(() => {
    snapshot = snapshotEnv();
    tmpDir = makeTempDir();
    // Use PI_PROJECT_AGENTS_DIR pointing to an empty dir to isolate from real project
    const emptyProjectDir = path.join(tmpDir, 'empty-project-agents');
    fs.mkdirSync(emptyProjectDir, { recursive: true });
    process.env.PI_PROJECT_AGENTS_DIR = emptyProjectDir;
  });

  afterEach(() => {
    restoreEnv(snapshot);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('discovers agents from PI_CONFIG_DIR/agents', async () => {
    const userAgentsDir = path.join(tmpDir, 'user-agents');
    writeAgentFile(userAgentsDir, 'my-agent', { description: 'A user agent' });
    process.env.PI_CONFIG_DIR = path.join(tmpDir, 'config-dir');
    // agents dir is relative to PI_CONFIG_DIR
    const piConfigAgentsDir = path.join(tmpDir, 'config-dir', 'agents');
    writeAgentFile(piConfigAgentsDir, 'pi-config-agent', { description: 'PI_CONFIG_DIR agent' });

    const agents = await discoverAgents();
    const names = agents.map((a) => a.name);
    expect(names).toContain('pi-config-agent');
  });

  it('returns empty list when agents directory does not exist', async () => {
    // PI_CONFIG_DIR points to a location with no agents subdir
    const fakeConfigDir = path.join(tmpDir, 'nonexistent-config');
    process.env.PI_CONFIG_DIR = fakeConfigDir;

    const agents = await discoverAgents();
    expect(Array.isArray(agents)).toBe(true);
    // May be empty or only from project scope (we set PI_PROJECT_AGENTS_DIR to empty dir)
    expect(agents.length).toBe(0);
  });

  it('returns empty list when agents directory exists but is empty', async () => {
    const fakeConfigDir = path.join(tmpDir, 'config-with-empty-agents');
    const agentsDir = path.join(fakeConfigDir, 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    process.env.PI_CONFIG_DIR = fakeConfigDir;

    const agents = await discoverAgents();
    expect(agents.length).toBe(0);
  });
});

describe('discoverAgents — project scope', () => {
  let tmpDir: string;
  let snapshot: EnvSnapshot;

  beforeEach(() => {
    snapshot = snapshotEnv();
    tmpDir = makeTempDir();
    // Use PI_CONFIG_DIR pointing to empty config dir to isolate from real user config
    const emptyConfigDir = path.join(tmpDir, 'empty-config');
    fs.mkdirSync(emptyConfigDir, { recursive: true });
    process.env.PI_CONFIG_DIR = emptyConfigDir;
  });

  afterEach(() => {
    restoreEnv(snapshot);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('discovers agents from PI_PROJECT_AGENTS_DIR when set', async () => {
    const projectAgentsDir = path.join(tmpDir, 'project-agents');
    writeAgentFile(projectAgentsDir, 'project-agent', { description: 'A project agent' });
    process.env.PI_PROJECT_AGENTS_DIR = projectAgentsDir;

    const agents = await discoverAgents();
    const names = agents.map((a) => a.name);
    expect(names).toContain('project-agent');
  });

  it('returns empty list when PI_PROJECT_AGENTS_DIR is empty', async () => {
    const emptyProjectAgentsDir = path.join(tmpDir, 'empty-project-agents');
    fs.mkdirSync(emptyProjectAgentsDir, { recursive: true });
    process.env.PI_PROJECT_AGENTS_DIR = emptyProjectAgentsDir;

    const agents = await discoverAgents();
    expect(agents.length).toBe(0);
  });
});

describe('discoverAgents — project scope shadows user scope', () => {
  let tmpDir: string;
  let snapshot: EnvSnapshot;

  beforeEach(() => {
    snapshot = snapshotEnv();
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    restoreEnv(snapshot);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('project agent wins over user agent with the same name', async () => {
    // User scope: researcher agent with model 'user-model'
    const userConfigDir = path.join(tmpDir, 'user-config');
    writeAgentFile(
      path.join(userConfigDir, 'agents'),
      'researcher',
      { model: 'user-model', description: 'User researcher' }
    );
    process.env.PI_CONFIG_DIR = userConfigDir;

    // Project scope: researcher agent with model 'project-model'
    const projectAgentsDir = path.join(tmpDir, 'project-agents');
    writeAgentFile(projectAgentsDir, 'researcher', { model: 'project-model', description: 'Project researcher' });
    process.env.PI_PROJECT_AGENTS_DIR = projectAgentsDir;

    const agents = await discoverAgents();
    const researcher = agents.find((a) => a.name === 'researcher');
    expect(researcher).toBeDefined();
    // Project scope wins
    expect(researcher!.model).toBe('project-model');
    expect(researcher!.description).toBe('Project researcher');
  });

  it('unique user agents are still included when project has different names', async () => {
    const userConfigDir = path.join(tmpDir, 'user-config');
    writeAgentFile(path.join(userConfigDir, 'agents'), 'user-only', { description: 'User only' });
    process.env.PI_CONFIG_DIR = userConfigDir;

    const projectAgentsDir = path.join(tmpDir, 'project-agents');
    writeAgentFile(projectAgentsDir, 'project-only', { description: 'Project only' });
    process.env.PI_PROJECT_AGENTS_DIR = projectAgentsDir;

    const agents = await discoverAgents();
    const names = agents.map((a) => a.name);
    expect(names).toContain('user-only');
    expect(names).toContain('project-only');
  });
});

describe('discoverAgents — frontmatter parsing', () => {
  let tmpDir: string;
  let snapshot: EnvSnapshot;

  beforeEach(() => {
    snapshot = snapshotEnv();
    tmpDir = makeTempDir();
    // Isolate from real user config
    const emptyConfigDir = path.join(tmpDir, 'empty-config');
    fs.mkdirSync(emptyConfigDir, { recursive: true });
    process.env.PI_CONFIG_DIR = emptyConfigDir;
  });

  afterEach(() => {
    restoreEnv(snapshot);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parses model from frontmatter', async () => {
    const agentsDir = path.join(tmpDir, 'agents');
    writeAgentFile(agentsDir, 'model-agent', { model: 'google/gemini-2.5-flash' });
    process.env.PI_PROJECT_AGENTS_DIR = agentsDir;

    const agents = await discoverAgents();
    const agent = agents.find((a) => a.name === 'model-agent');
    expect(agent?.model).toBe('google/gemini-2.5-flash');
  });

  it('parses description from frontmatter', async () => {
    const agentsDir = path.join(tmpDir, 'agents');
    writeAgentFile(agentsDir, 'desc-agent', { description: 'Does interesting things' });
    process.env.PI_PROJECT_AGENTS_DIR = agentsDir;

    const agents = await discoverAgents();
    const agent = agents.find((a) => a.name === 'desc-agent');
    expect(agent?.description).toBe('Does interesting things');
  });

  it('parses tools array from frontmatter', async () => {
    const agentsDir = path.join(tmpDir, 'agents');
    writeAgentFile(agentsDir, 'tools-agent', { tools: ['read', 'bash', 'grep'] });
    process.env.PI_PROJECT_AGENTS_DIR = agentsDir;

    const agents = await discoverAgents();
    const agent = agents.find((a) => a.name === 'tools-agent');
    expect(agent?.tools).toEqual(['read', 'bash', 'grep']);
  });

  it('parses delegateAgents array from frontmatter', async () => {
    const agentsDir = path.join(tmpDir, 'agents');
    writeAgentFile(agentsDir, 'delegator', { delegateAgents: ['researcher', 'coder'] });
    process.env.PI_PROJECT_AGENTS_DIR = agentsDir;

    const agents = await discoverAgents();
    const agent = agents.find((a) => a.name === 'delegator');
    expect(agent?.delegateAgents).toEqual(['researcher', 'coder']);
  });

  it('parses maxDepth from frontmatter', async () => {
    const agentsDir = path.join(tmpDir, 'agents');
    writeAgentFile(agentsDir, 'shallow-agent', { maxDepth: 1 });
    process.env.PI_PROJECT_AGENTS_DIR = agentsDir;

    const agents = await discoverAgents();
    const agent = agents.find((a) => a.name === 'shallow-agent');
    expect(agent?.maxDepth).toBe(1);
  });

  it('uses file body as systemPrompt', async () => {
    const agentsDir = path.join(tmpDir, 'agents');
    const body = 'You are a helpful assistant.\n\nBe concise.';
    writeAgentFile(agentsDir, 'prompt-agent', {}, body);
    process.env.PI_PROJECT_AGENTS_DIR = agentsDir;

    const agents = await discoverAgents();
    const agent = agents.find((a) => a.name === 'prompt-agent');
    expect(agent?.systemPrompt).toContain('You are a helpful assistant.');
  });

  it('sets systemPrompt to undefined when body is empty', async () => {
    const agentsDir = path.join(tmpDir, 'agents');
    writeAgentFile(agentsDir, 'no-body-agent', { description: 'No body' }, '');
    process.env.PI_PROJECT_AGENTS_DIR = agentsDir;

    const agents = await discoverAgents();
    const agent = agents.find((a) => a.name === 'no-body-agent');
    expect(agent?.systemPrompt).toBeUndefined();
  });

  it('file without frontmatter has no model/tools/description but has body as systemPrompt', async () => {
    const agentsDir = path.join(tmpDir, 'agents');
    // Write raw content without frontmatter markers
    fs.mkdirSync(agentsDir, { recursive: true });
    const body = 'Just plain text, no frontmatter.';
    fs.writeFileSync(path.join(agentsDir, 'plain-agent.md'), body, 'utf-8');
    process.env.PI_PROJECT_AGENTS_DIR = agentsDir;

    const agents = await discoverAgents();
    const agent = agents.find((a) => a.name === 'plain-agent');
    expect(agent).toBeDefined();
    expect(agent?.model).toBeUndefined();
    expect(agent?.tools).toBeUndefined();
    expect(agent?.systemPrompt).toContain('Just plain text');
  });
});

describe('discoverAgents — agent name validation', () => {
  let tmpDir: string;
  let snapshot: EnvSnapshot;

  beforeEach(() => {
    snapshot = snapshotEnv();
    tmpDir = makeTempDir();
    const emptyConfigDir = path.join(tmpDir, 'empty-config');
    fs.mkdirSync(emptyConfigDir, { recursive: true });
    process.env.PI_CONFIG_DIR = emptyConfigDir;
  });

  afterEach(() => {
    restoreEnv(snapshot);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accepts valid kebab-case agent names', async () => {
    const agentsDir = path.join(tmpDir, 'agents');
    writeAgentFile(agentsDir, 'my-agent', {});
    writeAgentFile(agentsDir, 'a', {});
    writeAgentFile(agentsDir, '0agent', {});
    process.env.PI_PROJECT_AGENTS_DIR = agentsDir;

    const agents = await discoverAgents();
    const names = agents.map((a) => a.name);
    expect(names).toContain('my-agent');
    expect(names).toContain('a');
    expect(names).toContain('0agent');
  });

  it('skips agent files with names that start with a capital letter', async () => {
    const agentsDir = path.join(tmpDir, 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    // Write a file with uppercase name — does not match /^[a-z0-9][a-z0-9-]*$/
    fs.writeFileSync(path.join(agentsDir, 'BadName.md'), '# agent', 'utf-8');
    process.env.PI_PROJECT_AGENTS_DIR = agentsDir;

    const agents = await discoverAgents();
    const names = agents.map((a) => a.name);
    expect(names).not.toContain('BadName');
  });

  it('skips agent files with names containing underscores', async () => {
    const agentsDir = path.join(tmpDir, 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, 'bad_name.md'), '# agent', 'utf-8');
    process.env.PI_PROJECT_AGENTS_DIR = agentsDir;

    const agents = await discoverAgents();
    const names = agents.map((a) => a.name);
    expect(names).not.toContain('bad_name');
  });
});

describe('discoverAgents — invalid frontmatter skips agent', () => {
  let tmpDir: string;
  let snapshot: EnvSnapshot;

  beforeEach(() => {
    snapshot = snapshotEnv();
    tmpDir = makeTempDir();
    const emptyConfigDir = path.join(tmpDir, 'empty-config');
    fs.mkdirSync(emptyConfigDir, { recursive: true });
    process.env.PI_CONFIG_DIR = emptyConfigDir;
  });

  afterEach(() => {
    restoreEnv(snapshot);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('skips agent when tools is not an array of strings', async () => {
    const agentsDir = path.join(tmpDir, 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    // Write agent with invalid tools field (object, not array)
    fs.writeFileSync(
      path.join(agentsDir, 'bad-tools.md'),
      '---\ntools:\n  key: value\n---\nBody.\n',
      'utf-8'
    );
    process.env.PI_PROJECT_AGENTS_DIR = agentsDir;

    const agents = await discoverAgents();
    const names = agents.map((a) => a.name);
    expect(names).not.toContain('bad-tools');
  });

  it('skips agent when model is not a string', async () => {
    const agentsDir = path.join(tmpDir, 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    // Write agent with invalid model field (number, not string)
    fs.writeFileSync(
      path.join(agentsDir, 'bad-model.md'),
      '---\nmodel: 42\n---\nBody.\n',
      'utf-8'
    );
    process.env.PI_PROJECT_AGENTS_DIR = agentsDir;

    const agents = await discoverAgents();
    const names = agents.map((a) => a.name);
    expect(names).not.toContain('bad-model');
  });

  it('skips agent when maxDepth is not a positive integer', async () => {
    const agentsDir = path.join(tmpDir, 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    // maxDepth of 0 is invalid (must be > 0)
    fs.writeFileSync(
      path.join(agentsDir, 'bad-depth.md'),
      '---\nmaxDepth: 0\n---\nBody.\n',
      'utf-8'
    );
    process.env.PI_PROJECT_AGENTS_DIR = agentsDir;

    const agents = await discoverAgents();
    const names = agents.map((a) => a.name);
    expect(names).not.toContain('bad-depth');
  });

  it('bad YAML frontmatter causes agent to be treated as having no frontmatter', async () => {
    const agentsDir = path.join(tmpDir, 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    // Deliberately malformed YAML inside frontmatter
    // (unclosed bracket)
    fs.writeFileSync(
      path.join(agentsDir, 'bad-yaml.md'),
      '---\ntools: [unclosed\n---\nBody here.\n',
      'utf-8'
    );
    process.env.PI_PROJECT_AGENTS_DIR = agentsDir;

    const agents = await discoverAgents();
    // With bad YAML, parseFrontmatter falls back to {} frontmatter and full content as body
    // The agent should be included (no invalid fields), but with no model/tools/etc.
    const agent = agents.find((a) => a.name === 'bad-yaml');
    // Agent is still discovered (no fatal validation failure), just no typed fields
    expect(agent).toBeDefined();
    expect(agent?.tools).toBeUndefined();
    expect(agent?.model).toBeUndefined();
  });
});

describe('discoverAgents — subdirectory recursion', () => {
  let tmpDir: string;
  let snapshot: EnvSnapshot;

  beforeEach(() => {
    snapshot = snapshotEnv();
    tmpDir = makeTempDir();
    const emptyConfigDir = path.join(tmpDir, 'empty-config');
    fs.mkdirSync(emptyConfigDir, { recursive: true });
    process.env.PI_CONFIG_DIR = emptyConfigDir;
  });

  afterEach(() => {
    restoreEnv(snapshot);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds agents in nested subdirectories', async () => {
    const agentsDir = path.join(tmpDir, 'agents');
    const subDir = path.join(agentsDir, 'sub', 'nested');
    writeAgentFile(subDir, 'deep-agent', { description: 'Deep nested agent' });
    process.env.PI_PROJECT_AGENTS_DIR = agentsDir;

    const agents = await discoverAgents();
    const names = agents.map((a) => a.name);
    expect(names).toContain('deep-agent');
  });
});

describe('findAgent', () => {
  let tmpDir: string;
  let snapshot: EnvSnapshot;

  beforeEach(() => {
    snapshot = snapshotEnv();
    tmpDir = makeTempDir();
    const emptyConfigDir = path.join(tmpDir, 'empty-config');
    fs.mkdirSync(emptyConfigDir, { recursive: true });
    process.env.PI_CONFIG_DIR = emptyConfigDir;
  });

  afterEach(() => {
    restoreEnv(snapshot);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns the agent definition when found by name', async () => {
    const agentsDir = path.join(tmpDir, 'agents');
    writeAgentFile(agentsDir, 'target-agent', { description: 'Target' });
    process.env.PI_PROJECT_AGENTS_DIR = agentsDir;

    const agent = await findAgent('target-agent');
    expect(agent).toBeDefined();
    expect(agent?.name).toBe('target-agent');
  });

  it('returns undefined when agent name is not found', async () => {
    const agentsDir = path.join(tmpDir, 'agents');
    writeAgentFile(agentsDir, 'some-agent', {});
    process.env.PI_PROJECT_AGENTS_DIR = agentsDir;

    const agent = await findAgent('nonexistent-agent');
    expect(agent).toBeUndefined();
  });
});
