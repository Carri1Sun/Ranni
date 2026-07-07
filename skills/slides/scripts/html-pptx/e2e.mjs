// HTML-to-PPTX 端到端自动化验证。
//
// 目标：跑通 "结构化 prompt -> 创作受限 slide HTML -> prepare -> export -> validate -> 断言"。
// 创作步骤用一个确定性的 buildDeckHtml(prompt) 代替 LLM（保证可复现），
// 真实运行 prepare.mjs/export.mjs/validate.mjs（与 tools.ts 同一路径）。
//
// 断言：pptx 有效 zip、slide 数一致、可编辑 <a:t> 命中关键文本、qa-report libreoffice=rendered、
// 像素 diff 可用且无空白页、字体嵌入子用例产出含嵌入字体的 pptx。
//
// 用法：node skills/slides/scripts/html-pptx/e2e.mjs
// 退出码 0=全绿，1=有失败项。

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

const requireFromE2E = createRequire(import.meta.url);
const SCRIPTS_DIR = path.resolve(process.cwd(), "skills", "slides", "scripts", "html-pptx");
const TEMPLATE_DIR = path.resolve(process.cwd(), "skills", "slides", "templates", "slide-html");
const CODICON_CANDIDATES = [
  "node_modules/playwright-core/lib/vite/recorder/assets/codicon-DCmgc-ay.ttf",
  "node_modules/playwright-core/lib/vite/traceViewer/codicon.DCmgc-ay.ttf",
  "node_modules/playwright-core/lib/vite/dashboard/assets/codicon-DCmgc-ay.ttf",
]
  .map((rel) => path.resolve(process.cwd(), rel))
  .filter((abs) => fsSync.existsSync(abs));
const CODICON_TTF = CODICON_CANDIDATES[0];

const results = [];
function check(name, condition, detail = "") {
  results.push({ name, ok: Boolean(condition), detail });
  const tag = condition ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function runScript(script, config) {
  const child = spawn(process.execPath, [path.join(SCRIPTS_DIR, script), JSON.stringify(config)], {
    cwd: process.cwd(),
    env: { ...process.env },
  });
  let stdout = "";
  let stderr = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${script} 超时`));
    }, 240_000);
    child.stdout.on("data", (c) => {
      stdout += c.toString();
    });
    child.stderr.on("data", (c) => {
      stderr += c.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`${script} 退出码 ${code}: ${stderr.trim().slice(0, 300)}`));
      } else {
        resolve();
      }
    });
  });
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  return last.startsWith("{") ? JSON.parse(last) : {};
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 确定性 builder：把结构化 prompt 转成受限 slide HTML（覆盖若干页型）。
function buildDeckHtml(prompt) {
  const slides = prompt.slides.map((s, i) => {
    const slideId = s.slideId || `slide-${i + 1}`;
    if (s.kind === "cover") {
      return `  <section class="slide cover" data-slide-id="${slideId}">
    <div class="cover-inner">
      <span class="cover-badge" data-pptx-editable>${esc(s.badge || "")}</span>
      <h1 class="cover-title" data-pptx-editable>${esc(s.title || "")}</h1>
      <p class="cover-sub" data-pptx-editable>${esc(s.subtitle || "")}</p>
    </div>
  </section>`;
    }
    if (s.kind === "bullets") {
      const items = (s.bullets || []).map((b) => `        <li data-pptx-editable>${esc(b)}</li>`).join("\n");
      return `  <section class="slide" data-slide-id="${slideId}">
    <div class="slide-pad">
      <p class="slide-eyebrow" data-pptx-editable>${esc(s.eyebrow || "")}</p>
      <h2 class="slide-title" data-pptx-editable>${esc(s.title || "")}</h2>
      <ul class="bullets">
${items}
      </ul>
    </div>
  </section>`;
    }
    if (s.kind === "two-col") {
      const items = (s.bullets || []).map((b) => `          <li data-pptx-editable>${esc(b)}</li>`).join("\n");
      return `  <section class="slide" data-slide-id="${slideId}">
    <div class="slide-pad">
      <div class="two-col">
        <div class="col-text">
          <p class="slide-eyebrow" data-pptx-editable>${esc(s.eyebrow || "")}</p>
          <h2 class="slide-title" data-pptx-editable>${esc(s.title || "")}</h2>
          <ul class="bullets">
${items}
          </ul>
        </div>
        <div class="col-media">
          <div class="media-frame"><img src="assets/illustration.svg" alt="${esc(s.imageAlt || "")}" data-pptx-editable /></div>
        </div>
      </div>
    </div>
  </section>`;
    }
    if (s.kind === "table") {
      const head = (s.head || []).map((h) => `              <th data-pptx-editable>${esc(h)}</th>`).join("\n");
      const rows = (s.rows || [])
        .map(
          (r) =>
            `            <tr>\n${r.map((c, ci) => `              <td${ci >= 1 ? ' class="num"' : ""} data-pptx-editable>${esc(c)}</td>`).join("\n")}\n            </tr>`,
        )
        .join("\n");
      return `  <section class="slide" data-slide-id="${slideId}">
    <div class="slide-pad">
      <p class="slide-eyebrow" data-pptx-editable>${esc(s.eyebrow || "")}</p>
      <h2 class="slide-title" data-pptx-editable>${esc(s.title || "")}</h2>
      <table class="data-table">
        <thead><tr>
${head}
        </tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </div>
  </section>`;
    }
    if (s.kind === "raster") {
      const bars = (s.bars || [40, 65, 80, 95])
        .map(
          (h, idx) =>
            `          <div class="bar-group"><div class="bar" style="height:${h}%"></div><div class="bar-label">Q${idx + 1}</div></div>`,
        )
        .join("\n");
      return `  <section class="slide" data-slide-id="${slideId}">
    <div class="slide-pad">
      <p class="slide-eyebrow" data-pptx-editable>${esc(s.eyebrow || "")}</p>
      <h2 class="slide-title" data-pptx-editable>${esc(s.title || "")}</h2>
      <div class="raster-block" data-pptx-raster data-pptx-alt="${esc(s.alt || "chart fallback")}">
${bars}
      </div>
    </div>
  </section>`;
    }
    if (s.kind === "summary") {
      const cards = (s.cards || [])
        .map(
          (c) =>
            `          <div class="sum-card"><h4 data-pptx-editable>${esc(c.h)}</h4><p data-pptx-editable>${esc(c.p)}</p></div>`,
        )
        .join("\n");
      return `  <section class="slide summary" data-slide-id="${slideId}">
    <div class="summary-inner">
      <h2 class="summary-title" data-pptx-editable>${esc(s.title || "")}</h2>
      <div class="summary-grid">
${cards}
      </div>
    </div>
  </section>`;
    }
    return "";
  });
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>${esc(prompt.title || "deck")}</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <main class="deck" data-pptx-deck>
${slides.join("\n")}
    </main>
  </body>
</html>`;
}

async function readPptxSlidesAndTexts(pptxPath, jszip) {
  const zip = await jszip.loadAsync(await fs.readFile(pptxPath));
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => firstInt(a) - firstInt(b));
  const texts = [];
  for (const name of slideNames) {
    const xml = await zip.file(name).async("string");
    const matches = xml.match(/<a:t>[^<]*<\/a:t>/g) || [];
    texts.push(matches.map((m) => m.replace(/<\/?a:t>/g, "")));
  }
  const fontFiles = Object.keys(zip.files).filter((n) => n.startsWith("ppt/fonts/"));
  const presentationXml = await zip.file("ppt/presentation.xml").async("string");
  return {
    slideCount: slideNames.length,
    texts,
    fontFiles,
    embeddedFontList: presentationXml.includes("embeddedFontLst"),
  };
}

function firstInt(name) {
  const m = name.match(/(\d+)/);
  return m ? Number.parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

async function setupDeck(name, html, { withFont = false } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `ranni-e2e-${name}-`));
  await fs.cp(TEMPLATE_DIR, dir, { recursive: true });
  await fs.mkdir(path.join(dir, "final"), { recursive: true });
  await fs.writeFile(path.join(dir, "deck.html"), html, "utf8");
  if (withFont) {
    await fs.mkdir(path.join(dir, "assets", "fonts"), { recursive: true });
    await fs.copyFile(CODICON_TTF, path.join(dir, "assets", "fonts", "codicon.ttf"));
  }
  return dir;
}

async function main() {
  const jszip = tryLoad(jszipName());
  if (!jszip) {
    console.log("FATAL: jszip 不可用，无法断言。");
    process.exit(1);
  }
  if (!fsSync.existsSync(CODICON_TTF)) {
    console.log(`FATAL: 找不到测试字体 ${CODICON_TTF}`);
    process.exit(1);
  }

  // ---- 用例 1：主 deck（prompt -> html -> ppt 全链路）----
  console.log("\n=== 用例 1：主 deck 端到端 ===");
  const prompt = {
    title: "Ranni 端到端验证 Deck",
    slides: [
      {
        kind: "cover",
        slideId: "cover",
        badge: "E2E · 自动验证",
        title: "HTML 到可编辑 PPTX 的自动验证",
        subtitle: "确定性 builder 生成受限 slide HTML，跑通 prepare、export、validate 全链路。",
      },
      {
        kind: "bullets",
        slideId: "goals",
        eyebrow: "Goals",
        title: "本次验证目标",
        bullets: ["pptx 是有效 zip 且 slide 数一致", "关键文本保留为可编辑 <a:t>", "像素 diff 可用且无空白页", "字体可经 @font-face 嵌入"],
      },
      {
        kind: "two-col",
        slideId: "story",
        eyebrow: "Two column",
        title: "左文右图页型",
        bullets: ["左侧叙事", "右侧本地化插画资产"],
        imageAlt: "季度增长插画",
      },
      {
        kind: "table",
        slideId: "metrics",
        eyebrow: "Metrics",
        title: "关键指标",
        head: ["指标", "数值", "趋势"],
        rows: [
          ["营收", "¥ 1.28M", "上升"],
          ["用户", "45.2k", "上升"],
          ["流失", "3.9%", "下降"],
        ],
      },
      {
        kind: "raster",
        slideId: "chart",
        eyebrow: "Raster",
        title: "复杂图表截图回退",
        alt: "季度柱状图回退",
        bars: [45, 62, 78, 95],
      },
      {
        kind: "summary",
        slideId: "summary",
        title: "验证结论",
        cards: [
          { h: "管线跑通", p: "从 prompt 到 ppt 全自动。" },
          { h: "高保真", p: "像素差异在可接受范围。" },
        ],
      },
    ],
  };

  const dir = await setupDeck("main", buildDeckHtml(prompt));
  const deckHtml = path.join(dir, "deck.html");
  const prepared = path.join(dir, "deck.prepared.html");
  const measurements = path.join(dir, "measurements.json");
  const pptx = path.join(dir, "final", "e2e-deck.pptx");
  const previewHtml = path.join(dir, "preview-html");
  const previewPptx = path.join(dir, "preview-pptx");
  const qaReport = path.join(dir, "qa-report.json");

  try {
    const prep = await runScript("prepare.mjs", {
      deckHtml,
      deckDir: dir,
      fallbackDir: path.join(dir, "fallback-assets"),
      outHtml: prepared,
      measurements,
      deviceScaleFactor: 2,
    });
    check("prepare 返回 ok", prep.ok === true);
    check("prepare 识别全部页", prep.slides === prompt.slides.length, `slides=${prep.slides}`);
    check("prepare 截图回退命中 raster 页", prep.raster === 1, `raster=${prep.raster}`);

    const exp = await runScript("export.mjs", {
      preparedHtml: prepared,
      outPptx: pptx,
      deckName: "e2e-deck",
      author: "Ranni-e2e",
    });
    check("export 返回 ok", exp.ok === true);
    check("export 无页面错误", Array.isArray(exp.pageErrors) && exp.pageErrors.length === 0, `errors=${(exp.pageErrors || []).length}`);

    const stat = await fs.stat(pptx);
    check("pptx 已生成且非空", stat.size > 1000, `bytes=${stat.size}`);
    const head = Buffer.alloc(2);
    const fh = await fs.open(pptx, "r");
    await fh.read(head, 0, 2, 0);
    await fh.close();
    check("pptx 是有效 zip（PK 头）", head[0] === 0x50 && head[1] === 0x4b);

    const info = await readPptxSlidesAndTexts(pptx, jszip);
    check("pptx slide 数与 prompt 一致", info.slideCount === prompt.slides.length, `pptx=${info.slideCount}`);
    const allText = info.texts.flat().join("\n");
    check("pptx 含封面标题文本", allText.includes("HTML 到可编辑 PPTX 的自动验证"));
    check("pptx 含表格单元格文本", allText.includes("¥ 1.28M"));
    check("pptx 关键文本为可编辑 <a:t>", allText.includes("本次验证目标"));

    const val = await runScript("validate.mjs", {
      deckHtml,
      pptx,
      measurements,
      previewHtmlDir: previewHtml,
      previewPptxDir: previewPptx,
      qaReport,
      deckDir: dir,
    });
    check("validate 返回 ok", val.ok === true);
    const qa = JSON.parse(await fs.readFile(qaReport, "utf8"));
    check("qa libreoffice=rendered", qa.compatibility.libreoffice === "rendered", qa.compatibility.libreoffice);
    check("qa 像素 diff 可用", qa.previewDiff.available === true);
    check("qa 无空白页告警", !qa.warnings.some((w) => w.type === "blank-slide-suspected"));
    const maxMismatch = Math.max(
      ...(qa.previewDiff.slides || []).map((s) => s.mismatchPercent ?? 0),
    );
    check("qa 最大页差异 < 25%", maxMismatch < 25, `maxMismatch=${maxMismatch}%`);
    check("qa pptx 预览页数一致", qa.previews.pptx.count === prompt.slides.length, `count=${qa.previews.pptx.count}`);

    // ---- 用例 2：字体嵌入子用例 ----
    console.log("\n=== 用例 2：@font-face 字体嵌入 ===");
    const fontHtml = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>font embed test</title>
    <link rel="stylesheet" href="styles.css" />
    <style>
      @font-face {
        font-family: "E2EIcon";
        src: url("assets/fonts/codicon.ttf") format("truetype");
      }
      .iconified {
        font-family: "E2EIcon", var(--font-sans);
        color: var(--accent);
        font-size: 28px;
      }
    </style>
  </head>
  <body>
    <main class="deck" data-pptx-deck>
      <section class="slide" data-slide-id="font">
        <div class="slide-pad">
          <h2 class="slide-title" data-pptx-editable>字体嵌入测试</h2>
          <p class="iconified" data-pptx-editable>Font embedding check</p>
          <p class="slide-lede" data-pptx-editable>该页声明了 @font-face E2EIcon，验证 dom-to-pptx 自动嵌入。</p>
        </div>
      </section>
    </main>
  </body>
</html>`;
    const fdir = await setupDeck("font", fontHtml, { withFont: true });
    const fprepared = path.join(fdir, "deck.prepared.html");
    const fmeasure = path.join(fdir, "measurements.json");
    const fpptx = path.join(fdir, "final", "font-deck.pptx");
    try {
      await runScript("prepare.mjs", {
        deckHtml: path.join(fdir, "deck.html"),
        deckDir: fdir,
        fallbackDir: path.join(fdir, "fallback-assets"),
        outHtml: fprepared,
        measurements: fmeasure,
        deviceScaleFactor: 2,
      });
      await runScript("export.mjs", {
        preparedHtml: fprepared,
        outPptx: fpptx,
        deckName: "font-deck",
        author: "Ranni-e2e",
      });
      const finfo = await readPptxSlidesAndTexts(fpptx, jszip);
      const embedded = finfo.embeddedFontList || finfo.fontFiles.length > 0;
      check("字体 pptx 含嵌入字体（embeddedFontLst 或 ppt/fonts/）", embedded, `fonts=${JSON.stringify(finfo.fontFiles)} embeddedFontLst=${finfo.embeddedFontList}`);
    } finally {
      await fs.rm(fdir, { recursive: true, force: true }).catch(() => {});
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  // ---- 汇总 ----
  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== 汇总：${results.length - failed.length}/${results.length} 通过 ===`);
  if (failed.length > 0) {
    console.log("失败项：");
    failed.forEach((r) => console.log(`  - ${r.name}${r.detail ? ` (${r.detail})` : ""}`));
    process.exit(1);
  }
  console.log("端到端验证全部通过。");
}

function jszipName() {
  return "jszip";
}
function tryLoad(name) {
  try {
    return requireFromE2E(name);
  } catch {
    return null;
  }
}

main().catch((error) => {
  console.error("e2e 异常：", error instanceof Error ? error.stack : error);
  process.exit(1);
});
