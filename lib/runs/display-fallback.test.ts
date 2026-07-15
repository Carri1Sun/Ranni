import assert from "node:assert/strict";
import test from "node:test";

import {
  createStatusDisplay,
  createToolCallDisplay,
  createToolResultDisplay,
  getToolDisplayName,
  getToolIcon,
} from "./display-fallback";

test("uses specific titles for no-progress watchdog decisions", () => {
  assert.equal(
    createStatusDisplay("最近三轮没有缩小交付缺口。").title,
    "检查交付推进",
  );
  assert.equal(
    createStatusDisplay(
      "连续六轮没有缩小交付缺口。当前研究或观察仍可能具有有效信息增量。",
    ).title,
    "检查交付充分性",
  );
  assert.equal(
    createStatusDisplay(
      "同一策略连续两轮失败，当前路线已经失去继续复用的依据。",
    ).title,
    "调整当前路线",
  );
  assert.equal(
    createStatusDisplay(
      "连续十轮没有产生客观推进或新的有效信息，当前循环已停止。",
    ).title,
    "保存恢复现场",
  );
});

test("uses clear Chinese fallback labels for plan coordination tools", () => {
  assert.equal(getToolDisplayName("update_plan"), "更新工作计划");
  assert.equal(getToolDisplayName("replace_attempt"), "替换当前路线");
  assert.equal(getToolIcon("update_plan"), "state");
  assert.equal(getToolIcon("replace_attempt"), "state");

  assert.equal(
    createToolCallDisplay("update_plan", {
      items: [{ id: "P01", title: "验证工件" }],
      reason: "验收缺口发生变化",
    }).title,
    "更新工作计划",
  );
  assert.equal(
    createToolCallDisplay("replace_attempt", {
      approach: "改用已验证的导出器",
      reason: "原路线产生失败回执",
    }).title,
    "替换当前路线",
  );
});

test("uses the same plan labels for fallback tool results", () => {
  assert.equal(
    createToolResultDisplay({
      result: "plan revision recorded",
      success: true,
      toolName: "update_plan",
    }).title,
    "更新工作计划完成",
  );
  assert.equal(
    createToolResultDisplay({
      result: "attempt rejected",
      success: false,
      toolName: "replace_attempt",
    }).title,
    "替换当前路线失败",
  );
});
