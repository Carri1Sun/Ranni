import { createResearchNotebook, type ResearchNotebook } from "../research";
import { createTaskMemory, type TaskMemory } from "../task-memory";

export type AgentRuntimeServices = {
  researchNotebook: ResearchNotebook;
  taskMemory: TaskMemory;
};

export function createAgentRuntimeServices({
  latestUserPrompt,
  runId,
  workspaceRoot,
}: {
  latestUserPrompt: string;
  runId: string;
  workspaceRoot?: string;
}): AgentRuntimeServices {
  return {
    researchNotebook: createResearchNotebook({
      latestUserPrompt,
      runId,
      workspaceRoot,
    }),
    taskMemory: createTaskMemory({
      latestUserPrompt,
      runId,
      workspaceRoot,
    }),
  };
}
