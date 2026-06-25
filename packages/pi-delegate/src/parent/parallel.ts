/**
 * Parallel fan-out for pi-delegate (Task 10)
 *
 * Runs an array of ParallelTask items concurrently with a semaphore-style
 * concurrency limiter. Results are returned in input order (index-stable).
 * One failure does not cancel the remaining tasks (partial tolerance).
 */

import type { ParallelTask } from '../shared/types.js';
import { configureSpawnPool, withSpawnSlot } from './spawn-pool.js';

export interface ParallelRunOptions {
  concurrency?: number;         // max concurrent runs (default: 5)
  maxConcurrency?: number;      // hard ceiling (default: 10)
  /**
   * @deprecated Finding B4/C4: the global in-flight child cap is now enforced
   * process-wide via the spawn-pool semaphore (configureSpawnPool / withSpawnSlot),
   * NOT folded into this per-call concurrency number. Kept in the interface for
   * backward source-compat; it is intentionally ignored by runParallel().
   */
  maxInFlightChildren?: number;
  failFast?: boolean;           // abort siblings on first error (default: false)
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
 *
 * Every item is always handed to `fn` so the caller's index-stable results array
 * is fully populated with a labeled string for each index (never-throw contract).
 * Finding B2's "stop spawning after cancel" is handled INSIDE `fn`: once the run
 * signal is aborted, `fn` records a cheap blocked result instead of spawning a
 * child, so we never start children only to immediately kill them.
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
  // Finding B4/C4: configure the process-wide spawn-pool cap from the config
  // value carried in on options.maxInFlightChildren. configureSpawnPool is
  // idempotent for an unchanged value, so concurrent delegate calls don't reset
  // live state. The single-task path (spawn.ts, T2.1) shares this same pool.
  configureSpawnPool(options.maxInFlightChildren);

  // Finding B3: clamp effective per-call concurrency to a sane positive integer.
  // A requested concurrency of 0 (or negative/NaN) would otherwise start zero
  // workers and silently hang. Math.max(1, ...) guarantees at least one worker.
  // Finding B4/C4: maxInFlightChildren is NO LONGER folded in here — the global
  // in-flight cap is enforced process-wide by the spawn-pool semaphore around
  // each child spawn (see withSpawnSlot below), not by shrinking this number.
  // Guard against NaN/non-finite before clamping: NaN propagates through both
  // Math.min and Math.max (IEEE 754), so a NaN concurrency would produce zero
  // workers and silently hang. Treat NaN (or any non-finite value) as "use
  // default (5)" before clamping.
  const requested = options.concurrency;
  const safe = (typeof requested === 'number' && isFinite(requested)) ? requested : 5;
  const ceiling = options.maxConcurrency ?? 10;
  const effectiveConcurrency = Math.max(1, Math.min(safe, ceiling));

  // Pre-allocate results array so indices are stable regardless of completion order
  const results: ParallelResult[] = new Array(tasks.length);

  // Create an internal AbortController for failFast sibling cancellation
  const failFastController = options.failFast ? new AbortController() : null;

  // Finding B1: when failFast is on, compose the PARENT signal with the failFast
  // signal via AbortSignal.any() so a parent/tool cancel still reaches children
  // (previously the parent signal was dropped entirely under failFast). Without
  // failFast, just forward the parent signal as-is.
  let runSignal: AbortSignal | undefined;
  if (failFastController) {
    runSignal = options.signal
      ? AbortSignal.any([options.signal, failFastController.signal])
      : failFastController.signal;
  } else {
    runSignal = options.signal;
  }

  await runWithConcurrency(
    tasks,
    effectiveConcurrency,
    async (task, idx) => {
      // Finding B2: once the run signal is aborted (parent cancel OR failFast),
      // record a cheap blocked result instead of spawning a child only to kill
      // it. Every index still gets a labeled string, keeping the results array
      // fully populated and index-stable (never-throw contract).
      if (runSignal?.aborted) {
        results[idx] = {
          index: idx,
          output: `[BLOCKED:ERROR] from agent "${task.agent ?? 'unknown'}": cancelled before start`,
          status: 'error',
        };
        options.onUpdate?.(idx, { type: 'done' });
        return;
      }

      try {
        // Finding B4/C4: each child spawn draws from the process-wide spawn pool.
        // withSpawnSlot is a passthrough when no global cap is configured.
        const output = await withSpawnSlot(() => runOne(task, idx, runSignal));
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
    },
  );

  return results;
}
