/**
 * Neutral module: exports registerDelegateTool for use by both the parent
 * extension and the child-side delegate-provider.
 *
 * This module exists so that delegate-provider/index.ts can import the
 * tool-registration function without importing from parent/index.ts (the
 * parent entry point), which would violate the "no cross-side entry-point
 * imports" invariant documented in AGENTS.md.
 *
 * Invariant: this module MUST NOT import from delegate-provider/ or from
 * parent/index.ts.  It only re-exports from parent/delegate-tool.ts.
 */

export { registerDelegateTool } from './delegate-tool.js';
