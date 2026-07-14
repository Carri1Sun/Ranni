import assert from "node:assert/strict";
import test from "node:test";

import { minimaxTokenPlanProvider } from "./minimax-token-plan";

test("uses a 32K default and lets the provider-specific budget override the global budget", () => {
  const originalGlobal = process.env.LLM_MAX_TOKENS;
  const originalMiniMax = process.env.MINIMAX_TOKEN_PLAN_MAX_TOKENS;

  try {
    delete process.env.LLM_MAX_TOKENS;
    delete process.env.MINIMAX_TOKEN_PLAN_MAX_TOKENS;
    assert.equal(
      minimaxTokenPlanProvider.getRuntimeInfo(undefined).maxTokens,
      32_768,
    );

    process.env.LLM_MAX_TOKENS = "4096";
    process.env.MINIMAX_TOKEN_PLAN_MAX_TOKENS = "32768";
    assert.equal(
      minimaxTokenPlanProvider.getRuntimeInfo(undefined).maxTokens,
      32_768,
    );
  } finally {
    if (originalGlobal === undefined) {
      delete process.env.LLM_MAX_TOKENS;
    } else {
      process.env.LLM_MAX_TOKENS = originalGlobal;
    }
    if (originalMiniMax === undefined) {
      delete process.env.MINIMAX_TOKEN_PLAN_MAX_TOKENS;
    } else {
      process.env.MINIMAX_TOKEN_PLAN_MAX_TOKENS = originalMiniMax;
    }
  }
});
