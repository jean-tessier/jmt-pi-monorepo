/**
 * Result formatting helpers for pi-delegate (Task 19)
 *
 * Centralizes all result string formatting for delegate tool responses.
 * All errors are returned as labeled result strings — never thrown to the caller.
 */

export type ErrorCode =
  | 'INVALID_PARAMS'
  | 'DEPTH_BLOCKED'
  | 'CYCLE_DETECTED'
  | 'TOOL_NOT_PERMITTED'
  | 'SCHEMA_INVALID'
  | 'TIMEOUT'
  | 'ERROR';

export function formatBlockedResult(code: ErrorCode, message: string, agentName: string): string {
  return `[BLOCKED:${code}] from agent "${agentName}": ${message}`;
}

export function formatOkResult(agentName: string, output: string): string {
  return `from agent "${agentName}": ${output}`;
}

export function formatStructuredResult(agentName: string, output: unknown): string {
  return `from agent "${agentName}" (structured): ${JSON.stringify(output)}`;
}
