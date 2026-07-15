import assert from "node:assert/strict";
import test from "node:test";

import {
  createChunkedFinalState,
  decideChunkedFinal,
} from "./chunked-final-controller";

test("keeps ordinary final text inactive", () => {
  assert.deepEqual(
    decideChunkedFinal({
      currentState: null,
      visibleContent: "普通最终回答。",
    }),
    { candidate: "普通最终回答。", kind: "inactive" },
  );
});

test("aggregates ordered parts and strips protocol markers", () => {
  const first = decideChunkedFinal({
    currentState: null,
    visibleContent:
      "RANNI_FINAL_PART 1/2\n第一部分。\nRANNI_FINAL_CONTINUE",
  });
  assert.equal(first.kind, "continue");
  if (first.kind !== "continue") return;

  const second = decideChunkedFinal({
    currentState: first.state,
    visibleContent: "RANNI_FINAL_PART 2/2\n第二部分。\nRANNI_FINAL_DONE",
  });
  assert.deepEqual(second, {
    candidate: "第一部分。\n\n第二部分。",
    kind: "complete",
  });
});

test("repairs an active response that omits the protocol", () => {
  const state = createChunkedFinalState();
  const result = decideChunkedFinal({
    currentState: state,
    visibleContent: "遗漏协议的正文",
  });

  assert.equal(result.kind, "repair");
  if (result.kind === "repair") {
    assert.equal(result.nextPart, 1);
    assert.equal(result.stopReason, "chunked_final_protocol_repair");
    assert.match(result.controlMessage, /RANNI_FINAL_PART 1\/\?/);
  }
});

test("bounds chunk continuation at eight parts", () => {
  const state = {
    chunks: Array.from({ length: 7 }, (_, index) => `part-${index + 1}`),
    expectedTotal: 8,
    lastPart: 7,
  };
  const result = decideChunkedFinal({
    currentState: state,
    visibleContent:
      "RANNI_FINAL_PART 8/8\n第八部分。\nRANNI_FINAL_CONTINUE",
  });

  assert.equal(result.kind, "error");
});
