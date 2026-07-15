import assert from "node:assert/strict";
import test from "node:test";

import type { AgentToolUseBlock } from "../llm";
import {
  createHtmlToPptxDeliverableContract,
  projectHtmlToPptxReceipt,
} from "../html-to-pptx/artifact-policy";
import { AcceptanceLedger, createTextDeliverableContract } from "../acceptance";
import { ProgressTracker } from "../progress";
import { createToolReceipt, ReceiptRegistry } from "./registry";

function call(
  id: string,
  name: string,
  input: Record<string, unknown>,
): AgentToolUseBlock {
  return { id, input, inputComplete: true, name, type: "tool_use" };
}

function record(
  registry: ReceiptRegistry,
  toolCall: AgentToolUseBlock,
  result: string,
  success = true,
) {
  return registry.record(
    createToolReceipt({
      endedAt: 2,
      projectors: [projectHtmlToPptxReceipt],
      result,
      startedAt: 1,
      success,
      toolCall,
    }),
  );
}

test("terminal non-zero exit is a failed domain receipt", () => {
  const receipt = createToolReceipt({
    endedAt: 2,
    result: "exit_code: 2\ntimed_out: false\nstderr:\nfailed",
    startedAt: 1,
    success: true,
    toolCall: call("terminal", "run_terminal", { command: "npm test" }),
  });

  assert.equal(receipt.success, false);
  assert.equal(receipt.domainStatus, "failed");
  assert.equal(receipt.projection.commands?.[0]?.exitCode, 2);
});

test("completed toolUseId and input hash is reused without duplicate state", () => {
  const registry = new ReceiptRegistry();
  const toolCall = call("same", "search_web", { query: "GLM 5" });
  const first = record(registry, toolCall, "source result");
  const second = record(registry, toolCall, "source result");

  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(registry.snapshot().receipts.length, 1);
});

test("research receipts preserve real source URLs for handoff", () => {
  const registry = new ReceiptRegistry();
  record(
    registry,
    call("search", "search_web", { query: "GLM architecture" }),
    [
      "1. Official report",
      "URL: https://example.com/report",
      "摘要: architecture details",
      "",
      "2. Technical paper",
      "URL: https://example.org/paper",
      "摘要: training route",
    ].join("\n"),
  );
  record(
    registry,
    call("finding", "record_research_finding", {
      evidence: [
        {
          note: "primary source",
          title: "Model card",
          url: "https://model.example/card",
        },
      ],
      subquestion: "architecture",
      summary: "The model card documents the architecture.",
    }),
    "Research finding recorded.",
  );

  const sources = Object.values(registry.snapshot().evidence)
    .map((evidence) => evidence.source)
    .filter(Boolean)
    .sort();
  assert.deepEqual(sources, [
    "https://example.com/report",
    "https://example.org/paper",
    "https://model.example/card",
  ]);
});

test("file receipts preserve content identity and move source deletion", () => {
  const registry = new ReceiptRegistry();
  record(
    registry,
    call("write-1", "write_file", { content: "first", path: "draft.txt" }),
    "已写入 draft.txt，共 5 B。",
  );
  const firstHash = registry.snapshot().files["draft.txt"]?.hash;
  record(
    registry,
    call("write-2", "write_file", { content: "second", path: "draft.txt" }),
    "已写入 draft.txt，共 6 B。",
  );
  const secondHash = registry.snapshot().files["draft.txt"]?.hash;
  record(
    registry,
    call("move", "move_path", { from: "draft.txt", to: "final.txt" }),
    "已移动 draft.txt -> final.txt。",
  );
  const observed = registry.snapshot();

  assert.notEqual(firstHash, secondHash);
  assert.equal(observed.files["draft.txt"]?.deleted, true);
  assert.equal(observed.files["final.txt"]?.deleted, undefined);
});

test("eight validated slides and PPTX receipts close the acceptance gap", () => {
  const registry = new ReceiptRegistry();
  const acceptance = new AcceptanceLedger(
    createHtmlToPptxDeliverableContract("请制作 8 页 ppt"),
  );

  record(
    registry,
    call("manifest", "set_slide_manifest", {
      deckDir: "deck",
      slideIds: Array.from({ length: 8 }, (_, index) => `0${index + 1}`),
    }),
    "已固定 slide 页面清单。\n路径：deck/slide-manifest.json\n页面数：8",
  );
  record(
    registry,
    call("styles", "assemble_deck_styles", { deckDir: "deck" }),
    "已校验并原子组装全局 CSS。\n路径：deck/styles.css",
  );
  for (let index = 0; index < 8; index += 1) {
    record(
      registry,
      call(`slide-${index}`, "write_slide_fragment", {
        deckDir: "deck",
        slideId: `0${index + 1}`,
      }),
      `已保存 slide draft。\naccepted：deck/slides/0${index + 1}.html\nhash：hash-${index}`,
    );
  }
  record(
    registry,
    call("deck", "assemble_slide_deck", { deckDir: "deck" }),
    "已确定性组装 slide deck。\nHTML：deck/deck.html\n页面数：8",
  );
  record(
    registry,
    call("export", "export_html_to_pptx", {
      html: "deck/deck.prepared.html",
      outPptx: "deck/final/deck.pptx",
    }),
    "已通过 dom-to-pptx 导出 PPTX。\n路径：deck/final/deck.pptx",
  );
  record(
    registry,
    call("validate", "validate_html_pptx_export", {
      html: "deck/deck.html",
      pptx: "deck/final/deck.pptx",
    }),
    "已验证 HTML-to-PPTX spike 产物。\nQA：deck/qa-report.json\nslide 数：8",
  );

  const delta = acceptance.reconcile(registry.snapshot());
  assert.deepEqual(delta.gapAfter, []);
  assert.ok(delta.changed.every((change) => change.to === "passed"));
});

test("state-only and repeated observations do not count as objective progress", () => {
  const registry = new ReceiptRegistry();
  const acceptance = new AcceptanceLedger(
    createHtmlToPptxDeliverableContract("制作 8 页 ppt"),
  );
  const tracker = new ProgressTracker();

  acceptance.reconcile(registry.snapshot());
  const receipt = record(
    registry,
    call("state", "update_task_state", { next_action: "write manifest" }),
    '{"changedFields":[],"noChange":true,"stateHash":"abc"}',
  );
  const delta = acceptance.reconcile(registry.snapshot());
  const progress = tracker.evaluate({
    acceptanceAfter: acceptance.snapshot(),
    acceptanceDelta: delta,
    observedState: registry.snapshot(),
    receipts: [receipt],
  });

  assert.equal(progress.objectiveProgress, false);
  assert.equal(progress.informationGain, false);
  assert.equal(progress.noMeaningfulProgressStreak, 1);
  assert.equal(progress.primaryCategory, "unchanged");
  assert.equal(progress.noObjectiveProgressStreak, 1);
});

test("each accepted slide advances a pending multi-slide criterion", () => {
  const registry = new ReceiptRegistry();
  const acceptance = new AcceptanceLedger(
    createHtmlToPptxDeliverableContract("制作 8 页 ppt"),
  );
  const tracker = new ProgressTracker();

  acceptance.reconcile(registry.snapshot());
  const receipt = record(
    registry,
    call("slide-1", "write_slide_fragment", {
      deckDir: "deck",
      slideId: "01",
    }),
    "已保存 slide draft。\naccepted：deck/slides/01.html\nhash：hash-1",
  );
  const delta = acceptance.reconcile(registry.snapshot());
  const progress = tracker.evaluate({
    acceptanceAfter: acceptance.snapshot(),
    acceptanceDelta: delta,
    observedState: registry.snapshot(),
    receipts: [receipt],
  });

  assert.equal(delta.changed.some((change) => change.id === "slides"), false);
  assert.equal(progress.objectiveProgress, true);
  assert.equal(progress.noObjectiveProgressStreak, 0);
  assert.ok(
    progress.objectiveDeltas.some((item) =>
      item.includes("artifact slide advanced"),
    ),
  );
});

test("a successful command advances once without letting repeated output reset the watchdog", () => {
  const registry = new ReceiptRegistry();
  const acceptance = new AcceptanceLedger(createTextDeliverableContract());
  const tracker = new ProgressTracker();
  acceptance.reconcile(registry.snapshot());

  const first = record(
    registry,
    call("command-1", "run_terminal", { command: "npm test" }),
    "exit_code: 0\ntimed_out: false\nstdout:\nfirst run",
  );
  const firstDelta = acceptance.reconcile(registry.snapshot());
  const firstProgress = tracker.evaluate({
    acceptanceAfter: acceptance.snapshot(),
    acceptanceDelta: firstDelta,
    observedState: registry.snapshot(),
    receipts: [first],
  });

  const repeated = record(
    registry,
    call("command-2", "run_terminal", { command: "npm test" }),
    "exit_code: 0\ntimed_out: false\nstdout:\nsecond run",
  );
  const repeatedDelta = acceptance.reconcile(registry.snapshot());
  const repeatedProgress = tracker.evaluate({
    acceptanceAfter: acceptance.snapshot(),
    acceptanceDelta: repeatedDelta,
    observedState: registry.snapshot(),
    receipts: [repeated],
  });

  assert.equal(firstProgress.objectiveProgress, true);
  assert.equal(repeatedProgress.objectiveProgress, false);
  assert.equal(repeatedProgress.noObjectiveProgressStreak, 1);
});

test("successful artifact validation resolves earlier artifact route errors", () => {
  const registry = new ReceiptRegistry();
  record(
    registry,
    call("failed-export", "export_html_to_pptx", {
      html: "deck/deck.prepared.html",
      outPptx: "deck/final/deck.pptx",
    }),
    "export process exited early",
    false,
  );

  assert.equal(registry.snapshot().unresolvedErrors[0]?.resolved, false);

  record(
    registry,
    call("validate-recovery", "validate_html_pptx_export", {
      html: "deck/deck.html",
      pptx: "deck/final/deck.pptx",
    }),
    "已验证 HTML-to-PPTX spike 产物。\nQA：deck/qa-report.json\nslide 数：8",
  );

  assert.equal(registry.snapshot().unresolvedErrors[0]?.resolved, true);
});

test("artifact changes after validation regress current acceptance", () => {
  const registry = new ReceiptRegistry();
  const acceptance = new AcceptanceLedger(
    createHtmlToPptxDeliverableContract("制作 8 页 ppt"),
  );
  const tracker = new ProgressTracker();

  record(
    registry,
    call("validate-first", "validate_html_pptx_export", {
      html: "deck/deck.html",
      pptx: "deck/final/deck.pptx",
    }),
    "已验证 HTML-to-PPTX spike 产物。\nQA：deck/qa-report.json\nslide 数：8",
  );
  acceptance.reconcile(registry.snapshot());

  const patch = record(
    registry,
    call("patch-after-validation", "patch_slide_fragment", {
      deckDir: "deck",
      slideId: "01",
    }),
    "已保存 slide draft。\naccepted：deck/slides/01.html\nhash：new-hash",
  );
  const delta = acceptance.reconcile(registry.snapshot());
  const progress = tracker.evaluate({
    acceptanceAfter: acceptance.snapshot(),
    acceptanceDelta: delta,
    observedState: registry.snapshot(),
    receipts: [patch],
  });

  assert.ok(
    delta.changed.some(
      (change) =>
        change.id === "pptx-validation" &&
        change.from === "passed" &&
        change.to === "pending",
    ),
  );
  assert.ok(
    delta.changed.some(
      (change) =>
        change.id === "pptx-page-count" &&
        change.from === "passed" &&
        change.to === "pending",
    ),
  );
  assert.equal(progress.regression, true);
});

test("a failed current validation regresses an earlier passed validation", () => {
  const registry = new ReceiptRegistry();
  const acceptance = new AcceptanceLedger(
    createHtmlToPptxDeliverableContract("制作 8 页 ppt"),
  );
  const tracker = new ProgressTracker();

  record(
    registry,
    call("validate-pass", "validate_html_pptx_export", {
      html: "deck/deck.html",
      pptx: "deck/final/deck.pptx",
    }),
    "已验证 HTML-to-PPTX spike 产物。\nQA：deck/qa-report.json\nslide 数：8",
  );
  acceptance.reconcile(registry.snapshot());

  const failed = record(
    registry,
    call("validate-fail", "validate_html_pptx_export", {
      html: "deck/deck.html",
      pptx: "deck/final/deck.pptx",
    }),
    "Tool execution failed.\nReason: 最终 QA 检测到页面越界。",
    false,
  );
  const delta = acceptance.reconcile(registry.snapshot());
  const progress = tracker.evaluate({
    acceptanceAfter: acceptance.snapshot(),
    acceptanceDelta: delta,
    observedState: registry.snapshot(),
    receipts: [failed],
  });

  assert.ok(
    delta.changed.some(
      (change) =>
        change.id === "pptx-validation" &&
        change.from === "passed" &&
        change.to === "failed",
    ),
  );
  assert.equal(progress.regression, true);
});
