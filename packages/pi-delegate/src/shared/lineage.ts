/**
 * Lineage path management and cycle detection (Task 12)
 *
 * The lineage path tracks which agents have been invoked in the current
 * delegation chain. It is passed as a colon-separated string via the
 * PI_DELEGATE_PATH environment variable.
 */

import type { NestedPathEntry } from './types.js';

export const LINEAGE_PATH_SEPARATOR = ':';
export const LINEAGE_PATH_CAP = 50; // max entries in the lineage path

// ── Sanitization ──────────────────────────────────────────────────────────────

/**
 * Sanitize an agent name before encoding it into the lineage path.
 * Strips colons (separators), slashes (path traversal risk), and
 * double-dots (parent traversal), then caps at 64 characters.
 */
export function sanitizeAgentName(name: string): string {
  return name
    .replace(/:/g, '_')     // colons are separators
    .replace(/\//g, '_')    // slashes are path traversal risk
    .replace(/\.\./g, '_')  // parent traversal
    .slice(0, 64);           // cap length
}

// ── Encoding / decoding ───────────────────────────────────────────────────────

/**
 * Encode an array of agent name strings into a colon-separated lineage path.
 * Each name is sanitized before encoding.
 */
export function encodeLineagePath(entries: string[]): string {
  return entries.map(sanitizeAgentName).join(LINEAGE_PATH_SEPARATOR);
}

/**
 * Decode a raw colon-separated lineage path string into an array of agent names.
 * Returns an empty array for empty/whitespace-only input.
 */
export function decodeLineagePath(raw: string): string[] {
  if (!raw || raw.trim() === '') return [];
  return raw.split(LINEAGE_PATH_SEPARATOR).filter(Boolean);
}

// ── Cycle detection ───────────────────────────────────────────────────────────

/**
 * Detect whether an agent would create a cycle in the delegation chain.
 * Returns true if the sanitized agent name already appears in currentPath.
 */
export function detectCycle(agentName: string, currentPath: string[]): boolean {
  const sanitized = sanitizeAgentName(agentName);
  return currentPath.some(entry => entry === sanitized);
}

// ── Path manipulation ─────────────────────────────────────────────────────────

/**
 * Append an agent name to the current path, returning a new array.
 */
export function appendToPath(currentPath: string[], agentName: string): string[] {
  return [...currentPath, sanitizeAgentName(agentName)];
}

/**
 * Check whether the lineage path has reached the maximum allowed length.
 */
export function isPathAtCap(currentPath: string[]): boolean {
  return currentPath.length >= LINEAGE_PATH_CAP;
}

// Re-export NestedPathEntry so consumers can import from a single lineage module
export type { NestedPathEntry };
