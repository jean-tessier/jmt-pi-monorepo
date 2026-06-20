/**
 * Temp file lifecycle management for pi-delegate runs
 * Creates isolated temp directories per run and manages cleanup
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

export interface TempRunFiles {
  dir: string;         // absolute path to the temp dir
  promptFile: string;  // absolute path to prompt.md
  schemaFile: string;  // absolute path to schema.json (may not exist if no schema was provided)
  outputFile: string;  // absolute path to output.json (written by child; read by parent)
  cleanup: () => Promise<void>;  // deletes the entire dir, no-throw
}

/**
 * Creates a temp directory for a delegation run and writes the prompt file
 *
 * @param taskId - unique ID for this run
 * @param prompt - the task description to write to prompt.md
 * @param schema - optional JSON Schema object; if provided, written to schema.json
 * @param signal - optional AbortSignal to trigger cleanup on abort
 * @returns TempRunFiles object with dir, promptFile, schemaFile, outputFile, and cleanup
 * @throws if mkdir or writeFile fails (hard errors)
 */
export async function createTempRunFiles(
  taskId: string,
  prompt: string,
  schema?: object,
  signal?: AbortSignal,
): Promise<TempRunFiles> {
  const tempBase = path.join(os.tmpdir(), 'pi-delegate', taskId);

  // Create temp directory with mode 0o700 (owner-only)
  await fs.mkdir(tempBase, { mode: 0o700, recursive: true });

  const promptFile = path.join(tempBase, 'prompt.md');
  const schemaFile = path.join(tempBase, 'schema.json');
  const outputFile = path.join(tempBase, 'output.json');

  // Write prompt.md with mode 0o600 (owner-only read/write)
  await fs.writeFile(promptFile, prompt, { mode: 0o600, encoding: 'utf-8' });

  // Write schema.json with mode 0o600 only if schema is provided
  if (schema) {
    await fs.writeFile(schemaFile, JSON.stringify(schema, null, 2), { mode: 0o600, encoding: 'utf-8' });
  }

  const cleanup = async (): Promise<void> => {
    try {
      await fs.rm(tempBase, { recursive: true, force: true });
    } catch {
      // Silently swallow all errors — cleanup is best-effort
      // This includes ENOENT (already deleted), EACCES (permission), and other fs errors
    }
  };

  const tempRunFiles: TempRunFiles = {
    dir: tempBase,
    promptFile,
    schemaFile,
    outputFile,
    cleanup,
  };

  // Hook cleanup to abort signal if provided
  if (signal && !signal.aborted) {
    signal.addEventListener('abort', () => {
      // Fire-and-forget cleanup; we don't await it here since abort listeners can't be async
      cleanup().catch(() => {
        // Ignore any errors from cleanup
      });
    });
  }

  return tempRunFiles;
}
