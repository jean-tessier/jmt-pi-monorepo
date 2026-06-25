/**
 * Process-wide spawn slot pool for pi-delegate (Findings B4/C4, SPEC §9)
 *
 * Provides a GLOBAL cap on the number of child `pi` processes in flight at any
 * one time, across ALL concurrent `delegate` tool calls in this process — not a
 * per-call limit. Both the single-task path (spawn.ts, owned by T2.1) and the
 * parallel fan-out path (parallel.ts, owned by T2.2) wrap each child spawn with
 * `withSpawnSlot()` so they draw from the same shared budget.
 *
 * ── Interface contract (coordination point with T2.1) ──────────────────────────
 *
 *   configureSpawnPool(maxInFlight: number | undefined): void
 *     Idempotently (re)configure the module-level semaphore. Called with the
 *     config value (config.maxInFlightChildren). Passing undefined / 0 / a
 *     non-positive / non-finite value disables the cap (unlimited). Re-calling
 *     with the same positive value is a no-op so concurrent callers don't reset
 *     live state mid-flight.
 *
 *   withSpawnSlot<T>(fn: () => Promise<T>): Promise<T>
 *     Acquire one slot, run `fn`, release the slot when `fn` settles (resolve OR
 *     reject). With no cap configured this is a straight passthrough. Slots are
 *     handed out in FIFO order to waiters. Adds no errors of its own — it only
 *     surfaces whatever `fn` does, preserving the package never-throw contract
 *     at the call sites that already wrap errors into labeled strings.
 *
 * The semaphore is module-level (singleton) on purpose: the cap is process-wide.
 */

/**
 * A minimal FIFO counting semaphore.
 *
 * `run()` acquires a permit before invoking `fn` and releases it once `fn`
 * settles, regardless of outcome. Permits are granted to queued waiters in the
 * order they arrived (FIFO), which keeps fan-out fair and avoids starvation.
 */
export class Semaphore {
  private readonly max: number;
  private inFlight = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(max: number) {
    // Defensive: a non-positive max would deadlock; clamp to at least 1.
    this.max = Math.max(1, Math.floor(max));
  }

  /** Number of permits currently held. Exposed for tests/introspection. */
  get active(): number {
    return this.inFlight;
  }

  /** Number of callers currently queued waiting for a permit. */
  get waiting(): number {
    return this.waiters.length;
  }

  private acquire(): Promise<void> {
    if (this.inFlight < this.max) {
      this.inFlight++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.inFlight++;
        resolve();
      });
    });
  }

  private release(): void {
    this.inFlight--;
    const next = this.waiters.shift();
    if (next) next();
  }

  /**
   * Acquire a permit, run `fn`, and release the permit when `fn` settles.
   * Re-throws whatever `fn` throws (after releasing) — adds no errors of its own.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

// ── Module-level singleton state ───────────────────────────────────────────────

let _semaphore: Semaphore | null = null;
let _configuredMax: number | undefined = undefined;

/**
 * Configure the process-wide spawn pool cap.
 *
 * @param maxInFlight - The global in-flight child cap (config.maxInFlightChildren).
 *                      Undefined / 0 / non-positive / non-finite disables the cap.
 *
 * Idempotent for an unchanged positive value so concurrent `delegate` calls that
 * each re-run config loading don't tear down a live semaphore mid-flight.
 */
export function configureSpawnPool(maxInFlight: number | undefined): void {
  const valid =
    typeof maxInFlight === 'number' && Number.isFinite(maxInFlight) && maxInFlight >= 1;

  if (!valid) {
    _semaphore = null;
    _configuredMax = undefined;
    return;
  }

  const normalized = Math.floor(maxInFlight);
  // No-op if already configured with the same cap (avoid resetting live state).
  if (_semaphore && _configuredMax === normalized) return;

  _semaphore = new Semaphore(normalized);
  _configuredMax = normalized;
}

/**
 * Run `fn` under one process-wide spawn slot.
 *
 * If no cap is configured this is a straight passthrough (no queuing overhead).
 * Otherwise it acquires a slot from the shared semaphore, runs `fn`, and releases
 * the slot when `fn` settles. The slot budget is shared across every concurrent
 * `delegate` call in this process.
 */
export async function withSpawnSlot<T>(fn: () => Promise<T>): Promise<T> {
  const sem = _semaphore;
  if (!sem) return fn(); // No cap configured → unlimited.
  return sem.run(fn);
}

/**
 * Introspection helper: returns the currently configured cap
 * (undefined when unlimited). Not part of the production call path.
 */
export function getConfiguredSpawnCap(): number | undefined {
  return _configuredMax;
}

/**
 * Test-only helper to reset module state between test cases.
 * Not used on the production path.
 */
export function __resetSpawnPoolForTests(): void {
  _semaphore = null;
  _configuredMax = undefined;
}
