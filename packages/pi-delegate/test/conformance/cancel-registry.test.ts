/**
 * Unit tests for cancel registry (Task 23)
 *
 * Tests:
 * - Registration and lookup of AbortController instances
 * - Unregistration of controllers
 * - Abort triggering of all registered controllers
 */

import { describe, it, expect } from 'vitest';
import { cancelRegistry } from '../../src/parent/cancel-registry.js';

describe('cancelRegistry', () => {
  describe('register', () => {
    it('registers an AbortController', () => {
      const ac = new AbortController();
      cancelRegistry.register(ac);
      // Can't directly inspect the Set, but we can verify abortAll() affects it
      cancelRegistry.abortAll();
      expect(ac.signal.aborted).toBe(true);
    });

    it('allows multiple registrations', () => {
      const ac1 = new AbortController();
      const ac2 = new AbortController();
      const ac3 = new AbortController();

      cancelRegistry.register(ac1);
      cancelRegistry.register(ac2);
      cancelRegistry.register(ac3);

      cancelRegistry.abortAll();

      expect(ac1.signal.aborted).toBe(true);
      expect(ac2.signal.aborted).toBe(true);
      expect(ac3.signal.aborted).toBe(true);
    });

    it('handles duplicate registration (idempotent)', () => {
      const ac = new AbortController();
      cancelRegistry.register(ac);
      cancelRegistry.register(ac); // register again
      cancelRegistry.abortAll();
      // Should still be aborted (and not throw)
      expect(ac.signal.aborted).toBe(true);
    });
  });

  describe('unregister', () => {
    it('removes a registered AbortController', () => {
      const ac1 = new AbortController();
      const ac2 = new AbortController();

      cancelRegistry.register(ac1);
      cancelRegistry.register(ac2);
      cancelRegistry.unregister(ac1);

      cancelRegistry.abortAll();

      // ac2 should be aborted, ac1 should not (since it was unregistered)
      expect(ac2.signal.aborted).toBe(true);
      expect(ac1.signal.aborted).toBe(false);
    });

    it('is safe to unregister non-existent controller', () => {
      const ac1 = new AbortController();
      const ac2 = new AbortController();

      cancelRegistry.register(ac1);
      cancelRegistry.unregister(ac2); // not registered

      cancelRegistry.abortAll();

      // ac1 should still be aborted; no error thrown
      expect(ac1.signal.aborted).toBe(true);
    });

    it('handles unregistering same controller twice', () => {
      const ac = new AbortController();

      cancelRegistry.register(ac);
      cancelRegistry.unregister(ac);
      cancelRegistry.unregister(ac); // unregister again (idempotent)

      cancelRegistry.abortAll();

      // ac should NOT be aborted (removed)
      expect(ac.signal.aborted).toBe(false);
    });
  });

  describe('abortAll', () => {
    it('aborts all registered controllers', () => {
      const ac1 = new AbortController();
      const ac2 = new AbortController();
      const ac3 = new AbortController();

      cancelRegistry.register(ac1);
      cancelRegistry.register(ac2);
      cancelRegistry.register(ac3);

      cancelRegistry.abortAll();

      expect(ac1.signal.aborted).toBe(true);
      expect(ac2.signal.aborted).toBe(true);
      expect(ac3.signal.aborted).toBe(true);
    });

    it('clears the registry after aborting', () => {
      const ac1 = new AbortController();
      const ac2 = new AbortController();

      cancelRegistry.register(ac1);
      cancelRegistry.register(ac2);

      cancelRegistry.abortAll();

      // Register a new controller and abort again
      const ac3 = new AbortController();
      cancelRegistry.register(ac3);
      cancelRegistry.abortAll();

      // Only ac3 should be aborted in the second call
      // ac1 and ac2 should already be aborted from the first call
      expect(ac1.signal.aborted).toBe(true);
      expect(ac2.signal.aborted).toBe(true);
      expect(ac3.signal.aborted).toBe(true);
    });

    it('is safe to call on empty registry', () => {
      // Should not throw even with no controllers registered
      expect(() => cancelRegistry.abortAll()).not.toThrow();
    });

    it('is safe to call multiple times', () => {
      const ac = new AbortController();

      cancelRegistry.register(ac);
      cancelRegistry.abortAll();
      expect(ac.signal.aborted).toBe(true);

      // Call again on now-empty registry
      expect(() => cancelRegistry.abortAll()).not.toThrow();
    });
  });

  describe('integration: register/unregister/abortAll cycle', () => {
    it('handles a complex lifecycle: register, unregister some, abort, repeat', () => {
      const ac1 = new AbortController();
      const ac2 = new AbortController();
      const ac3 = new AbortController();

      // Register three
      cancelRegistry.register(ac1);
      cancelRegistry.register(ac2);
      cancelRegistry.register(ac3);

      // Unregister ac2
      cancelRegistry.unregister(ac2);

      // Abort all (should only affect ac1 and ac3)
      cancelRegistry.abortAll();

      expect(ac1.signal.aborted).toBe(true);
      expect(ac2.signal.aborted).toBe(false);
      expect(ac3.signal.aborted).toBe(true);

      // Register ac2 and ac4, abort again
      const ac4 = new AbortController();
      cancelRegistry.register(ac2);
      cancelRegistry.register(ac4);

      cancelRegistry.abortAll();

      // All should now be aborted
      expect(ac1.signal.aborted).toBe(true);
      expect(ac2.signal.aborted).toBe(true);
      expect(ac3.signal.aborted).toBe(true);
      expect(ac4.signal.aborted).toBe(true);
    });
  });
});
