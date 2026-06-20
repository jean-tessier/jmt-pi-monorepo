/**
 * Parallel fan-out for pi-delegate (Task 10)
 *
 * Runs an array of ParallelTask items concurrently with a semaphore-style
 * concurrency limiter. Results are returned in input order (index-stable).
 * One failure does not cancel the remaining tasks (partial tolerance).
 */

import type { ParallelTask } from '../shared/types.js';

export interface ParallelRunOptions {
  concurrency?: number;         // max concurrent runs (default: 5)
  maxConcurrency?: number;      // hard ceiling (default: 10)
  maxInFlightChildren?: number; // global in-flight cap from config (default: unlimited)
  failFast?: boolean;           // abort siblings on first error (default: false; scaffold only in Stage 1)
  signal?: AbortSignal;         // parent cancellation signal
  onUpdate?: (index: number, event: { type: string }) => void;
}

export interface ParallelResult {
  index: number;
  output: string;               // labeled result or blocked-result string
  status: 'ok' | 'error';
}

/**
 * Simple promise-pool concurrency runner.
 * Runs `fn` for each item in `items` with at most `limit` concurrent calls.
 * Results (or side-effects) must be captured inside `fn`.
 */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<unknown>
): Promise<void> {
  let i = 0;
  const workers: Promise<void>[] = [];
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  }
  for (let w = 0; w < Math.min(limit, items.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
}

/**
 * Run a set of parallel tasks with a concurrency limiter.
 *
 * @param tasks   The list of parallel sub-tasks to run.
 * @param options Concurrency limits and lifecycle hooks.
 * @param runOne  Async function that executes one task and returns its output string.
 * @returns       An array of ParallelResult in the same order as the input tasks.
 */
export async function runParallel(
  tasks: ParallelTask[],
  options: ParallelRunOptions,
  runOne: (task: ParallelTask, index: number, signal?: AbortSignal) => Promise<string>
): Promise<ParallelResult[]> {
  // Effective concurrency = min(requested, hard ceiling, global cap)
  const effectiveConcurrency = Math.min(
    options.concurrency ?? 5,
    options.maxConcurrency ?? 10,
    options.maxInFlightChildren ?? Infinity
  );

  // Pre-allocate results array so indices are stable regardless of completion order
  const results: ParallelResult[] = new Array(tasks.length);

  // Create an internal AbortController for failFast sibling cancellation
  const failFastController = options.failFast ? new AbortController() : null;

  // Determine the signal to pass to each runOne call:
  // prefer failFast signal if available, else parent signal
  const runSignal = failFastController?.signal ?? options.signal;

  await runWithConcurrency(tasks, effectiveConcurrency, async (task, idx) => {
    try {
      const output = await runOne(task, idx, runSignal);
      results[idx] = { index: idx, output, status: 'ok' };
    } catch (err) {
      results[idx] = {
        index: idx,
        output: `[BLOCKED:ERROR] from agent "${task.agent ?? 'unknown'}": ${err instanceof Error ? err.message : String(err)}`,
        status: 'error',
      };
      // Abort siblings on first error (only if failFast is enabled)
      if (failFastController) failFastController.abort();
    }

    // Notify caller of completion (fire-and-forget; no-op if not provided)
    options.onUpdate?.(idx, { type: 'done' });
  });

  return results;
}
