/**
 * Agent discovery + frontmatter parse for pi-delegate
 *
 * Discovers .md agent definition files from:
 *   - User scope: ~/.config/pi/agents/**\/*.md (or $PI_CONFIG_DIR/agents/**\/*.md)
 *   - Project scope: .pi/agents/**\/*.md (searched upward from cwd to git/fs root)
 *
 * Project-scope definitions shadow user-scope definitions with the same name.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';
import type { AgentDefinition } from '../shared/types.js';

/** Valid agent name pattern: kebab-case, starts with letter or digit */
const AGENT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Glob all .md files recursively under a directory.
 * Returns [] if the directory does not exist.
 */
function globMdFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const results: string[] = [];

  function recurse(current: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      // Unreadable directory — skip silently
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        recurse(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(fullPath);
      }
    }
  }

  recurse(dir);
  return results;
}

/**
 * Parse YAML frontmatter from .md file content.
 *
 * Returns { frontmatter, body } where:
 *   - frontmatter is the parsed YAML object (or {} if no frontmatter)
 *   - body is the content after the closing ---
 *
 * If there is no opening ---, the entire content is the body.
 */
function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  // Check for opening ---
  if (!content.startsWith('---')) {
    return { frontmatter: {}, body: content };
  }

  // Find the closing ---
  const afterOpen = content.slice(3);
  const closingIndex = afterOpen.indexOf('\n---');

  if (closingIndex === -1) {
    // No closing ---, treat entire content as body
    return { frontmatter: {}, body: content };
  }

  const yamlText = afterOpen.slice(0, closingIndex);
  const bodyStart = closingIndex + 4; // skip "\n---"
  // Skip optional newline right after closing ---
  const body = afterOpen.slice(bodyStart).replace(/^\n/, '');

  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch {
    // Bad YAML — treat as no frontmatter
    return { frontmatter: {}, body: content };
  }

  if (parsed === null || parsed === undefined) {
    return { frontmatter: {}, body };
  }

  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { frontmatter: {}, body };
  }

  return { frontmatter: parsed as Record<string, unknown>, body };
}

/**
 * Validate and build an AgentDefinition from a file path.
 * Returns null and emits a warning if validation fails.
 */
function buildAgentDefinition(filePath: string): AgentDefinition | null {
  // Derive name from filename
  const basename = path.basename(filePath);
  const name = basename.endsWith('.md') ? basename.slice(0, -3) : basename;

  // Validate agent name
  if (!AGENT_NAME_PATTERN.test(name)) {
    console.warn(
      `[pi-delegate] skipping agent "${name}": name must match /^[a-z0-9][a-z0-9-]*$/ (from file: ${filePath})`
    );
    return null;
  }

  // Read file
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    console.warn(
      `[pi-delegate] skipping agent "${name}": could not read file ${filePath}: ${(err as Error).message}`
    );
    return null;
  }

  const { frontmatter, body } = parseFrontmatter(content);

  // Validate frontmatter fields
  if (
    'description' in frontmatter &&
    typeof frontmatter.description !== 'string'
  ) {
    console.warn(
      `[pi-delegate] skipping agent "${name}": "description" must be a string if present`
    );
    return null;
  }

  if ('model' in frontmatter && typeof frontmatter.model !== 'string') {
    console.warn(
      `[pi-delegate] skipping agent "${name}": "model" must be a string if present`
    );
    return null;
  }

  if ('tools' in frontmatter) {
    const tools = frontmatter.tools;
    if (
      !Array.isArray(tools) ||
      !tools.every((t) => typeof t === 'string')
    ) {
      console.warn(
        `[pi-delegate] skipping agent "${name}": "tools" must be an array of strings if present`
      );
      return null;
    }
  }

  if ('delegateAgents' in frontmatter) {
    const delegateAgents = frontmatter.delegateAgents;
    if (
      !Array.isArray(delegateAgents) ||
      !delegateAgents.every((a) => typeof a === 'string')
    ) {
      console.warn(
        `[pi-delegate] skipping agent "${name}": "delegateAgents" must be an array of strings if present`
      );
      return null;
    }
  }

  if ('outputSchema' in frontmatter) {
    const outputSchema = frontmatter.outputSchema;
    if (
      outputSchema === null ||
      typeof outputSchema !== 'object' ||
      Array.isArray(outputSchema)
    ) {
      console.warn(
        `[pi-delegate] skipping agent "${name}": "outputSchema" must be a plain object if present`
      );
      return null;
    }
  }

  // Build the AgentDefinition
  const def: AgentDefinition = {
    name,
    filePath,
    systemPrompt: body || undefined,
  };

  if (typeof frontmatter.description === 'string') {
    def.description = frontmatter.description;
  }

  if (typeof frontmatter.model === 'string') {
    def.model = frontmatter.model;
  }

  if (Array.isArray(frontmatter.tools)) {
    def.tools = frontmatter.tools as string[];
  }

  if (Array.isArray(frontmatter.delegateAgents)) {
    def.delegateAgents = frontmatter.delegateAgents as string[];
  }

  if (
    frontmatter.outputSchema !== null &&
    frontmatter.outputSchema !== undefined &&
    typeof frontmatter.outputSchema === 'object' &&
    !Array.isArray(frontmatter.outputSchema)
  ) {
    def.outputSchema = frontmatter.outputSchema as object;
  }

  return def;
}

/**
 * Collect AgentDefinition objects from all .md files in a directory tree.
 * Invalid agents are skipped with a warning.
 * Later entries for the same name overwrite earlier ones (last-wins within scope).
 */
function collectAgents(dir: string): Map<string, AgentDefinition> {
  const result = new Map<string, AgentDefinition>();
  const files = globMdFiles(dir);
  for (const filePath of files) {
    const def = buildAgentDefinition(filePath);
    if (def !== null) {
      result.set(def.name, def);
    }
  }
  return result;
}

/**
 * Resolve user-scope agents directory:
 *   $PI_CONFIG_DIR/agents  or  ~/.config/pi/agents
 */
function getUserAgentsDir(): string {
  if (process.env.PI_CONFIG_DIR) {
    return path.join(process.env.PI_CONFIG_DIR, 'agents');
  }
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return path.join(home, '.config', 'pi', 'agents');
}

/**
 * Walk up from `startDir` to git root (or filesystem root), collecting
 * all .pi/agents directories along the way.
 *
 * Returns the directories in order from outermost (nearest to git root) to
 * innermost (nearest to cwd), so that a closer .pi/agents shadows a farther one.
 */
function findProjectAgentsDirs(startDir: string): string[] {
  const dirs: string[] = [];
  let current = startDir;

  while (true) {
    const piAgentsDir = path.join(current, '.pi', 'agents');
    dirs.push(piAgentsDir);

    // Check if this is the git root
    const gitDir = path.join(current, '.git');
    if (fs.existsSync(gitDir)) {
      break;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      // Filesystem root reached
      break;
    }
    current = parent;
  }

  // Reverse so that outermost (git root) is first, innermost (cwd) is last
  // This means directories closer to cwd override those closer to git root
  dirs.reverse();
  return dirs;
}

/**
 * Resolve project-scope agents:
 *   If PI_PROJECT_AGENTS_DIR is set, use it directly.
 *   Otherwise, walk up from cwd to git root collecting .pi/agents dirs.
 *   Closer-to-cwd directories shadow farther ones.
 */
function getProjectAgents(): Map<string, AgentDefinition> {
  if (process.env.PI_PROJECT_AGENTS_DIR) {
    return collectAgents(process.env.PI_PROJECT_AGENTS_DIR);
  }

  const cwd = process.cwd();
  const dirs = findProjectAgentsDirs(cwd);

  // Start with outermost, merge inward so closer-to-cwd wins
  const result = new Map<string, AgentDefinition>();
  for (const dir of dirs) {
    const agents = collectAgents(dir);
    for (const [name, def] of agents) {
      result.set(name, def);
    }
  }
  return result;
}

/**
 * Discover all valid agent definitions from user and project scopes.
 * Project-scope definitions shadow user-scope ones with the same name.
 */
export async function discoverAgents(): Promise<AgentDefinition[]> {
  // Collect user-scope agents
  const userAgentsDir = getUserAgentsDir();
  const userAgents = collectAgents(userAgentsDir);

  // Collect project-scope agents
  const projectAgents = getProjectAgents();

  // Merge: start with user agents, then overlay project agents (project wins)
  const merged = new Map<string, AgentDefinition>(userAgents);
  for (const [name, def] of projectAgents) {
    merged.set(name, def);
  }

  return Array.from(merged.values());
}

/**
 * Find a single agent by name.
 * Convenience wrapper around discoverAgents().
 */
export async function findAgent(name: string): Promise<AgentDefinition | undefined> {
  const agents = await discoverAgents();
  return agents.find((a) => a.name === name);
}
