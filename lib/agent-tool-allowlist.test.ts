import assert from "node:assert/strict";
import test from "node:test";

import {
  getStepToolDefinitions,
  isToolAllowedForExecution,
  keepObservedFileTouches,
} from "./agent";

test("rejects tools omitted from the model request or current artifact phase", () => {
  const requested = new Set(["read_file", "write_slide_fragment"]);
  const currentPhase = new Set(["read_file", "write_slide_fragment"]);

  assert.equal(
    isToolAllowedForExecution("write_slide_fragment", requested, currentPhase),
    true,
  );
  assert.equal(
    isToolAllowedForExecution("write_file", requested, currentPhase),
    false,
  );
  assert.equal(
    isToolAllowedForExecution(
      "assemble_deck_styles",
      new Set(["assemble_deck_styles"]),
      currentPhase,
    ),
    false,
  );
});

test("keeps safe observations and all dedicated slide mutations available", () => {
  const styleTools = new Set(
    getStepToolDefinitions(["html-to-pptx"], "styles").map(
      (definition) => definition.name,
    ),
  );
  const slideTools = new Set(
    getStepToolDefinitions(["html-to-pptx"], "slides").map(
      (definition) => definition.name,
    ),
  );
  const alwaysAvailable = [
    "list_files",
    "read_file",
    "search_in_files",
    "read_task_memory",
    "search_web",
    "fetch_url",
    "write_style_fragment",
    "write_slide_fragment",
    "assemble_deck_styles",
    "assemble_slide_deck",
    "prepare_slide_html_for_pptx",
    "export_html_to_pptx",
    "validate_html_pptx_export",
  ];

  for (const toolName of alwaysAvailable) {
    assert.equal(styleTools.has(toolName), true, `${toolName} missing in styles`);
    assert.equal(slideTools.has(toolName), true, `${toolName} missing in slides`);
  }

  for (const bypassTool of [
    "write_file",
    "move_path",
    "delete_path",
    "run_terminal",
  ]) {
    assert.equal(styleTools.has(bypassTool), false);
    assert.equal(slideTools.has(bypassTool), false);
  }
});

test("does not record file touches from failed tools", () => {
  const failedPatch = keepObservedFileTouches(
    {
      currentMode: "edit",
      filesTouched: ["deck/slides/11-summary.html"],
      nextAction: "inspect the error",
    },
    false,
  );
  const successfulPatch = keepObservedFileTouches(
    {
      currentMode: "edit",
      filesTouched: ["deck/slides/11-summary.html"],
    },
    true,
  );

  assert.equal(failedPatch?.filesTouched, undefined);
  assert.deepEqual(successfulPatch?.filesTouched, [
    "deck/slides/11-summary.html",
  ]);
});
