import assert from "node:assert/strict";
import test from "node:test";

import type { AcceptanceSnapshot } from "./acceptance";
import { createPlanLedger, PlanLedger } from "./plan";
import type { ToolReceipt } from "./receipts/types";

function acceptance(
  status: "failed" | "passed" | "pending" | "unknown" | "waived",
): AcceptanceSnapshot {
  return {
    criteria: [
      {
        description: "validated artifact",
        evidenceRefs: status === "passed" ? ["artifact-receipt"] : [],
        id: "artifact",
        kind: "artifact",
        required: true,
        status,
        target: "artifact",
      },
    ],
    gap:
      status === "passed" || status === "waived"
        ? []
        : [`artifact: validated artifact (${status})`],
  };
}

function receipt({
  category = "file",
  id = "receipt-1",
  success = true,
}: {
  category?: ToolReceipt["category"];
  id?: string;
  success?: boolean;
} = {}): ToolReceipt {
  return {
    category,
    domainStatus: success ? "succeeded" : "failed",
    durationMs: 1,
    endedAt: 2,
    id,
    input: {},
    inputHash: "input",
    inputSummary: "{}",
    projection: {},
    result: success ? "ok" : "failed",
    resultHash: success ? "ok-hash" : "failed-hash",
    resultSummary: success ? "ok" : "failed",
    reused: false,
    startedAt: 1,
    strategySignature: "strategy",
    success,
    toolName: category === "state" ? "update_plan" : "write_file",
    toolUseId: id,
    unchanged: false,
  };
}

test("legacy plan revisions keep stable item ids across reordering", () => {
  const ledger = createPlanLedger();
  const initial = ledger.updateLegacy(["research", "write", "verify"], {
    stepIndex: 1,
  });
  const ids = Object.fromEntries(
    initial.snapshot.items.map((item) => [item.title, item.id]),
  );

  const reordered = ledger.updateLegacy(["verify", "research", "write"], {
    reason: "move verification earlier",
    stepIndex: 2,
  });

  assert.equal(reordered.kind, "revision");
  assert.deepEqual(
    reordered.snapshot.items
      .filter((item) => item.status !== "superseded")
      .map((item) => [item.title, item.id]),
    [
      ["verify", ids.verify],
      ["research", ids.research],
      ["write", ids.write],
    ],
  );
  assert.equal(reordered.snapshot.revision, 2);
});

test("repeated semantic plan update is a no-op", () => {
  const ledger = createPlanLedger();
  ledger.updateLegacy(["inspect", "act", "verify"], { stepIndex: 1 });

  const repeated = ledger.updateLegacy(["inspect", "act", "verify"], {
    stepIndex: 4,
  });

  assert.equal(repeated.changed, false);
  assert.equal(repeated.kind, "none");
  assert.equal(repeated.snapshot.revision, 1);
});

test("structured updates canonicalize short plan ids without replacing existing items", () => {
  const ledger = createPlanLedger();
  ledger.updateLegacy(["research", "write", "verify"], { stepIndex: 1 });

  const revised = ledger.replace(
    [
      {
        blockedReason: "",
        id: "P1",
        status: "in_progress",
        title: "research sources",
      },
      {
        blockedReason: "无",
        dependsOn: ["P1"],
        id: "P2",
        status: "pending",
        title: "write comparison",
      },
      { id: "P3", status: "pending", title: "verify output" },
      { id: "P4", status: "pending", title: "deliver artifact" },
    ],
    { focusItemId: "P1", stepIndex: 2 },
  );

  assert.deepEqual(
    revised.snapshot.items.map((item) => item.id),
    ["P01", "P02", "P03", "P04"],
  );
  assert.equal(revised.snapshot.focusItemId, "P01");
  assert.deepEqual(revised.snapshot.items[1]?.dependsOn, ["P01"]);
  assert.equal(revised.snapshot.items[1]?.blockedReason, undefined);
  assert.equal(
    revised.snapshot.items.some((item) => item.status === "superseded"),
    false,
  );
});

test("structured updates reject invalid ids and dependency graphs transactionally", () => {
  const ledger = createPlanLedger();
  ledger.updateLegacy(["research", "write"], { stepIndex: 1 });
  const before = ledger.serialize();

  const invalidUpdates: Array<{
    items: Parameters<typeof ledger.replace>[0];
    message: RegExp;
  }> = [
    {
      items: [
        { id: "P1", title: "research" },
        { id: "P01", title: "duplicate research" },
        { id: "P2", title: "write" },
      ],
      message: /重复 Plan Item ID：P01/,
    },
    {
      items: [
        { dependsOn: ["P1"], id: "P1", title: "research" },
        { id: "P2", title: "write" },
      ],
      message: /Plan Item P01 不能依赖自身/,
    },
    {
      items: [
        { id: "P1", title: "research" },
        { id: "P2", title: "write" },
        { dependsOn: ["P99"], title: "verify" },
      ],
      message: /Plan Item P03 引用了未知依赖：P99/,
    },
    {
      items: [
        { dependsOn: ["P2"], id: "P1", title: "research" },
        { dependsOn: ["P1"], id: "P2", title: "write" },
      ],
      message: /依赖图存在环：P01 → P02 → P01/,
    },
  ];

  for (const [index, invalid] of invalidUpdates.entries()) {
    assert.throws(
      () => ledger.replace(invalid.items, { stepIndex: index + 2 }),
      invalid.message,
    );
    assert.deepEqual(ledger.serialize(), before);
  }

  const valid = ledger.replace(
    [
      { id: "P1", title: "research" },
      { dependsOn: ["P1"], id: "P2", title: "write" },
      { dependsOn: ["P2"], title: "verify" },
    ],
    { stepIndex: 6 },
  );
  assert.deepEqual(
    valid.snapshot.items
      .filter((item) => item.status !== "superseded")
      .map((item) => [item.id, item.dependsOn]),
    [
      ["P01", []],
      ["P02", ["P01"]],
      ["P03", ["P02"]],
    ],
  );
});

test("model-reported completion stays unverified until evidence arrives", () => {
  const ledger = createPlanLedger();
  const revision = ledger.replace(
    [{ status: "completed", title: "inspect the implementation" }],
    { stepIndex: 1 },
  );

  assert.equal(revision.snapshot.items[0]?.status, "active");

  const planningOnly = ledger.reconcile(acceptance("pending"), [
    receipt({ category: "state", id: "plan-receipt" }),
  ], 2);
  assert.equal(planningOnly.changed, false);
  assert.equal(planningOnly.snapshot.items[0]?.status, "active");

  const evidenced = ledger.reconcile(acceptance("pending"), [
    receipt({ id: "read-receipt" }),
  ], 3);
  assert.equal(evidenced.snapshot.items[0]?.status, "satisfied");
  assert.deepEqual(evidenced.snapshot.items[0]?.evidenceRefs, [
    "read-receipt",
  ]);
});

test("failed receipts cannot satisfy model-reported completion", () => {
  const ledger = createPlanLedger();
  ledger.replace(
    [{ status: "completed", title: "generate the artifact" }],
    { stepIndex: 1 },
  );

  const failed = ledger.reconcile(
    acceptance("pending"),
    [receipt({ id: "failed-build", success: false })],
    2,
  );

  assert.equal(failed.snapshot.items[0]?.status, "active");
  assert.deepEqual(failed.snapshot.items[0]?.evidenceRefs, []);
});

test("linked acceptance completes one item and advances focus", () => {
  const ledger = createPlanLedger();
  const initial = ledger.replace(
    [
      {
        acceptanceRefs: ["artifact"],
        status: "in_progress",
        title: "produce artifact",
      },
      { title: "write delivery note" },
    ],
    { stepIndex: 1 },
  );
  const firstId = initial.snapshot.items[0]?.id;
  const secondId = initial.snapshot.items[1]?.id;

  const reconciled = ledger.reconcile(acceptance("passed"), [], 2);

  assert.equal(
    reconciled.snapshot.items.find((item) => item.id === firstId)?.status,
    "satisfied",
  );
  assert.deepEqual(
    reconciled.snapshot.items.find((item) => item.id === firstId)?.evidenceRefs,
    ["artifact-receipt"],
  );
  assert.equal(reconciled.snapshot.focusItemId, secondId);
  assert.equal(
    reconciled.snapshot.items.find((item) => item.id === secondId)?.status,
    "active",
  );
});

test("focus respects unresolved plan dependencies", () => {
  const ledger = createPlanLedger();
  const initial = ledger.replace(
    [
      { title: "collect evidence" },
      {
        dependsOn: ["P01"],
        status: "in_progress",
        title: "write synthesis",
      },
    ],
    { focusItemId: "P02", stepIndex: 1 },
  );

  assert.equal(initial.snapshot.focusItemId, "P01");
  assert.equal(initial.snapshot.items[0]?.status, "active");
  assert.equal(initial.snapshot.items[1]?.status, "pending");
});

test("an explicit revision can reopen a receipt-satisfied item", () => {
  const ledger = createPlanLedger();
  const initial = ledger.replace(
    [{ status: "completed", title: "inspect implementation" }],
    { stepIndex: 1 },
  );
  ledger.reconcile(acceptance("pending"), [receipt()], 2);
  const item = initial.snapshot.items[0];
  assert.ok(item);

  const reopened = ledger.replace(
    [{ id: item.id, status: "in_progress", title: item.title }],
    {
      reason: "new scope requires another inspection",
      reasonKind: "user_change",
      stepIndex: 3,
    },
  );

  assert.equal(reopened.snapshot.items[0]?.status, "active");
  assert.deepEqual(reopened.snapshot.items[0]?.evidenceRefs, []);
});

test("finalization closes coordination items only after acceptance closes", () => {
  const ledger = createPlanLedger();
  ledger.updateLegacy(["produce", "verify", "deliver"], { stepIndex: 1 });

  const guarded = ledger.finalize(acceptance("pending"), { stepIndex: 2 });
  assert.equal(guarded.changed, false);
  assert.ok(
    guarded.snapshot.items.some((item) => item.status === "active"),
  );

  const completed = ledger.finalize(acceptance("passed"), {
    evidenceRefs: ["artifact-receipt"],
    stepIndex: 3,
  });
  assert.equal(completed.kind, "finalization");
  assert.equal(completed.snapshot.focusItemId, undefined);
  assert.ok(
    completed.snapshot.items.every((item) => item.status === "satisfied"),
  );
});

test("serialized plan restores revision, evidence, and id allocation", () => {
  const ledger = createPlanLedger();
  ledger.updateLegacy(["research", "write"], { stepIndex: 1 });
  ledger.reconcile(acceptance("pending"), [receipt()], 2);
  const serialized = JSON.parse(JSON.stringify(ledger.serialize())) as unknown;

  const restored = PlanLedger.restore(serialized);
  const before = restored.snapshot();
  const next = restored.replace(
    [
      ...before.items
        .filter((item) => item.status !== "superseded")
        .map((item) => ({ id: item.id, title: item.title })),
      { title: "verify" },
    ],
    { stepIndex: 3 },
  );

  assert.equal(before.id, ledger.snapshot().id);
  assert.ok(next.snapshot.items.some((item) => item.id === "P03"));
});

test("compact snapshot retains active, blocked, and recent terminal items", () => {
  const ledger = createPlanLedger();
  ledger.replace(
    [
      { status: "completed", title: "done" },
      { status: "in_progress", title: "active" },
      { blockedReason: "missing input", status: "blocked", title: "blocked" },
      { title: "pending" },
    ],
    { stepIndex: 1 },
  );
  ledger.reconcile(acceptance("pending"), [receipt()], 2);

  const compact = ledger.compactSnapshot();

  assert.ok(compact.items.some((item) => item.status === "active"));
  assert.ok(compact.items.some((item) => item.status === "blocked"));
  assert.ok(compact.items.some((item) => item.status === "satisfied"));
  assert.equal(compact.lastRevision?.number, 1);
});
