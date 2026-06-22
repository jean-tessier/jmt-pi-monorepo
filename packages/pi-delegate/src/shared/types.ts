/**
 * Shared TypeScript types for the pi-delegate system
 */

/**
 * Context passed between the parent extension and spawn/stream functions
 */
export interface DelegationContext {
  taskId: string;           // unique ID for this delegation run
  agentName: string;        // name of the agent definition being invoked
  depth: number;            // current nesting depth (0 = top-level)
  maxDepth: number;         // max allowed depth
  lineagePath: string;      // PI_DELEGATE_PATH value (colon-separated agent names)
  signal?: AbortSignal;     // cancellation signal from parent
}

/**
 * A single entry in the lineage path (used by lineage.ts in Task 12)
 */
export interface NestedPathEntry {
  agentName: string;
  taskId: string;
}

/**
 * An agent definition loaded from a .md file (used by agents.ts in Task 3)
 */
export interface AgentDefinition {
  name: string;           // agent identity (from filename or frontmatter)
  filePath: string;       // absolute path to the .md file
  description?: string;   // from frontmatter
  model?: string;         // from frontmatter
  tools?: string[];       // from frontmatter (tool allowlist)
  systemPrompt?: string;  // from frontmatter or body
  outputSchema?: object;  // from frontmatter (JSON Schema object)
  delegateAgents?: string[]; // allowlist of agents this agent may delegate to
  maxDepth?: number;      // agent-specific max depth override
}

/**
 * Status of a single delegate run
 */
export type RunStatus =
  | 'ok'
  | 'depth_blocked'
  | 'cycle_detected'
  | 'tool_not_permitted'
  | 'schema_invalid'
  | 'timeout'
  | 'error';

/**
 * Result of a single delegate run
 */
export interface RunResult {
  status: RunStatus;
  agentName: string;
  taskId: string;
  output?: string;          // final text output from agent_end/message_end
  structuredOutput?: unknown; // validated JSON output (when outputSchema used)
  error?: string;           // error message for non-ok statuses
  durationMs?: number;      // wall-clock time
}

/**
 * One item in a parallel fan-out
 */
export interface ParallelTask {
  task: string;             // the task description/prompt
  agent?: string;           // which agent definition to use
  model?: string;           // per-task model override
  tools?: string[] | string; // per-task tool allowlist override
  prompt?: string;          // per-task system prompt (replaces agent def's prompt)
  promptMode?: 'replace' | 'append'; // how prompt interacts with agent def's prompt
  outputSchema?: object;    // per-task schema override
}

/**
 * Discriminated union for the delegate tool's input (single OR parallel, never both)
 */
export type DelegateToolParams =
  | {
      task: string;          // single task description
      agent?: string;
      outputSchema?: object;
      model?: string;              // per-call model override
      tools?: string[];            // per-call tool allowlist override
      prompt?: string;             // per-call system prompt (replaces agent def's prompt)
      promptMode?: 'replace' | 'append'; // how prompt interacts with agent def's prompt
      parallel?: never;
    }
  | {
      parallel: ParallelTask[]; // array of parallel tasks
      concurrency?: number;
      failFast?: boolean;        // abort siblings on first error
      task?: never;
      agent?: never;
      outputSchema?: never;
    };

/**
 * Configuration loaded from config.json
 */
export interface DelegateConfig {
  maxDepth: number;         // default 2
  piBinaryPath?: string;    // override path to pi binary
  runTimeoutMs?: number;    // per-run wall-clock timeout
  maxInFlightChildren?: number; // global concurrency cap
  sandboxCommand?: string;  // optional sandbox wrapper (e.g. 'bwrap')
  childCwd?: string;        // override child working directory; default: temp run dir
}
