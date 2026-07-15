import assert from "node:assert/strict";
import test from "node:test";

import { AcceptanceLedger } from "../acceptance";
import {
  createToolReceipt,
  ReceiptRegistry,
} from "../receipts/registry";
import { createRunPolicySet } from "./registry";

test("dynamically activated PPT skill upgrades contract and projectors", () => {
  const policy = createRunPolicySet({
    activeSkillNames: [],
    prompt: "制作一个 8 页 PPT",
  });

  assert.equal(policy.getDeliverableContract([]).textOnly, true);
  assert.equal(
    policy.getDeliverableContract(["html-to-pptx"]).type,
    "pptx",
  );
  assert.equal(policy.getReceiptProjectors([]).length, 0);
  assert.equal(policy.getReceiptProjectors(["html-to-pptx"]).length, 1);
});

test("explicit workspace changes get objective file and command criteria", () => {
  const policy = createRunPolicySet({
    activeSkillNames: [],
    prompt: "修复项目代码并运行测试验证结果",
  });
  const contract = policy.getDeliverableContract([]);

  assert.equal(contract.type, "workspace-artifact");
  assert.deepEqual(
    contract.criteria.map((criterion) => criterion.kind),
    ["file", "command"],
  );
  assert.equal(
    createRunPolicySet({
      activeSkillNames: [],
      prompt: "如何修复项目代码？",
    }).getDeliverableContract([]).textOnly,
    true,
  );

  const registry = new ReceiptRegistry();
  const acceptance = new AcceptanceLedger(contract);
  for (const [id, name, input, result] of [
    [
      "write",
      "write_file",
      { content: "export const value = 1;", path: "src/value.ts" },
      "written",
    ],
    [
      "observe",
      "run_terminal",
      { command: "pwd" },
      "exit_code: 0\ntimed_out: false\nstdout: /workspace",
    ],
  ] as const) {
    registry.record(
      createToolReceipt({
        endedAt: 2,
        result,
        startedAt: 1,
        success: true,
        toolCall: { id, input, inputComplete: true, name, type: "tool_use" },
      }),
    );
  }
  acceptance.reconcile(registry.snapshot());
  assert.ok(acceptance.snapshot().gap.some((gap) => /verification/.test(gap)));
  registry.record(
    createToolReceipt({
      endedAt: 4,
      result: "exit_code: 0\ntimed_out: false\nstdout: tests passed",
      startedAt: 3,
      success: true,
      toolCall: {
        id: "test",
        input: { command: "npm test" },
        inputComplete: true,
        name: "run_terminal",
        type: "tool_use",
      },
    }),
  );
  acceptance.reconcile(registry.snapshot());
  assert.deepEqual(acceptance.snapshot().gap, []);
});

test("static HTML requires a zero-warning validation receipt", () => {
  const policy = createRunPolicySet({
    activeSkillNames: ["html"],
    prompt: "创建一个静态网页",
  });
  const contract = policy.getDeliverableContract(["html"]);
  const registry = new ReceiptRegistry();
  const acceptance = new AcceptanceLedger(contract);
  const receipt = createToolReceipt({
    endedAt: 2,
    projectors: policy.getReceiptProjectors(["html"]),
    result:
      "已验证 static HTML 产物。\nQA：site/qa-report.json\n预览：site/preview/desktop.png, site/preview/mobile.png\nwarning：0",
    startedAt: 1,
    success: true,
    toolCall: {
      id: "html-validate",
      input: { html: "site/index.html" },
      inputComplete: true,
      name: "validate_static_html",
      type: "tool_use",
    },
  });
  registry.record(receipt);

  acceptance.reconcile(registry.snapshot());
  assert.deepEqual(acceptance.snapshot().gap, []);
  assert.equal(
    registry.snapshot().artifacts["static-html:site/index.html"]?.status,
    "validated",
  );
});
