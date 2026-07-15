import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { tools } from "./tools";

async function runTool(
  name: string,
  args: unknown,
  workspaceRoot: string,
) {
  const definition = tools.find((tool) => tool.tool.name === name);

  assert.ok(definition, `missing tool ${name}`);
  return definition.execute(definition.schema.parse(args), { workspaceRoot });
}

async function prepareDeck(
  workspaceRoot: string,
  slideIds: string[],
  deckDir = "demo-deck",
) {
  await runTool(
    "set_slide_manifest",
    { deckDir, slideIds },
    workspaceRoot,
  );
  await runTool(
    "write_style_fragment",
    {
      css: [
        "html, body { margin: 0; padding: 0; overflow: hidden; }",
        "* { box-sizing: border-box; }",
        ".slide { position: relative; width: 1280px; height: 720px; overflow: hidden; background: #fff; }",
      ].join("\n"),
      deckDir,
      styleId: "base",
    },
    workspaceRoot,
  );
  await runTool(
    "assemble_deck_styles",
    { deckDir, styleIds: ["base"] },
    workspaceRoot,
  );
}

test("validates a registered design style before creating workspace files", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "ranni-slide-init-validation-"),
  );

  try {
    await assert.rejects(
      runTool(
        "init_slide_html_workspace",
        {
          deckSlug: "invalid-style-deck",
          styleId: "unregistered-style-id",
        },
        workspaceRoot,
      ),
      /未找到 HTML 设计风格：[\s\S]*neo-brutalism[\s\S]*省略 styleId/,
    );
    await assert.rejects(
      readFile(
        path.join(workspaceRoot, "invalid-style-deck", "deck.html"),
        "utf8",
      ),
      /ENOENT/,
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("treats an empty optional style id as a custom-style workspace", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "ranni-slide-init-empty-style-"),
  );

  try {
    await runTool(
      "init_slide_html_workspace",
      {
        deckSlug: "custom-style-deck",
        styleId: "",
      },
      workspaceRoot,
    );
    assert.match(
      await readFile(
        path.join(workspaceRoot, "custom-style-deck", "deck.html"),
        "utf8",
      ),
      /HTML to PPTX spike/,
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("validates and atomically assembles CSS fragments", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "ranni-style-fragments-"),
  );

  try {
    await assert.rejects(
      runTool(
        "write_style_fragment",
        {
          css: ".slide { width: 1280px; /* truncated",
          deckDir: "demo-deck",
          styleId: "broken",
        },
        workspaceRoot,
      ),
      /未闭合注释/,
    );
    await assert.rejects(
      runTool(
        "write_style_fragment",
        {
          css: ".slide > * { position: relative; }",
          deckDir: "demo-deck",
          styleId: "unsafe-layering",
        },
        workspaceRoot,
      ),
      /统一覆盖 position/,
    );
    await prepareDeck(workspaceRoot, ["01-cover"]);
    const css = await readFile(
      path.join(workspaceRoot, "demo-deck", "styles.css"),
      "utf8",
    );

    assert.match(css, /\/\* base \*\//);
    assert.match(css, /width: 1280px/);
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("uses an immutable manifest and assembles slides in manifest order", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "ranni-slide-fragments-"),
  );

  try {
    await prepareDeck(workspaceRoot, ["01-cover", "02-detail"]);
    await runTool(
      "write_slide_fragment",
      {
        deckDir: "demo-deck",
        slideId: "01-cover",
        html: '<section class="slide" data-slide-id="01-cover"><h1>旧标题</h1></section>',
      },
      workspaceRoot,
    );
    await runTool(
      "write_slide_fragment",
      {
        deckDir: "demo-deck",
        slideId: "01-cover",
        html: '<section class="slide" data-slide-id="01-cover"><h1>新标题</h1></section>',
      },
      workspaceRoot,
    );
    await runTool(
      "write_slide_fragment",
      {
        deckDir: "demo-deck",
        slideId: "02-detail",
        html: '<section class="slide" data-slide-id="02-detail"><p>第二页</p></section>',
      },
      workspaceRoot,
    );
    await assert.rejects(
      runTool(
        "set_slide_manifest",
        {
          deckDir: "demo-deck",
          slideIds: ["02-detail", "01-cover"],
        },
        workspaceRoot,
      ),
      /不能再改变页面清单/,
    );

    const result = await runTool(
      "assemble_slide_deck",
      { deckDir: "demo-deck", title: "测试演示稿" },
      workspaceRoot,
    );
    const deckHtml = await readFile(
      path.join(workspaceRoot, "demo-deck", "deck.html"),
      "utf8",
    );

    assert.match(result, /页面数：2/);
    assert.match(deckHtml, /<title>测试演示稿<\/title>/);
    assert.equal(deckHtml.includes("旧标题"), false);
    assert.ok(deckHtml.indexOf("新标题") < deckHtml.indexOf("第二页"));
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("rejects reserved, unmanifested, empty, and overflowing slides with stable codes", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "ranni-slide-validation-"),
  );

  try {
    await assert.rejects(
      runTool(
        "set_slide_manifest",
        { deckDir: "demo-deck", slideIds: ["styles"] },
        workspaceRoot,
      ),
      /保留名称/,
    );
    await prepareDeck(workspaceRoot, ["01-cover"]);
    await assert.rejects(
      runTool(
        "write_slide_fragment",
        {
          deckDir: "demo-deck",
          slideId: "02-extra",
          html: '<section class="slide" data-slide-id="02-extra">额外页</section>',
        },
        workspaceRoot,
      ),
      /不在已固定的页面清单/,
    );
    await assert.rejects(
      runTool(
        "write_slide_fragment",
        {
          deckDir: "demo-deck",
          slideId: "01-cover",
          html: '<section class="slide" data-slide-id="01-cover"></section>',
        },
        workspaceRoot,
      ),
      /拒绝写入空白页/,
    );
    await assert.rejects(
      runTool(
        "write_slide_fragment",
        {
          deckDir: "demo-deck",
          slideId: "01-cover",
          html: '<section class="slide" data-slide-id="01-cover"><div style="height:900px">溢出内容</div></section>',
        },
        workspaceRoot,
      ),
      /SLIDE_CONTENT_OUTSIDE_CANVAS/,
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("accepts clipped textless decorations and reuses their diagnostics during prepare", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "ranni-slide-decoration-"),
  );

  try {
    await prepareDeck(workspaceRoot, ["01-cover"]);
    const result = await runTool(
      "write_slide_fragment",
      {
        deckDir: "demo-deck",
        slideId: "01-cover",
        html: [
          '<section class="slide" data-slide-id="01-cover">',
          "  <h1>语义化预检</h1>",
          '  <div aria-hidden="true" style="position:absolute;width:320px;height:360px;right:-160px;bottom:-180px;background:#1a237e"></div>',
          "</section>",
        ].join("\n"),
      },
      workspaceRoot,
    );
    const artifactReport = JSON.parse(
      await readFile(
        path.join(
          workspaceRoot,
          "demo-deck",
          "slides",
          ".draft",
          "01-cover.diagnostics.json",
        ),
        "utf8",
      ),
    ) as {
      diagnostics: {
        errors: unknown[];
        warnings: Array<{ code: string }>;
      };
      status: string;
    };

    assert.match(result, /warning 1/);
    assert.equal(artifactReport.status, "accepted");
    assert.equal(artifactReport.diagnostics.errors.length, 0);
    assert.equal(
      artifactReport.diagnostics.warnings[0]?.code,
      "SLIDE_DECORATION_CLIPPED",
    );
    assert.ok(
      (
        await readFile(
          path.join(
            workspaceRoot,
            "demo-deck",
            "slides",
            ".draft",
            "01-cover.png",
          ),
        )
      ).byteLength > 0,
    );

    await runTool(
      "assemble_slide_deck",
      { deckDir: "demo-deck" },
      workspaceRoot,
    );
    await runTool(
      "prepare_slide_html_for_pptx",
      {
        html: "demo-deck/deck.html",
        measurementsPath: "demo-deck/measurements.json",
        outHtml: "demo-deck/deck.prepared.html",
      },
      workspaceRoot,
    );
    const measurements = JSON.parse(
      await readFile(
        path.join(workspaceRoot, "demo-deck", "measurements.json"),
        "utf8",
      ),
    ) as {
      slideDiagnostics: {
        errors: unknown[];
        warnings: Array<{ code: string }>;
      };
    };

    assert.equal(measurements.slideDiagnostics.errors.length, 0);
    assert.ok(
      measurements.slideDiagnostics.warnings.some(
        (warning) => warning.code === "SLIDE_DECORATION_CLIPPED",
      ),
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("preserves failed drafts, keeps accepted content, and supports inspected exact patches", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "ranni-slide-draft-patch-"),
  );

  try {
    await prepareDeck(workspaceRoot, ["01-cover"]);
    await runTool(
      "write_slide_fragment",
      {
        deckDir: "demo-deck",
        slideId: "01-cover",
        html: '<section class="slide" data-slide-id="01-cover"><h1>已接受版本</h1></section>',
      },
      workspaceRoot,
    );
    const acceptedPath = path.join(
      workspaceRoot,
      "demo-deck",
      "slides",
      "01-cover.html",
    );
    const acceptedBefore = await readFile(acceptedPath, "utf8");

    await assert.rejects(
      runTool(
        "write_slide_fragment",
        {
          deckDir: "demo-deck",
          slideId: "01-cover",
          html: '<section class="slide" data-slide-id="01-cover"><div style="height:900px">待修复版本</div></section>',
        },
        workspaceRoot,
      ),
      /SLIDE_CONTENT_VALIDATION_FAILED/,
    );

    const acceptedAfterFailure = await readFile(acceptedPath, "utf8");
    const inspected = JSON.parse(
      await runTool(
        "inspect_slide_fragment",
        { deckDir: "demo-deck", slideId: "01-cover" },
        workspaceRoot,
      ),
    ) as {
      acceptedHash: string;
      diagnostics: {
        diagnostics: { errors: Array<{ code: string }> };
        status: string;
      };
      hash: string;
      html: string;
    };

    assert.equal(acceptedAfterFailure, acceptedBefore);
    assert.match(inspected.html, /待修复版本/);
    assert.equal(inspected.diagnostics.status, "failed");
    assert.equal(
      inspected.diagnostics.diagnostics.errors[0]?.code,
      "SLIDE_CONTENT_OUTSIDE_CANVAS",
    );

    await assert.rejects(
      runTool(
        "patch_slide_fragment",
        {
          baseHash: "0".repeat(64),
          deckDir: "demo-deck",
          find: "height:900px",
          replace: "height:600px",
          slideId: "01-cover",
        },
        workspaceRoot,
      ),
      /SLIDE_HASH_MISMATCH/,
    );
    await assert.rejects(
      runTool(
        "patch_slide_fragment",
        {
          baseHash: inspected.hash,
          deckDir: "demo-deck",
          expectedOccurrences: 1,
          find: "height:1000px",
          replace: "height:600px",
          slideId: "01-cover",
        },
        workspaceRoot,
      ),
      /SLIDE_PATCH_MATCH_COUNT_MISMATCH/,
    );

    const patchResult = await runTool(
      "patch_slide_fragment",
      {
        baseHash: inspected.hash,
        deckDir: "demo-deck",
        expectedOccurrences: 1,
        find: "height:900px",
        replace: "height:600px",
        slideId: "01-cover",
      },
      workspaceRoot,
    );
    const acceptedAfterPatch = await readFile(acceptedPath, "utf8");

    assert.match(patchResult, /重新执行完整 slide 验证/);
    assert.match(acceptedAfterPatch, /height:600px/);
    assert.match(acceptedAfterPatch, /待修复版本/);
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("reports clipped text as a hard semantic diagnostic", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "ranni-slide-text-clipping-"),
  );

  try {
    await prepareDeck(workspaceRoot, ["01-cover"]);
    await assert.rejects(
      runTool(
        "write_slide_fragment",
        {
          deckDir: "demo-deck",
          slideId: "01-cover",
          html: [
            '<section class="slide" data-slide-id="01-cover">',
            '  <div style="width:80px;height:20px;overflow:hidden;white-space:nowrap">这是一段会被容器裁切的长文本</div>',
            "</section>",
          ].join("\n"),
        },
        workspaceRoot,
      ),
      /SLIDE_TEXT_CLIPPED/,
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("assembles a thirteen-slide deck without a full-file model payload", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "ranni-thirteen-slides-"),
  );
  const slideIds = Array.from(
    { length: 13 },
    (_, index) => `${String(index + 1).padStart(2, "0")}-slide`,
  );

  try {
    await prepareDeck(workspaceRoot, slideIds);

    for (const [index, slideId] of slideIds.entries()) {
      await runTool(
        "write_slide_fragment",
        {
          deckDir: "demo-deck",
          slideId,
          html: `<section class="slide" data-slide-id="${slideId}"><p>第 ${index + 1} 页</p></section>`,
        },
        workspaceRoot,
      );
    }

    await runTool(
      "assemble_slide_deck",
      { deckDir: "demo-deck" },
      workspaceRoot,
    );
    const deckHtml = await readFile(
      path.join(workspaceRoot, "demo-deck", "deck.html"),
      "utf8",
    );

    assert.equal((deckHtml.match(/class="slide"/g) ?? []).length, 13);
    assert.ok(deckHtml.indexOf("第 1 页") < deckHtml.indexOf("第 13 页"));
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});
