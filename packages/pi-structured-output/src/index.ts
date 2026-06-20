import { writeFile } from 'fs/promises';

interface PiExtensionContext {
  registerTool(
    name: string,
    schema: {
      description: string;
      parameters: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
      };
    },
    handler: (params: unknown) => Promise<string>
  ): void;
}

interface PiExtension {
  activate(pi: PiExtensionContext): void;
}

const STRUCTURED_OUTPUT_TOOL_SCHEMA = {
  description: 'Call this tool when you have completed the task and have a result that matches the provided output schema. Write your complete, structured result as the "output" property.',
  parameters: {
    type: 'object' as const,
    properties: {
      output: {
        type: 'object',
        description: 'Your result object matching the output schema.'
      }
    },
    required: ['output']
  }
};

async function handleStructuredOutput(params: unknown): Promise<string> {
  const outputFile = process.env.PI_OUTPUT_FILE;
  if (!outputFile) {
    return '[structured_output] Error: PI_OUTPUT_FILE not set — cannot write output';
  }

  const payload = params && typeof params === 'object' && 'output' in params
    ? (params as { output: unknown }).output
    : params;

  try {
    await writeFile(outputFile, JSON.stringify(payload, null, 2), { encoding: 'utf-8' });
    return '[structured_output] Output written successfully.';
  } catch (err) {
    return `[structured_output] Error writing output: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function activate(pi: PiExtensionContext): void {
  const schema = process.env.PI_OUTPUT_SCHEMA;
  if (!schema) {
    // No schema configured — don't register the tool
    return;
  }
  pi.registerTool('structured_output', STRUCTURED_OUTPUT_TOOL_SCHEMA, handleStructuredOutput);
}

export default { activate } as PiExtension;
