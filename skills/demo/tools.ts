import { z } from "zod";

import type { ToolDefinition } from "../../lib/tools";

const demoEchoSchema = z.object({
  message: z.string().min(1).default("demo skill tool is active"),
});

export const tools: ToolDefinition[] = [
  {
    schema: demoEchoSchema,
    tool: {
      name: "demo_echo",
      description:
        "Echo a short message to confirm that the demo skill-specific tool was registered after the demo skill was activated.",
      input_schema: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "Short message to echo from the demo skill tool.",
          },
        },
      },
    },
    execute: async (rawArgs) => {
      const args = demoEchoSchema.parse(rawArgs);

      return `[demo-skill-tool] ${args.message}`;
    },
  },
];
