// export_html_to_pptx 的执行脚本。
// 用 Playwright 打开 deck.prepared.html，注入 dom-to-pptx 浏览器 bundle，
// 调用 exportToPptx(slides, { skipDownload: true }) 拿到 Blob，转成字节落盘为 .pptx。
// 单一浏览器会话完成导出，避免引入第二个 headless 浏览器。
// 配置通过 argv[2] 传入 JSON：{ preparedHtml, outPptx, deckName, author, deviceScaleFactor }

import fs from "node:fs/promises";
import path from "node:path";

import {
  ensureDir,
  launchBrowser,
  newSlidePage,
  resolveDomToPptxBundle,
} from "./lib.mjs";

function parseConfig() {
  const raw = process.argv[2];
  if (!raw) {
    throw new Error("export.mjs 缺少配置参数（argv[2]）。");
  }
  const cfg = JSON.parse(raw);
  for (const key of ["preparedHtml", "outPptx"]) {
    if (!cfg[key]) {
      throw new Error(`export.mjs 配置缺少必填字段：${key}`);
    }
  }
  return cfg;
}

async function main() {
  const cfg = parseConfig();
  const deviceScaleFactor = cfg.deviceScaleFactor ?? 1;
  const bundle = resolveDomToPptxBundle();

  const browser = await launchBrowser();
  try {
    const page = await newSlidePage(browser, deviceScaleFactor);
    // 收集页面内的异常与 console，便于在 qa 报告里追溯 dom-to-pptx 的警告。
    const pageErrors = [];
    page.on("pageerror", (error) =>
      pageErrors.push(`pageerror: ${error.message}`),
    );
    page.on("console", (message) => {
      if (message.type() === "error") {
        pageErrors.push(`console.error: ${message.text()}`);
      }
    });

    await page.goto(`file://${cfg.preparedHtml}`, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });

    await page.addScriptTag({ path: bundle });
    await page.waitForFunction(
      () =>
        Boolean(window.domToPptx) &&
        typeof window.domToPptx.exportToPptx === "function",
      { timeout: 10_000 },
    );

    // dom-to-pptx 读取每个元素相对 slide 根的最终 x/y/w/h，自动缩放到 16:9。
    // layout 用 LAYOUT_WIDE（13.333x7.5in），与 1280x720 HTML（dsf2 预览 2560x1440）
    // 在 192dpi 下逐像素对齐，便于 validate 做像素差异检测。
    // autoEmbedFonts：受限 deck 默认系统字体时关闭；若 deck 提供 @font-face 本地字体会自动嵌入。
    const autoEmbedFonts = cfg.autoEmbedFonts !== false;
    const result = await page.evaluate(async (opts) => {
      const slides = Array.from(document.querySelectorAll(".slide"));
      const blob = await window.domToPptx.exportToPptx(slides, {
        fileName: "deck.pptx",
        skipDownload: true,
        layout: "LAYOUT_WIDE",
        autoEmbedFonts: opts.autoEmbedFonts,
      });
      const buffer = await blob.arrayBuffer();
      const bytes = Array.from(new Uint8Array(buffer));
      return { slideCount: slides.length, bytes };
    }, { autoEmbedFonts });

    await ensureDir(path.dirname(cfg.outPptx));
    await fs.writeFile(cfg.outPptx, Buffer.from(result.bytes));
    const stat = await fs.stat(cfg.outPptx);

    console.log(
      JSON.stringify({
        ok: true,
        pptx: cfg.outPptx,
        bytes: stat.size,
        slides: result.slideCount,
        pageErrors,
      }),
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
