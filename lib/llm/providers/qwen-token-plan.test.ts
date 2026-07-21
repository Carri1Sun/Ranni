import assert from "node:assert/strict";
import test from "node:test";

import { qwenTokenPlanProvider } from "./qwen-token-plan";

const QWEN_TOKEN_PLAN_DEFAULT_BASE_URL =
  "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1";

function withCleanEnv(names: string[], run: () => void) {
  const originals = new Map(names.map((name) => [name, process.env[name]]));

  for (const name of names) {
    delete process.env[name];
  }

  try {
    run();
  } finally {
    for (const [name, value] of originals) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

test("uses token plan defaults and provider-specific env overrides", () => {
  withCleanEnv(
    [
      "LLM_BASE_URL",
      "LLM_CONTEXT_WINDOW",
      "LLM_MODEL",
      "QWEN_TOKEN_PLAN_BASE_URL",
      "QWEN_TOKEN_PLAN_MODEL",
    ],
    () => {
      const runtime = qwenTokenPlanProvider.getRuntimeInfo(undefined);
      assert.equal(runtime.provider, "qwen-token-plan");
      assert.equal(runtime.baseUrl, QWEN_TOKEN_PLAN_DEFAULT_BASE_URL);
      assert.equal(runtime.contextWindow, 262_144);
      assert.equal(runtime.model, "qwen3.7-max");

      process.env.LLM_BASE_URL = "https://ignored.example.com";
      process.env.LLM_MODEL = "ignored-model";
      process.env.QWEN_TOKEN_PLAN_MODEL = "qwen3.8-max-preview";

      const overridden = qwenTokenPlanProvider.getRuntimeInfo(undefined);
      assert.equal(overridden.baseUrl, QWEN_TOKEN_PLAN_DEFAULT_BASE_URL);
      assert.equal(overridden.model, "qwen3.8-max-preview");
    },
  );
});

test("accepts the provider-specific key field and env key", () => {
  withCleanEnv(["LLM_API_KEY", "QWEN_TOKEN_PLAN_KEY"], () => {
    assert.equal(qwenTokenPlanProvider.hasApiKey(undefined), false);
    assert.equal(
      qwenTokenPlanProvider.hasApiKey({ qwenTokenPlanKey: "sk-test" }),
      true,
    );

    process.env.QWEN_TOKEN_PLAN_KEY = "sk-env";
    assert.equal(qwenTokenPlanProvider.hasApiKey(undefined), true);
  });
});
