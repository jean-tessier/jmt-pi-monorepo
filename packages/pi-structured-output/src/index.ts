import { writeFile } from "node:fs/promises";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const schema = process.env.PI_OUTPUT_SCHEMA;
  if (!schema) {
    // No schema configured — don't register the tool
    return;
  }

  pi.registerTool({
    name: "structured_output",
    label: "Structured Output",
    description:
      "Call this tool when you have completed the task and have a result that matches the provided output schema. Write your complete, structured result as the 'output' property.",
    parameters: Type.Object({
      output: Type.Object(
        {},
        { description: "Your result object matching the output schema." },
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const outputFile = process.env.PI_OUTPUT_FILE;
      if (!outputFile) {
        return {
          content: [
            {
              type: "text",
              text: "[structured_output] Error: PI_OUTPUT_FILE not set — cannot write output",
            },
          ],
          details: {},
          isError: true,
        };
      }

      const payload =
        params && typeof params === "object" && "output" in params
          ? (params as { output: unknown }).output
          : params;

      try {
        await writeFile(outputFile, JSON.stringify(payload, null, 2), {
          encoding: "utf-8",
        });
        return {
          content: [
            {
              type: "text",
              text: "[structured_output] Output written successfully.",
            },
          ],
          details: {},
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `[structured_output] Error writing output: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          details: {},
          isError: true,
        };
      }
    },
  });
}