/**
 * Conformance tests for the process-wide spawn pool (Findings B4/C4, SPEC §9)
 *
 * Verifies:
 *   - Semaphore enforces a hard in-flight ceiling and grants permits FIFO
 *   - Semaphore releases permits even when the wrapped fn rejects
 *   - withSpawnSlot is a passthrough when no cap is configured
 *   - withSpawnSlot enforces the GLOBAL cap across independent concurrent callers
 *   - configureSpawnPool is idempotent for an unchanged value and disables on 0/undefined
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  Semaphore,
  configureSpawnPool,
  withSpawnSlot,
  getConfiguredSpawnCap,
  __resetSpawnPoolForTests,
} from '../../src/parent/spawn-pool.js';

beforeEach(() => {
  __resetSpawnPoolForTests();
});

// ── Semaphore primitive ───────────────────────────────────────────────────────

describe('Semaphore', () => {
  it('never exceeds the configured max in-flight', async () => {
    const sem = new Semaphore(2);
    let current = 0;
    let observedMax = 0;

    const task = async () => {
      current++;
      observedMax = Math.max(observedMax, current);
      await new Promise((r) => setTimeout(r, 5));
      current--;
      return 'ok';
    };

    await Promise.all(Array.from({ length: 8 }, () => sem.run(task)));
    expect(observedMax).toBeLessThanOrEqual(2);
  });

  it('grants queued permits in FIFO order', async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];

    // Kick off in order; with max=1 they must execute strictly serially in order.
    const ps = [0, 1, 2, 3].map((n) =>
      sem.run(async () => {
        order.push(n);
        await new Promise((r) => setTimeout(r, 1));
      }),
    );
    await Promise.all(ps);
    expect(order).toEqual([0, 1, 2, 3]);
  });

  it('releases the permit even when fn rejects', async () => {
    const sem = new Semaphore(1);

    await expect(sem.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');

    // If the permit had leaked, this second run would hang forever.
    const result = await sem.run(async () => 'recovered');
    expect(result).toBe('recovered');
    expect(sem.active).toBe(0);
    expect(sem.waiting).toBe(0);
  });

  it('clamps a non-positive max to at least 1 (no deadlock)', async () => {
    const sem = new Semaphore(0);
    const result = await sem.run(async () => 'ran');
    expect(result).toBe('ran');
  });
});

// ── withSpawnSlot / configureSpawnPool ────────────────────────────────────────

describe('withSpawnSlot', () => {
  it('passes through unbounded when no cap is configured', async () => {
    // No configureSpawnPool call → unlimited.
    let current = 0;
    let observedMax = 0;
    const task = async () => {
      current++;
      observedMax = Math.max(observedMax, current);
      await new Promise((r) => setTimeout(r, 5));
      current--;
      return 'ok';
    };

    await Promise.all(Array.from({ length: 6 }, () => withSpawnSlot(task)));
    // With no cap, all 6 can be in flight at once.
    expect(observedMax).toBe(6);
  });

  it('enforces a GLOBAL cap across independent concurrent callers (B4/C4)', async () => {
    configureSpawnPool(2);
    let current = 0;
    let observedMax = 0;
    const task = async () => {
      current++;
      observedMax = Math.max(observedMax, current);
      await new Promise((r) => setTimeout(r, 5));
      current--;
      return 'ok';
    };

    // Simulate two independent "delegate" calls each fanning out 4 children.
    const callA = Promise.all(Array.from({ length: 4 }, () => withSpawnSlot(task)));
    const callB = Promise.all(Array.from({ length: 4 }, () => withSpawnSlot(task)));
    await Promise.all([callA, callB]);

    // Across BOTH calls, never more than 2 children in flight at once.
    expect(observedMax).toBeLessThanOrEqual(2);
  });

  it('surfaces fn rejection without adding its own error', async () => {
    configureSpawnPool(1);
    await expect(withSpawnSlot(async () => { throw new Error('child failed'); }))
      .rejects.toThrow('child failed');
    // Slot must be released so the next call proceeds.
    await expect(withSpawnSlot(async () => 'next')).resolves.toBe('next');
  });
});

describe('configureSpawnPool', () => {
  it('disables the cap for undefined / 0 / negative / non-finite', () => {
    configureSpawnPool(undefined);
    expect(getConfiguredSpawnCap()).toBeUndefined();
    configureSpawnPool(0);
    expect(getConfiguredSpawnCap()).toBeUndefined();
    configureSpawnPool(-3);
    expect(getConfiguredSpawnCap()).toBeUndefined();
    configureSpawnPool(Number.NaN);
    expect(getConfiguredSpawnCap()).toBeUndefined();
  });

  it('records a positive integer cap', () => {
    configureSpawnPool(4);
    expect(getConfiguredSpawnCap()).toBe(4);
  });

  it('floors a fractional cap', () => {
    configureSpawnPool(3.9);
    expect(getConfiguredSpawnCap()).toBe(3);
  });

  it('is idempotent for an unchanged value (does not reset live state)', async () => {
    configureSpawnPool(1);
    let releaseFirst!: () => void;
    const gate = new Promise<void>((r) => { releaseFirst = r; });

    // Occupy the single slot.
    const held = withSpawnSlot(async () => { await gate; return 'held'; });

    // Queue a second task; it must wait behind the held one.
    let secondRan = false;
    const queued = withSpawnSlot(async () => { secondRan = true; return 'queued'; });

    // Re-configure with the SAME cap — must NOT create a fresh semaphore that
    // would let the queued task jump the (still-occupied) slot.
    configureSpawnPool(1);
    await Promise.resolve();
    expect(secondRan).toBe(false);

    releaseFirst();
    await Promise.all([held, queued]);
    expect(secondRan).toBe(true);
  });
});
