/**
 * Process-wide spawn concurrency semaphore for pi-delegate (finding B4).
 *
 * A single delegation call can fan out many child `pi` processes (via the
 * `parallel` mode in `parallel.ts`), and nested delegations can fan out further.
 * `runParallel`'s own concurrency limiter only bounds the siblings of ONE
 * `runParallel` call — it does not bound the total number of `pi` children alive
 * across the whole process. `config.maxInFlightChildren` exists to cap that
 * global total.
 *
 * This module provides a process-wide async semaphore so that both:
 *   - `spawn.ts` (wrapping each `spawnRun` call), and
 *   - `parallel.ts` (T2.2 — wrapping each worker slot),
 * acquire from the SAME pool when they share the same `maxInFlight` value.
 *
 * Design notes:
 *   - Semaphores are keyed by their limit value, so every caller passing the
 *     same `maxInFlightChildren` contends over one shared pool. (In practice the
 *     value comes from a single `config`, so all callers pass the same number.)
 *   - `maxInFlight` of `undefined`, `null`, `0`, or anything `<= 0` means "no
 *     cap": `acquireSpawnSlot` resolves immediately with a no-op release.
 *   - Waiters are served strictly FIFO to avoid starvation.
 *   - The returned `release` function is idempotent: calling it more than once
 *     frees at most one slot, so a double-release (e.g. from both a `finally`
 *     and an error path) cannot corrupt the counter.
 */

/** Internal counting-semaphore state for a single limit value. */
interface Semaphore {
  /** Maximum number of concurrently-held slots. */
  readonly limit: number;
  /** Number of slots currently held (0..limit). */
  inUse: number;
  /** FIFO queue of waiters blocked until a slot frees up. */
  readonly waiters: Array<() => void>;
}

/**
 * Registry of semaphores keyed by limit value. Module-level so the pool is
 * process-wide: every importer of this module shares these instances.
 */
const semaphores = new Map<number, Semaphore>();

/** No-op release used when there is no concurrency cap. */
const NOOP_RELEASE = (): void => {
  /* nothing to release — there was no slot to begin with */
};

/**
 * Get (or lazily create) the shared semaphore for a given positive limit.
 */
function getSemaphore(limit: number): Semaphore {
  let sem = semaphores.get(limit);
  if (!sem) {
    sem = { limit, inUse: 0, waiters: [] };
    semaphores.set(limit, sem);
  }
  return sem;
}

/**
 * Acquire a spawn slot from the process-wide pool.
 *
 * @param maxInFlight - Global cap on concurrent children. `undefined`/`null`/`0`
 *                      (or any value `<= 0`) means unlimited — resolves at once.
 * @returns A `release` function. The caller MUST call it exactly once when the
 *          spawn finishes (success, error, or timeout), typically from a
 *          `finally` block. Extra calls are safe no-ops.
 */
export function acquireSpawnSlot(
  maxInFlight: number | undefined | null,
): Promise<() => void> {
  // No cap: resolve immediately with a no-op release.
  if (maxInFlight == null || !Number.isFinite(maxInFlight) || maxInFlight <= 0) {
    return Promise.resolve(NOOP_RELEASE);
  }

  const limit = Math.floor(maxInFlight);
  const sem = getSemaphore(limit);

  return new Promise<() => void>((resolve) => {
    /**
     * Build an idempotent release bound to this specific acquisition.
     * `released` guards against double-free.
     */
    const makeRelease = (): (() => void) => {
      let released = false;
      return () => {
        if (released) return;
        released = true;
        // Hand the freed slot directly to the next waiter (keeps inUse pinned
        // at `limit` while there is demand) or decrement if no one is waiting.
        const next = sem.waiters.shift();
        if (next) {
          next();
        } else {
          sem.inUse -= 1;
        }
      };
    };

    if (sem.inUse < sem.limit) {
      sem.inUse += 1;
      resolve(makeRelease());
    } else {
      // No free slot — queue a waiter that grabs the slot when released.
      sem.waiters.push(() => resolve(makeRelease()));
    }
  });
}

/**
 * Test/diagnostic helper: current number of held slots for a given limit.
 * Returns 0 if no semaphore has been created for that limit yet.
 */
export function inFlightCount(maxInFlight: number | undefined | null): number {
  if (maxInFlight == null || !Number.isFinite(maxInFlight) || maxInFlight <= 0) {
    return 0;
  }
  return semaphores.get(Math.floor(maxInFlight))?.inUse ?? 0;
}
