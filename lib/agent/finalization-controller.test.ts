import assert from "node:assert/strict";
import test from "node:test";

import type {
  AcceptanceCriterion,
  AcceptanceSnapshot,
  DeliverableContract,
} from "../acceptance";
import { createTextDeliverableContract } from "../acceptance";
import { projectHtmlToPptxReceipt } from "../html-to-pptx/artifact-policy";
import type { AgentToolUseBlock } from "../llm";
import { createToolReceipt, ReceiptRegistry } from "../receipts/registry";
import type { ObservedState } from "../receipts/types";
import { decideFinalization } from "./finalization-controller";

function emptyObservedState(): ObservedState {
  return {
    artifacts: {},
    commands: [],
    evidence: {},
    files: {},
    receipts: [],
    stateHash: "state-empty",
    unresolvedErrors: [],
    verification: [],
  };
}

function snapshot(
  criteria: AcceptanceCriterion[],
  gap: string[] = [],
): AcceptanceSnapshot {
  return { criteria, gap };
}

function documentContract(): DeliverableContract {
  return {
    criteria: [
      {
        description: "报告文件已经生成",
        id: "report",
        kind: "artifact",
        required: true,
        target: "report",
      },
    ],
    textOnly: false,
    type: "document",
    verificationRequired: false,
  };
}

function pptxContract(): DeliverableContract {
  return {
    criteria: [
      {
        description: "PPTX 已导出",
        id: "pptx",
        kind: "artifact",
        required: true,
        target: "pptx",
      },
      {
        description: "PPTX 已验证",
        id: "pptx-validation",
        kind: "verification",
        required: true,
        target: "html-to-pptx",
      },
      {
        description: "PPTX 恰好包含 8 页",
        id: "pptx-page-count",
        kind: "page-count",
        minimumCount: 8,
        required: true,
        target: "html-to-pptx",
      },
    ],
    textOnly: false,
    type: "pptx",
    verificationRequired: true,
  };
}

function passedPptxSnapshot(receiptId: string): AcceptanceSnapshot {
  return snapshot(
    pptxContract().criteria.map((criterion) => ({
      ...criterion,
      evidenceRefs: [receiptId],
      status: "passed",
    })),
  );
}

function validatedPptxObserved(slideCount = 8): ObservedState {
  return {
    ...emptyObservedState(),
    artifacts: {
      "pptx:deck/final.pptx": {
        count: slideCount,
        key: "pptx:deck/final.pptx",
        kind: "pptx",
        path: "deck/final.pptx",
        receiptId: `validate-${slideCount}`,
        status: "validated",
      },
    },
    stateHash: `state-${slideCount}`,
    verification: [
      {
        details: ["visual QA passed"],
        passed: true,
        receiptId: `validate-${slideCount}`,
        scope: "html-to-pptx",
        slideCount,
      },
    ],
  };
}

function toolCall(
  id: string,
  name: string,
  input: Record<string, unknown>,
): AgentToolUseBlock {
  return { id, input, inputComplete: true, name, type: "tool_use" };
}

test("delivers a complete text response", () => {
  const result = decideFinalization({
    acceptanceSnapshot: snapshot([]),
    deliverableContract: createTextDeliverableContract(),
    observedState: emptyObservedState(),
    stopReason: "completed",
    visibleContent: "任务已经完成。",
  });

  assert.equal(result.kind, "final");
  assert.equal(result.finalSynthesisAllowed, true);
  if (result.kind === "final") {
    assert.equal(result.message, "任务已经完成。");
    assert.deepEqual(result.completion.evidenceRefs, []);
  }
});

test("required gaps always guard and never pass by retry count", () => {
  const acceptance = snapshot(
    [
      {
        ...documentContract().criteria[0],
        evidenceRefs: [],
        status: "pending",
      },
    ],
    ["report: 报告文件已经生成 (pending)"],
  );
  const input = {
    acceptanceSnapshot: acceptance,
    deliverableContract: documentContract(),
    observedState: emptyObservedState(),
    stopReason: "completed",
    visibleContent: "我已经完成报告。",
  };

  const first = decideFinalization(input);
  const repeated = decideFinalization(input);

  assert.equal(first.kind, "guard_retry");
  assert.equal(repeated.kind, "guard_retry");
  if (first.kind === "guard_retry" && repeated.kind === "guard_retry") {
    assert.equal(first.nextAction, "continue_tools");
    assert.deepEqual(repeated.issues, first.issues);
    assert.ok(first.issues.some((issue) => issue.code === "acceptance_gap"));
  }
});

test("passed criteria without live evidence remain guarded", () => {
  const result = decideFinalization({
    acceptanceSnapshot: snapshot([
      {
        ...documentContract().criteria[0],
        evidenceRefs: ["missing-receipt"],
        status: "passed",
      },
    ]),
    deliverableContract: documentContract(),
    observedState: emptyObservedState(),
    stopReason: "completed",
    visibleContent: "报告路径见附件。",
  });

  assert.equal(result.kind, "guard_retry");
  if (result.kind === "guard_retry") {
    assert.equal(result.nextAction, "continue_tools");
    assert.ok(result.issues.some((issue) => issue.code === "missing_evidence"));
  }
});

test("unresolved errors that cover the deliverable block finalization", () => {
  const observed = emptyObservedState();
  observed.artifacts.report = {
    key: "report",
    kind: "report",
    path: "output/report.docx",
    receiptId: "report-written",
    status: "accepted",
  };
  observed.unresolvedErrors.push({
    fingerprint: "report-export",
    message: "report export failed",
    receiptId: "report-error",
    resolved: false,
    strategySignature: "export_report:output/report.docx",
    toolName: "export_report",
  });
  const result = decideFinalization({
    acceptanceSnapshot: snapshot([
      {
        ...documentContract().criteria[0],
        evidenceRefs: ["report-written"],
        status: "passed",
      },
    ]),
    deliverableContract: documentContract(),
    observedState: observed,
    stopReason: "completed",
    visibleContent: "报告已完成。",
  });

  assert.equal(result.kind, "guard_retry");
  if (result.kind === "guard_retry") {
    assert.ok(
      result.issues.some(
        (issue) => issue.code === "unresolved_deliverable_error",
      ),
    );
  }
});

test("an exported or stale PPTX cannot bypass current validation", () => {
  const observed = emptyObservedState();
  observed.artifacts = {
    "pptx:old": {
      count: 8,
      key: "pptx:old",
      kind: "pptx",
      path: "deck/old.pptx",
      receiptId: "validate-old",
      status: "validated",
    },
    "pptx:new": {
      count: 8,
      key: "pptx:new",
      kind: "pptx",
      path: "deck/final.pptx",
      receiptId: "export-new",
      status: "exported",
    },
  };
  observed.verification = [
    {
      details: ["old validation"],
      passed: true,
      receiptId: "validate-old",
      scope: "html-to-pptx",
      slideCount: 8,
    },
  ];

  const result = decideFinalization({
    acceptanceSnapshot: passedPptxSnapshot("validate-old"),
    deliverableContract: pptxContract(),
    observedState: observed,
    stopReason: "completed",
    visibleContent: "PPTX 已完成。",
  });

  assert.equal(result.kind, "guard_retry");
  if (result.kind === "guard_retry") {
    assert.ok(
      result.issues.some((issue) => issue.code === "pptx_not_validated"),
    );
  }
});

test("validated PPTX page mismatches guard while exact validation can finalize", () => {
  const mismatch = decideFinalization({
    acceptanceSnapshot: passedPptxSnapshot("validate-7"),
    deliverableContract: pptxContract(),
    observedState: validatedPptxObserved(7),
    stopReason: "completed",
    visibleContent: "PPTX 已完成。",
  });
  const exact = decideFinalization({
    acceptanceSnapshot: passedPptxSnapshot("validate-8"),
    deliverableContract: pptxContract(),
    observedState: validatedPptxObserved(8),
    stopReason: "completed",
    visibleContent: "PPTX 已完成并验证。",
  });

  assert.equal(mismatch.kind, "guard_retry");
  if (mismatch.kind === "guard_retry") {
    assert.ok(
      mismatch.issues.some(
        (issue) => issue.code === "pptx_page_count_mismatch",
      ),
    );
  }
  assert.equal(exact.kind, "final");
});

test("artifact mutation after PPTX validation requires fresh validation", () => {
  const registry = new ReceiptRegistry();
  const validate = registry.record(
    createToolReceipt({
      endedAt: 2,
      projectors: [projectHtmlToPptxReceipt],
      result:
        "已验证 HTML-to-PPTX spike 产物。\nQA：deck/qa-report.json\nslide 数：8",
      startedAt: 1,
      success: true,
      toolCall: toolCall("validate", "validate_html_pptx_export", {
        html: "deck/deck.html",
        pptx: "deck/final.pptx",
      }),
    }),
  );
  registry.record(
    createToolReceipt({
      endedAt: 4,
      projectors: [projectHtmlToPptxReceipt],
      result:
        "已保存 slide draft。\naccepted：deck/slides/01.html\nhash：new-slide-hash",
      startedAt: 3,
      success: true,
      toolCall: toolCall("patch", "patch_slide_fragment", {
        deckDir: "deck",
        slideId: "01",
      }),
    }),
  );

  const decision = decideFinalization({
    acceptanceSnapshot: passedPptxSnapshot(validate.id),
    deliverableContract: pptxContract(),
    observedState: registry.snapshot(),
    stopReason: "completed",
    visibleContent: "PPTX 已完成。",
  });

  assert.equal(decision.kind, "guard_retry");
  if (decision.kind === "guard_retry") {
    assert.ok(
      decision.issues.some(
        (issue) =>
          issue.code === "pptx_not_validated" &&
          issue.receiptId === registry.snapshot().receipts.at(-1)?.id,
      ),
    );
  }
});

test("empty or truncated output continues tools while artifacts are incomplete", () => {
  const acceptance = snapshot(
    [
      {
        ...documentContract().criteria[0],
        evidenceRefs: [],
        status: "pending",
      },
    ],
    ["report: 报告文件已经生成 (pending)"],
  );
  const base = {
    acceptanceSnapshot: acceptance,
    deliverableContract: documentContract(),
    observedState: emptyObservedState(),
  };
  const empty = decideFinalization({
    ...base,
    stopReason: "completed",
    visibleContent: "  ",
  });
  const truncated = decideFinalization({
    ...base,
    stopReason: "max_output_tokens",
    visibleContent: "报告还在生成",
  });

  for (const decision of [empty, truncated]) {
    assert.equal(decision.kind, "guard_retry");
    if (decision.kind === "guard_retry") {
      assert.equal(decision.nextAction, "continue_tools");
      assert.equal(decision.finalSynthesisAllowed, false);
    }
  }
});

test("empty output repairs final text after artifact acceptance", () => {
  const observed = emptyObservedState();
  observed.artifacts.report = {
    key: "report",
    kind: "report",
    path: "output/report.docx",
    receiptId: "report-written",
    status: "accepted",
  };
  const result = decideFinalization({
    acceptanceSnapshot: snapshot([
      {
        ...documentContract().criteria[0],
        evidenceRefs: ["report-written"],
        status: "passed",
      },
    ]),
    deliverableContract: documentContract(),
    observedState: observed,
    stopReason: "completed",
    visibleContent: "",
  });

  assert.equal(result.kind, "guard_retry");
  if (result.kind === "guard_retry") {
    assert.equal(result.nextAction, "repair_final");
    assert.deepEqual(result.issues.map((issue) => issue.code), ["empty_final"]);
  }
});
