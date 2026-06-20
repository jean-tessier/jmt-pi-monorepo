/**
 * Binary resolution + arg/env builder for pi-delegate (Task 6)
 *
 * Task 7 will add the actual child_process.spawn() call and stream handling.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import type { DelegateConfig } from '../shared/types.js';
import type { ResolvedParams } from './resolve.js';

// ── Binary resolution ─────────────────────────────────────────────────────────

/**
 * Check whether a file exists and is executable by the current process.
 * Returns true if accessible, false otherwise.
 */
async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Search PATH directories for an executable named `pi`.
 * Returns the absolute path on success, or null if not found.
 */
async function findInPath(): Promise<string | null> {
  const pathEnv = process.env.PATH ?? '';
  const separator = process.platform === 'win32' ? ';' : ':';
  const dirs = pathEnv.split(separator).filter(Boolean);

  for (const dir of dirs) {
    const candidate = path.join(dir, 'pi');
    if (await isExecutable(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Resolve the pi binary path using the following precedence (first wins):
 *   1. config.piBinaryPath — if set, use it; throw if not executable
 *   2. PI_DELEGATE_BINARY_PATH env var — same check
 *   3. Search PATH for an executable `pi` binary
 *
 * @returns Absolute path to the pi binary
 * @throws Error if the resolved path is not executable or pi is not found in PATH
 */
export async function resolvePiBinary(config: DelegateConfig): Promise<string> {
  // 1. Explicit config value
  if (config.piBinaryPath) {
    if (!(await isExecutable(config.piBinaryPath))) {
      throw new Error(
        `pi binary at config.piBinaryPath is not executable: ${config.piBinaryPath}`,
      );
    }
    return config.piBinaryPath;
  }

  // 2. Environment variable override
  const envBinaryPath = process.env.PI_DELEGATE_BINARY_PATH;
  if (envBinaryPath) {
    if (!(await isExecutable(envBinaryPath))) {
      throw new Error(
        `pi binary at PI_DELEGATE_BINARY_PATH is not executable: ${envBinaryPath}`,
      );
    }
    return envBinaryPath;
  }

  // 3. Search PATH
  const found = await findInPath();
  if (!found) {
    throw new Error('pi binary not found in PATH');
  }
  return found;
}

// ── Arg/env builder ───────────────────────────────────────────────────────────

/** The argv array and environment variables to pass to a child pi process */
export interface SpawnArgs {
  argv: string[];
  env: NodeJS.ProcessEnv;
}

/** Context for the current delegation run, passed in by the caller */
export interface SpawnContext {
  taskId: string;
  depth: number;
  maxDepth: number;
  lineagePath: string;
  promptFile: string;      // absolute path to prompt.md from TempRunFiles
  outputFile?: string;     // absolute path to output.json (Task 17 sets this; optional here)
  schemaFile?: string;     // absolute path to schema.json (Task 17 sets this; optional here)
}

/**
 * Build the complete argv[] and env to pass to child_process.spawn().
 *
 * argv does NOT include the binary path itself — that is child_process.spawn()'s first arg.
 * argv always starts with ['--mode', 'json'].
 *
 * @param resolvedParams - Fully-resolved invocation parameters (from resolveParams())
 * @param context - Run-specific context (taskId, depth, file paths, etc.)
 * @returns SpawnArgs containing argv[] and env record
 */
export function buildSpawnArgs(
  resolvedParams: ResolvedParams,
  context: SpawnContext,
): SpawnArgs {
  // ── argv ────────────────────────────────────────────────────────────────────
  const argv: string[] = ['--mode', 'json'];

  if (resolvedParams.model) {
    argv.push('--model', resolvedParams.model);
  }

  if (resolvedParams.tools.length > 0) {
    argv.push('--tools', resolvedParams.tools.join(','));
  }

  if (resolvedParams.systemPrompt) {
    // Pass the file path, not the text inline
    argv.push('--append-system-prompt', context.promptFile);
  }

  // Always present
  argv.push('--no-skills');
  argv.push('--no-context-files');
  argv.push('--no-session');

  if (context.outputFile) {
    argv.push('--output-file', context.outputFile);
  }

  // ── env ─────────────────────────────────────────────────────────────────────
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // Depth threading: child is one level deeper
    PI_DELEGATE_DEPTH: String(context.depth + 1),
    PI_DELEGATE_MAX_DEPTH: String(context.maxDepth),
    PI_DELEGATE_PATH: context.lineagePath,
    PI_DELEGATE_TASK_ID: context.taskId,
    // Stage 1 placeholders (overridden in Stage 2 Tasks 13/15)
    PI_DELEGATE_TOKEN: '',
    PI_OUTPUT_SCHEMA: '',
    PI_OUTPUT_FILE: '',
  };

  // Override placeholders if values are available
  if (context.schemaFile) {
    env.PI_OUTPUT_SCHEMA = context.schemaFile;
  }
  if (context.outputFile) {
    env.PI_OUTPUT_FILE = context.outputFile;
  }

  return { argv, env };
}
