import type { TaskStatePatch } from "./task-state";
import type { AgentToolUseBlock } from "./llm";

export { runAgentTurnController as runAgentTurn } from "./agent/run-controller";
export type {
  PlainMessage,
  RunAgentTurnOptions,
  RunAgentTurnResult,
  StepOutcome,
} from "./agent/types";
export {
  getHtmlToPptxToolDefinitions as getStepToolDefinitions,
  isToolAllowedForExecution,
} from "./html-to-pptx/artifact-policy";

/**
 * 兼容旧测试与调用方的纯函数；客观文件事实现在由 Receipt Registry 投影。
 */
export function keepObservedFileTouches(
  patch: TaskStatePatch | null,
  success: boolean,
) {
  if (!patch || success || !patch.filesTouched) return patch;
  const observedPatch = { ...patch };
  delete observedPatch.filesTouched;
  return observedPatch;
}

export function isUnsafeToolCall(toolCall: AgentToolUseBlock) {
  return !toolCall.inputComplete || Boolean(toolCall.inputParseError);
}
