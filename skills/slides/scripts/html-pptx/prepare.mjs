// prepare_slide_html_for_pptx 的执行脚本。
// 用 Playwright 打开受限 slide HTML：
//   1. 测量每个 .slide 与其中的 [data-pptx-raster] 节点（相对 slide 的盒模型、z-index、alt）。
//   2. 对每个 [data-pptx-raster] 节点截图，保存到 fallback-assets/<slideId>-<index>.png。
//   3. 在 DOM 中原位把该节点内容替换为等尺寸 <img>（保持原盒子与文档流，避免版式漂移）。
//   4. 序列化页面得到 deck.prepared.html，并写 measurements.json。
// 配置通过 argv[2] 传入 JSON：{ deckHtml, deckDir, fallbackDir, outHtml, measurements, deviceScaleFactor }
// 所有路径均为绝对路径（由 tools.ts 的 resolveWorkspacePath 解析）。

import fs from "node:fs/promises";
import path from "node:path";

import {
  SLIDE_H,
  SLIDE_W,
  ensureDir,
  encodeDataUri,
  launchBrowser,
  newSlidePage,
  resolveLocalImageSrc,
} from "./lib.mjs";

function parseConfig() {
  const raw = process.argv[2];
  if (!raw) {
    throw new Error("prepare.mjs 缺少配置参数（argv[2]）。");
  }
  const cfg = JSON.parse(raw);
  for (const key of ["deckHtml", "deckDir", "fallbackDir", "outHtml", "measurements"]) {
    if (!cfg[key]) {
      throw new Error(`prepare.mjs 配置缺少必填字段：${key}`);
    }
  }
  return cfg;
}

async function main() {
  const cfg = parseConfig();
  const deviceScaleFactor = cfg.deviceScaleFactor ?? 2;
  const warnings = [];

  const browser = await launchBrowser();
  try {
    const page = await newSlidePage(browser, deviceScaleFactor);
    await page.goto(`file://${cfg.deckHtml}`, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    // 给本地字体 / 图片一点额外沉淀时间。
    await page.waitForTimeout(300);

    // Pass 1：从原始 DOM 收集测量元数据。
    const meta = await page.evaluate(() => {
      const slideEls = Array.from(document.querySelectorAll(".slide"));
      const slides = slideEls.map((slide, order) => {
        const slideRect = slide.getBoundingClientRect();
        const slideId =
          slide.getAttribute("data-slide-id") || `slide-${order + 1}`;
        const rasterNodes = Array.from(
          slide.querySelectorAll("[data-pptx-raster]"),
        );
        const raster = rasterNodes.map((node, index) => {
          const rect = node.getBoundingClientRect();
          const computed = getComputedStyle(node);
          return {
            index,
            box: {
              x: Math.round(rect.left - slideRect.left),
              y: Math.round(rect.top - slideRect.top),
              w: Math.round(rect.width),
              h: Math.round(rect.height),
            },
            zIndex: computed.zIndex,
            alt: node.getAttribute("data-pptx-alt") || "",
          };
        });
        const editable = slide.querySelectorAll("[data-pptx-editable]").length;
        return { order, slideId, raster, editable };
      });
      return {
        slides,
        totals: {
          slides: slides.length,
          raster: slides.reduce((acc, s) => acc + s.raster.length, 0),
          editable: slides.reduce((acc, s) => acc + s.editable, 0),
        },
      };
    });

    if (meta.totals.slides === 0) {
      warnings.push({
        type: "no-slides",
        message: "未找到任何 .slide 元素，请确认 HTML 符合受限 slide 规范。",
      });
    }

    // 校验 .slide 实际尺寸是否为 1280x720。
    const sizes = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".slide")).map((el) => {
        const rect = el.getBoundingClientRect();
        return { w: Math.round(rect.width), h: Math.round(rect.height) };
      }),
    );
    sizes.forEach((size, index) => {
      if (size.w !== SLIDE_W || size.h !== SLIDE_H) {
        warnings.push({
          slideIndex: index,
          type: "slide-size",
          message: `第 ${index + 1} 页 .slide 实际尺寸 ${size.w}x${size.h}，期望 ${SLIDE_W}x${SLIDE_H}。`,
        });
      }
    });

    await ensureDir(cfg.fallbackDir);

    // Pass 2：对每个 [data-pptx-raster] 节点截图（document order 与 meta 一致）。
    const handles = await page.$$("[data-pptx-raster]");
    let cursor = 0;
    for (const slide of meta.slides) {
      for (const raster of slide.raster) {
        const handle = handles[cursor];
        cursor += 1;
        if (!handle) {
          warnings.push({
            slideId: slide.slideId,
            type: "screenshot-missing-handle",
            message: "找不到对应的 DOM 节点句柄。",
          });
          continue;
        }
        const file = path.join(
          cfg.fallbackDir,
          `${slide.slideId}-${raster.index}.png`,
        );
        try {
          await handle.screenshot({ path: file, type: "png" });
          raster.asset = path.relative(cfg.deckDir, file);
          raster.assetAbsolute = file;
        } catch (error) {
          warnings.push({
            slideId: slide.slideId,
            type: "screenshot-failed",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    // Pass 3：原位把每个 [data-pptx-raster] 节点替换为等尺寸 <img>。
    // 保持原盒子与文档流（不清空父布局），img 以 absolute inset:0 填满节点。
    await page.evaluate(() => {
      const slideEls = Array.from(document.querySelectorAll(".slide"));
      const nodes = Array.from(document.querySelectorAll("[data-pptx-raster]"));
      for (const node of nodes) {
        const slide = node.closest(".slide");
        const order = slideEls.indexOf(slide);
        const slideId =
          slide?.getAttribute("data-slide-id") || `slide-${order + 1}`;
        const rasterInSlide = slide
          ? Array.from(slide.querySelectorAll("[data-pptx-raster]"))
          : [];
        const index = rasterInSlide.indexOf(node);
        const alt = node.getAttribute("data-pptx-alt") || "";
        const src = `fallback-assets/${slideId}-${index}.png`;

        node.replaceChildren();
        node.textContent = "";
        const computed = getComputedStyle(node);
        if (computed.position === "static") {
          node.style.position = "relative";
        }
        node.style.background = "transparent";
        node.style.border = "none";

        const img = document.createElement("img");
        img.src = src;
        img.alt = alt;
        img.setAttribute("data-pptx-raster-replaced", "");
        img.style.cssText =
          "position:absolute;inset:0;width:100%;height:100%;display:block;object-fit:fill;";
        node.appendChild(img);
        node.setAttribute("data-pptx-raster-replaced", "");
      }
    });

    // Pass 3b：移除 [data-pptx-ignore] 节点（导出时忽略，例如 HTML 分页页码等冗余信息）。
    const ignoredCount = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll("[data-pptx-ignore]"));
      for (const node of nodes) {
        node.remove();
      }
      return nodes.length;
    });

    // Pass 4：把所有本地 <img> 内联为 data URI。
    // file:// 页面里 dom-to-pptx 用 canvas 读图片像素会触发 CORS；data URI 无此问题，
    // 同时让 deck.prepared.html 自包含（不依赖 fallback-assets/ 文件路径）。
    const imgSrcs = await page.$$eval("img", (imgs) =>
      imgs.map((img) => img.getAttribute("src") || ""),
    );
    const dataUriBySrc = {};
    let inlinedImages = 0;
    for (const src of Array.from(new Set(imgSrcs))) {
      const abs = resolveLocalImageSrc(src, cfg.deckDir);
      if (!abs) {
        continue;
      }
      const dataUri = await encodeDataUri(abs);
      if (dataUri) {
        dataUriBySrc[src] = dataUri;
        inlinedImages += 1;
      } else {
        warnings.push({
          type: "image-inline-missing",
          message: `无法读取图片，未内联：${src}`,
        });
      }
    }
    if (Object.keys(dataUriBySrc).length > 0) {
      await page.evaluate((mapping) => {
        for (const img of Array.from(document.images)) {
          const current = img.getAttribute("src") || "";
          if (mapping[current]) {
            img.src = mapping[current];
          }
        }
      }, dataUriBySrc);
      // 等待 data URI 图片解码完成，避免导出时读到空像素。
      await page.evaluate(async () => {
        await Promise.all(
          Array.from(document.images).map((img) =>
            img.complete
              ? Promise.resolve()
              : new Promise((resolve) => {
                  img.onload = img.onerror = () => resolve();
                }),
          ),
        );
      });
    }

    const preparedHtml = await page.content();
    await ensureDir(path.dirname(cfg.outHtml));
    await fs.writeFile(cfg.outHtml, preparedHtml, "utf8");

    const measurements = {
      deckHtml: cfg.deckHtml,
      preparedHtml: cfg.outHtml,
      viewport: { width: SLIDE_W, height: SLIDE_H, deviceScaleFactor },
      slides: meta.slides,
      totals: { ...meta.totals, inlinedImages, ignored: ignoredCount },
      warnings,
    };
    await fs.writeFile(
      cfg.measurements,
      JSON.stringify(measurements, null, 2),
      "utf8",
    );

    console.log(
      JSON.stringify({
        ok: true,
        slides: meta.totals.slides,
        raster: meta.totals.raster,
        editable: meta.totals.editable,
        inlinedImages,
        ignored: ignoredCount,
        warningCount: warnings.length,
        preparedHtml: cfg.outHtml,
        measurements: cfg.measurements,
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
