/**
 * Binary resolution + arg/env builder for pi-delegate (Task 6)
 * Child process spawn + --mode json stream parser (Task 7)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import { randomBytes } from 'crypto';

import type { DelegateConfig, RunStatus } from '../shared/types.js';
import type { ResolvedParams } from './resolve.js';
import type { TempRunFiles } from './tempfiles.js';

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

/**
 * Generate a per-run high-entropy capability token that authorizes child processes
 * to use the delegate provider.
 *
 * @returns A 64-character hex string (256 bits of entropy)
 */
export function generateCapabilityToken(): string {
  return randomBytes(32).toString('hex');
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
  task: string;            // the task string — passed as a positional arg to pi (SPEC §3.2)
  promptMode: 'replace' | 'append'; // selects --system-prompt vs --append-system-prompt
  delegateToken: string;   // '' for ineligible children, token string for authorized ones
  outputFile?: string;     // absolute path to output.json (Task 17 sets this; optional here)
  schemaFile?: string;     // absolute path to schema.json (Task 17 sets this; optional here)
  extensionPaths?: string[]; // paths to extension files to pass via -e
  delegateAgents?: string[]; // agent names this agent is allowed to delegate to
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

  // SPEC §3.2: exactly one of these MUST be passed per child
  if (context.promptMode === 'append') {
    argv.push('--append-system-prompt', context.promptFile);
  } else {
    argv.push('--system-prompt', context.promptFile);
  }

  // Always present
  argv.push('--no-skills');
  argv.push('--no-context-files');
  argv.push('--no-session');

  if (context.outputFile) {
    argv.push('--output-file', context.outputFile);
  }

  // SPEC §3.4: --no-extensions baseline before any -e (child loads ONLY specified providers)
  argv.push('--no-extensions');
  if (context.extensionPaths && context.extensionPaths.length > 0) {
    for (const ep of context.extensionPaths) {
      argv.push('-e', ep);
    }
  }

  // SPEC §3.2: task string MUST be passed as positional argument, never interpolated into a flag
  argv.push(context.task);

  // ── env ─────────────────────────────────────────────────────────────────────
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // Depth threading: child is one level deeper
    PI_DELEGATE_DEPTH: String(context.depth + 1),
    PI_DELEGATE_MAX_DEPTH: String(context.maxDepth),
    PI_DELEGATE_PATH: context.lineagePath,
    PI_DELEGATE_TASK_ID: context.taskId,
    // Capability token: '' or real token
    PI_DELEGATE_TOKEN: context.delegateToken,
    PI_OUTPUT_SCHEMA: '',
    PI_OUTPUT_FILE: '',
    // delegateAgents allowlist (if the current agent has restrictions)
    PI_DELEGATE_AGENTS: context.delegateAgents ? JSON.stringify(context.delegateAgents) : '',
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

// ── Process cleanup helper ────────────────────────────────────────────────────

/**
 * Send SIGTERM to a child process, then SIGKILL after gracefulMs if still alive.
 * Safe to call even if the child has already exited.
 */
function killChild(child: ChildProcess, gracefulMs = 5000): void {
  if (child.exitCode !== null) return; // already exited
  child.kill('SIGTERM');
  const timer = setTimeout(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  }, gracefulMs);
  timer.unref(); // don't prevent Node from exiting
}

// ── Exit code mapping ─────────────────────────────────────────────────────────

/**
 * Map a child process exit code to a RunStatus.
 * Full taxonomy is Task 19; for now all non-zero codes map to 'error'.
 */
export function mapExitCode(exitCode: number): RunStatus {
  if (exitCode === 0) return 'ok';
  if (exitCode === 2) return 'error'; // pi's own error code
  return 'error';
}

// ── Sandbox wrapping ──────────────────────────────────────────────────────

/**
 * Wrap the pi binary path and arguments with a sandbox command if provided.
 * If no sandboxCommand is set, returns the binary and args unchanged.
 *
 * Example: wrapWithSandbox('/usr/local/bin/pi', ['--mode', 'json', 'task'], 'firejail --quiet')
 * Returns: ['firejail', ['--quiet', '/usr/local/bin/pi', '--mode', 'json', 'task']]
 *
 * @param binaryPath - Absolute path to pi binary
 * @param args - Original argv array (does not include binary path)
 * @param sandboxCommand - Optional space-separated command prefix (e.g. 'firejail --quiet')
 * @returns Tuple of [actualBinary, actualArgs] to pass to spawn()
 */
export function wrapWithSandbox(
  binaryPath: string,
  args: string[],
  sandboxCommand?: string,
): [string, string[]] {
  if (!sandboxCommand) return [binaryPath, args];

  const parts = sandboxCommand.trim().split(/\s+/);
  const sandboxBinary = parts[0];
  const sandboxArgs = [...parts.slice(1), binaryPath, ...args];
  return [sandboxBinary, sandboxArgs];
}

// ── AgentEvent types ──────────────────────────────────────────────────────────

/** Events emitted by pi --mode json on stdout */
type AgentEvent =
  | { type: 'agent_start'; agent?: string }
  | { type: 'agent_end'; agent?: string; messages?: Array<{ role: string; content?: Array<{ type: string; text?: string }> }>; result?: string }
  | { type: 'message_start' }
  | { type: 'message_end'; message?: { role: string; content?: Array<{ type: string; text?: string }> }; content?: never }
  | { type: 'tool_start'; tool?: string; input?: unknown }
  | { type: 'tool_end'; tool?: string; output?: unknown }
  | { type: 'text_delta'; text?: string }
  | { type: string; [key: string]: unknown }; // unknown future events

// ── spawnRun ──────────────────────────────────────────────────────────────────

/** Options for spawnRun() */
export interface RunOptions {
  signal?: AbortSignal;
  onUpdate?: (event: { type: string; agent?: string; tool?: string }) => void;
  runTimeoutMs?: number;
  sandboxCommand?: string;  // optional sandbox wrapper
  childCwd?: string;        // child working directory
}

/**
 * Spawn a pi child process, parse its --mode json stdout stream, and resolve
 * with the captured output and exit code.
 *
 * - stdout is parsed line-by-line via readline (handles partial-line buffering)
 * - stderr is accumulated but never causes rejection
 * - Timeout: SIGTERM → SIGKILL after 5s; rejects with { timedOut: true }
 * - Abort signal: SIGTERM → SIGKILL after 5s; resolves with captured output so far
 * - TempRunFiles.cleanup() is NOT called here — that's the caller's responsibility (Task 8)
 */
export async function spawnRun(
  binaryPath: string,
  args: SpawnArgs,
  tempFiles: TempRunFiles,
  options: RunOptions,
): Promise<{ output: string; exitCode: number; timedOut?: boolean }> {
  return new Promise((resolve, reject) => {
    // Apply sandbox wrapping if configured
    const [actualBinary, actualArgs] = wrapWithSandbox(binaryPath, args.argv, options.sandboxCommand);

    // Determine child working directory: use override if set, otherwise temp run dir
    const childCwd = options.childCwd ?? tempFiles.dir;

    // Spawn the child process with isolated cwd
    const child = spawn(actualBinary, actualArgs, {
      env: args.env,
      cwd: childCwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    let agentEndResult = '';
    let stderrBuffer = '';
    let timedOut = false;
    let settled = false;

    // ── stdout: line-by-line JSON event parsing ───────────────────────────────
    const rl = createInterface({ input: child.stdout!, crlfDelay: Infinity });

    rl.on('line', (line) => {
      if (!line.trim()) return; // skip empty lines

      let event: AgentEvent;
      try {
        event = JSON.parse(line) as AgentEvent;
      } catch {
        // Not valid JSON — skip; could log if DEBUG is set
        if (process.env.DEBUG) {
          process.stderr.write(`[pi-delegate] Non-JSON stdout line: ${line}\n`);
        }
        return;
      }

      // Emit coarse progress for key event boundaries
      switch (event.type) {
        case 'agent_start':
          options.onUpdate?.({
            type: 'agent_start',
            agent: (event as { type: 'agent_start'; agent?: string }).agent,
          });
          break;

        case 'tool_start':
          options.onUpdate?.({
            type: 'tool_start',
            tool: (event as { type: 'tool_start'; tool?: string }).tool,
          });
          break;

        case 'tool_end':
          options.onUpdate?.({
            type: 'tool_end',
            tool: (event as { type: 'tool_end'; tool?: string }).tool,
          });
          break;

        case 'agent_end': {
          const agentEndEvent = event as { type: 'agent_end'; agent?: string; messages?: Array<{ role: string; content?: Array<{ type: string; text?: string }> }>; result?: string };
          // Capture result as fallback if no message_end was seen
          if (agentEndEvent.result != null) {
            agentEndResult = agentEndEvent.result;
          }
          // Also try extracting from messages array (actual pi --mode json format)
          if (!agentEndResult && agentEndEvent.messages) {
            const assistantMsg = agentEndEvent.messages.find(m => m.role === 'assistant');
            if (assistantMsg?.content) {
              const texts = assistantMsg.content
                .filter((c): c is { type: string; text: string } => c.type === 'text' && c.text != null)
                .map(c => c.text);
              if (texts.length > 0) agentEndResult = texts.join('\n');
            }
          }
          options.onUpdate?.({
            type: 'agent_end',
            agent: agentEndEvent.agent,
          });
          break;
        }

        case 'message_end': {
          const msgEndEvent = event as { type: 'message_end'; message?: { role: string; content?: Array<{ type: string; text?: string }> } };
          // Extract assistant text from message.content array (actual pi --mode json format)
          if (msgEndEvent.message?.content) {
            const assistantParts = msgEndEvent.message.content.filter(p => p.type === 'text' && p.text != null);
            if (assistantParts.length > 0) {
              output = assistantParts.map(p => p.text).join('\n');
            }
          }
          break;
        }

        default:
          // Unknown event — ignore
          break;
      }
    });

    // ── stderr: accumulate for error messages ─────────────────────────────────
    child.stderr!.on('data', (chunk: Buffer) => {
      stderrBuffer += chunk.toString();
    });

    // ── Timeout handling ──────────────────────────────────────────────────────
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    if (options.runTimeoutMs != null && options.runTimeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        killChild(child);
      }, options.runTimeoutMs);
    }

    // ── Abort signal handling ─────────────────────────────────────────────────
    const abortHandler = (): void => {
      killChild(child);
      // Resolve (not reject) with whatever was captured so far
      // The child 'close' event will fire and settle the promise normally.
    };

    if (options.signal) {
      if (options.signal.aborted) {
        // Signal already fired before we even started — kill immediately
        killChild(child);
      } else {
        options.signal.addEventListener('abort', abortHandler, { once: true });
      }
    }

    // ── Child error (e.g. binary not found) ───────────────────────────────────
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      options.signal?.removeEventListener('abort', abortHandler);
      reject(err);
    });

    // ── Child exit ────────────────────────────────────────────────────────────
    child.on('close', (_code, _signal) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      options.signal?.removeEventListener('abort', abortHandler);

      if (timedOut) {
        // eslint-disable-next-line prefer-promise-reject-errors
        reject({ timedOut: true, stderr: stderrBuffer });
        return;
      }

      // Use message_end.content if captured; fall back to agent_end.result
      const finalOutput = output !== '' ? output : agentEndResult;
      const exitCode = child.exitCode ?? -1;

      resolve({ output: finalOutput, exitCode, timedOut });
    });
  });
}
