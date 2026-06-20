/**
 * Singleton registry of active AbortController instances (Task 23)
 *
 * Used by the /delegate command to coordinate cancellation of in-flight delegations.
 */

const active = new Set<AbortController>();

export const cancelRegistry = {
  register(ac: AbortController): void {
    active.add(ac);
  },
  unregister(ac: AbortController): void {
    active.delete(ac);
  },
  abortAll(): void {
    active.forEach(ac => ac.abort());
    active.clear();
  },
};
