import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { executeTool } from "./tools";

test("search_in_files accepts a single workspace file", async (t) => {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "ranni-search-file-"),
  );
  t.after(() =>
    fs.rm(workspaceRoot, { force: true, recursive: true }),
  );
  await fs.writeFile(
    path.join(workspaceRoot, "target.ts"),
    "const marker = 'causal-tail';\n",
    "utf8",
  );

  const result = await executeTool(
    "search_in_files",
    JSON.stringify({ path: "target.ts", query: "causal-tail" }),
    { workspaceRoot },
  );

  assert.match(result, /^target\.ts:1:/m);
});
