// validate_html_pptx_export 的执行脚本。
// 做可自动化的质量校验，并写 qa-report.json：
//   - preview-html/：用 Playwright 对原始 deck.html 的每个 .slide 截图（dsf 2，2560x1440）。
//   - preview-pptx/：LibreOffice 把 .pptx 转 pdf，再用 poppler pdftoppm 拆成逐页 png（192dpi，2560x1440）。
//   - 像素差异：pixelmatch 逐页比对 preview-html 与 preview-pptx，记录 mismatch% 与空白页风险。
//   - jszip 读 pptx slide 数量与内嵌媒体体积（光栅化/体积信号）。
//   - 检查 measurements.json 中记录的截图回退资源是否都存在。
// 任何渲染依赖缺失（soffice/pdftoppm/pixelmatch）都显式降级并写进 warnings，不静默通过。
// 配置通过 argv[2] 传入 JSON：
//   { deckHtml, pptx, measurements, previewHtmlDir, previewPptxDir, qaReport, deckDir }

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ensureDir,
  findLibreOffice,
  findPdftoppm,
  launchBrowser,
  newSlidePage,
  pathExists,
  tryLoadJszip,
  tryLoadPixelmatch,
} from "./lib.mjs";

const execFileAsync = promisify(execFile);
const PDF_DPI = 192; // 与 1280x720 HTML 在 dsf2 下的 2560x1440 逐像素对齐

function parseConfig() {
  const raw = process.argv[2];
  if (!raw) {
    throw new Error("validate.mjs 缺少配置参数（argv[2]）。");
  }
  const cfg = JSON.parse(raw);
  for (const key of ["deckHtml", "pptx", "qaReport", "previewHtmlDir", "previewPptxDir"]) {
    if (!cfg[key]) {
      throw new Error(`validate.mjs 配置缺少必填字段：${key}`);
    }
  }
  return cfg;
}

async function readMeasurements(measurementsPath) {
  if (!measurementsPath) {
    return null;
  }
  try {
    return JSON.parse(await fs.readFile(measurementsPath, "utf8"));
  } catch {
    return null;
  }
}

function firstInt(name) {
  const match = name.match(/(\d+)/);
  return match ? Number.parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
}

async function listPngsByOrder(dir) {
  let entries = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith(".png"))
    .map((name) => ({ name, path: path.join(dir, name) }))
    .sort((a, b) => firstInt(a.name) - firstInt(b.name));
}

async function renderHtmlPreviews(cfg, warnings) {
  const status = { dir: cfg.previewHtmlDir, count: 0, ok: false };
  try {
    const browser = await launchBrowser();
    try {
      const page = await newSlidePage(browser, 2);
      await page.goto(`file://${cfg.deckHtml}`, {
        waitUntil: "networkidle",
        timeout: 30_000,
      });
      const slides = await page.$$(".slide");
      await ensureDir(cfg.previewHtmlDir);
      for (let index = 0; index < slides.length; index += 1) {
        const slideId = await slides[index].evaluate(
          (el, i) => el.getAttribute("data-slide-id") || `slide-${i + 1}`,
          index,
        );
        const file = path.join(
          cfg.previewHtmlDir,
          `${String(index + 1).padStart(2, "0")}-${slideId}.png`,
        );
        await slides[index].screenshot({ path: file, type: "png" });
      }
      status.count = slides.length;
      status.ok = true;
    } finally {
      await browser.close();
    }
  } catch (error) {
    warnings.push({
      type: "preview-html-failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return status;
}

async function renderPptxPreviews(cfg, warnings) {
  const status = {
    dir: cfg.previewPptxDir,
    renderer: "not_checked",
    reason: "",
    count: 0,
    pngs: [],
  };
  const soffice = await findLibreOffice();
  const pdftoppm = findPdftoppm();
  if (!soffice) {
    status.reason = "未找到 soffice/libreoffice，PPTX 预览渲染跳过。";
    warnings.push({ type: "preview-pptx-unavailable", message: status.reason });
    return status;
  }
  if (!(await pathExists(cfg.pptx))) {
    status.reason = "PPTX 文件不存在，无法渲染预览。";
    warnings.push({ type: "preview-pptx-missing-pptx", message: status.reason });
    return status;
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "ranni-lo-"));
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), "ranni-lo-profile-"));
  try {
    // 1. pptx -> pdf（LibreOffice 首次运行较慢，给足超时；隔离 UserInstallation 避免锁冲突）。
    try {
      await execFileAsync(
        soffice,
        [
          "--headless",
          `-env:UserInstallation=file://${profileDir}`,
          "--convert-to",
          "pdf",
          "--outdir",
          workDir,
          cfg.pptx,
        ],
        { timeout: 120_000 },
      );
    } catch (error) {
      status.reason = `pptx->pdf 失败：${error instanceof Error ? error.message : String(error)}`;
      warnings.push({ type: "preview-pptx-failed", message: status.reason });
      return status;
    }
    const pdfs = (await fs.readdir(workDir)).filter((n) => n.endsWith(".pdf"));
    if (pdfs.length === 0) {
      status.reason = "LibreOffice 未生成 pdf。";
      warnings.push({ type: "preview-pptx-failed", message: status.reason });
      return status;
    }
    const pdfPath = path.join(workDir, pdfs[0]);

    // 2. pdf -> 逐页 png。
    await ensureDir(cfg.previewPptxDir);
    if (!pdftoppm) {
      status.reason = "未找到 pdftoppm（poppler），无法把 pdf 拆成 png；已保留中间 pdf。";
      warnings.push({ type: "preview-pptx-no-pdftoppm", message: status.reason });
      status.renderer = "libreoffice-pdf-only";
      return status;
    }
    const outPrefix = path.join(cfg.previewPptxDir, "slide");
    try {
      await execFileAsync(pdftoppm, ["-png", "-r", String(PDF_DPI), pdfPath, outPrefix], {
        timeout: 60_000,
      });
    } catch (error) {
      status.reason = `pdftoppm 失败：${error instanceof Error ? error.message : String(error)}`;
      warnings.push({ type: "preview-pptx-failed", message: status.reason });
      return status;
    }
    const pngs = await listPngsByOrder(cfg.previewPptxDir);
    status.pngs = pngs.map((entry) => entry.path);
    status.count = pngs.length;
    status.renderer = "libreoffice";
  } finally {
    // 清理临时目录（保留 preview-pptx 产物）。
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
  return status;
}

async function summarizePptxMedia(pptxPath, warnings) {
  const jszip = tryLoadJszip();
  if (!jszip || !(await pathExists(pptxPath))) {
    return null;
  }
  try {
    const zip = await jszip.loadAsync(await fs.readFile(pptxPath));
    const slideNames = Object.keys(zip.files).filter((name) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(name),
    );
    const media = await Promise.all(
      Object.entries(zip.files)
        .filter(([name]) => name.startsWith("ppt/media/"))
        .map(async ([name, file]) => {
          const buf = await file.async("nodebuffer");
          return { name, bytes: buf.length };
        }),
    );
    const totalBytes = media.reduce((acc, item) => acc + item.bytes, 0);
    const largest = media.reduce(
      (acc, item) => (item.bytes > acc.bytes ? item : acc),
      { name: "", bytes: 0 },
    );
    return { slideCount: slideNames.length, mediaCount: media.length, totalBytes, largest };
  } catch (error) {
    warnings.push({
      type: "pptx-read-failed",
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function computeLumaStats(png) {
  const { data, width, height } = png;
  let sum = 0;
  let sumSq = 0;
  const pixels = width * height;
  for (let i = 0; i < pixels; i += 1) {
    const offset = i * 4;
    const a = data[offset + 3] / 255;
    // 透明像素按白色估算，避免把透明背景误判为内容。
    const r = a === 0 ? 255 : data[offset];
    const g = a === 0 ? 255 : data[offset + 1];
    const b = a === 0 ? 255 : data[offset + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    sum += luma;
    sumSq += luma * luma;
  }
  const mean = sum / pixels;
  const variance = sumSq / pixels - mean * mean;
  const std = Math.sqrt(Math.max(0, variance));
  return { width, height, meanLuma: mean, stdLuma: std };
}

function cropPng(PNG, src, width, height) {
  if (src.width === width && src.height === height) {
    return src;
  }
  const out = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const srcIdx = (y * src.width + x) * 4;
      const dstIdx = (y * width + x) * 4;
      out.data[dstIdx] = src.data[srcIdx];
      out.data[dstIdx + 1] = src.data[srcIdx + 1];
      out.data[dstIdx + 2] = src.data[srcIdx + 2];
      out.data[dstIdx + 3] = src.data[srcIdx + 3];
    }
  }
  return out;
}

async function computePreviewDiff(htmlDir, pptxPngs, warnings) {
  const pm = tryLoadPixelmatch();
  if (!pm) {
    warnings.push({
      type: "pixel-diff-unavailable",
      message: "pixelmatch/pngjs 不可用，跳过 HTML 与 PPTX 预览的像素差异检测。",
    });
    return { available: false, slides: [] };
  }
  const { PNG, pixelmatch } = pm;
  const htmlPngs = await listPngsByOrder(htmlDir);
  const count = Math.min(htmlPngs.length, pptxPngs.length);
  const slides = [];
  for (let i = 0; i < count; i += 1) {
    let entry = { index: i + 1, status: "ok", mismatchPercent: null };
    try {
      const htmlPng = PNG.sync.read(await fs.readFile(htmlPngs[i].path));
      const pptxPng = PNG.sync.read(await fs.readFile(pptxPngs[i]));
      const dw = Math.abs(htmlPng.width - pptxPng.width);
      const dh = Math.abs(htmlPng.height - pptxPng.height);
      // 容忍 ≤2px 的渲染舍入差异（LibreOffice/pt→px 常见），裁到公共尺寸后再比对。
      if (dw > 2 || dh > 2) {
        entry = {
          ...entry,
          status: "size-mismatch",
          message: `HTML ${htmlPng.width}x${htmlPng.height} ≠ PPTX ${pptxPng.width}x${pptxPng.height}，差异过大跳过比对。`,
        };
        slides.push(entry);
        continue;
      }
      const width = Math.min(htmlPng.width, pptxPng.width);
      const height = Math.min(htmlPng.height, pptxPng.height);
      const htmlCropped = cropPng(PNG, htmlPng, width, height);
      const pptxCropped = cropPng(PNG, pptxPng, width, height);
      const diffPng = new PNG({ width, height });
      const diffPixels = pixelmatch(
        htmlCropped.data,
        pptxCropped.data,
        diffPng.data,
        width,
        height,
        { threshold: 0.15, alpha: 0.2, includeAA: false },
      );
      const mismatchPercent = (diffPixels / (width * height)) * 100;
      const pptxStats = computeLumaStats(pptxCropped);
      entry = {
        ...entry,
        mismatchPercent: Number(mismatchPercent.toFixed(2)),
        pptxStdLuma: Number(pptxStats.stdLuma.toFixed(2)),
      };
      if (pptxStats.stdLuma < 5) {
        warnings.push({
          type: "blank-slide-suspected",
          slideIndex: i + 1,
          message: `第 ${i + 1} 页 PPTX 预览近乎纯色（stdLuma=${pptxStats.stdLuma.toFixed(1)}），可能是空白或渲染失败。`,
        });
      } else if (mismatchPercent > 70) {
        warnings.push({
          type: "high-visual-diff",
          slideIndex: i + 1,
          message: `第 ${i + 1} 页 HTML 与 PPTX 预览差异 ${mismatchPercent.toFixed(1)}%，可能存在大范围栅格化或版式漂移。`,
        });
      }
    } catch (error) {
      entry = {
        ...entry,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
    slides.push(entry);
  }
  if (htmlPngs.length !== pptxPngs.length) {
    warnings.push({
      type: "preview-count-mismatch",
      message: `HTML 预览 ${htmlPngs.length} 张，PPTX 预览 ${pptxPngs.length} 张，逐页差异检测只覆盖前 ${count} 页。`,
    });
  }
  return { available: true, slides };
}

async function checkFallbackAssets(measurements, warnings) {
  const raster = measurements?.slides?.flatMap((slide) => slide.raster) ?? [];
  let missing = 0;
  for (const entry of raster) {
    if (entry.assetAbsolute && !(await pathExists(entry.assetAbsolute))) {
      missing += 1;
    }
  }
  if (missing > 0) {
    warnings.push({
      type: "missing-fallback-assets",
      message: `${missing} 个截图回退资源缺失，导出可能出现断图。`,
    });
  }
  return { total: raster.length, missing };
}

async function main() {
  const cfg = parseConfig();
  const warnings = [];
  const measurements = await readMeasurements(cfg.measurements);

  const htmlPreview = await renderHtmlPreviews(cfg, warnings);
  const pptxPreview = await renderPptxPreviews(cfg, warnings);
  const media = await summarizePptxMedia(cfg.pptx, warnings);
  const diff =
    pptxPreview.renderer === "libreoffice"
      ? await computePreviewDiff(cfg.previewHtmlDir, pptxPreview.pngs, warnings)
      : { available: false, reason: pptxPreview.reason, slides: [] };
  const fallback = await checkFallbackAssets(measurements, warnings);

  const htmlSlides = measurements?.totals?.slides ?? htmlPreview.count ?? null;
  if (media && htmlSlides !== null && media.slideCount !== htmlSlides) {
    warnings.push({
      type: "slide-count-mismatch",
      message: `HTML 有 ${htmlSlides} 页，PPTX 解析出 ${media.slideCount} 页。`,
    });
  }
  if (media && media.largest.bytes > 400 * 1024) {
    warnings.push({
      type: "large-embedded-image",
      message: `内嵌最大图片 ${media.largest.name} 约 ${(media.largest.bytes / 1024).toFixed(0)}KB，可能是复杂背景被自动栅格化。`,
    });
  }
  if (media && media.totalBytes > 1.5 * 1024 * 1024) {
    warnings.push({
      type: "large-total-media",
      message: `内嵌媒体总计 ${(media.totalBytes / 1024).toFixed(0)}KB，pptx 体积偏大（多为光栅化背景/截图回退）。`,
    });
  }

  const report = {
    deck: cfg.pptx,
    deckHtml: cfg.deckHtml,
    slides: htmlSlides,
    pptxSlides: media?.slideCount ?? null,
    editableElements: measurements?.totals?.editable ?? null,
    rasterFallbacks: measurements?.totals?.raster ?? fallback.total ?? null,
    ignored: measurements?.totals?.ignored ?? null,
    media: media
      ? {
          count: media.mediaCount,
          totalBytes: media.totalBytes,
          largestBytes: media.largest.bytes,
        }
      : null,
    previewDiff: diff,
    warnings,
    compatibility: {
      powerpoint: "manual-check-pending",
      keynote: "manual-check-pending",
      libreoffice:
        pptxPreview.renderer === "libreoffice"
          ? "rendered"
          : pptxPreview.renderer === "libreoffice-pdf-only"
            ? "pdf-rendered"
            : "not_checked",
    },
    previews: {
      html: htmlPreview,
      pptx: {
        renderer: pptxPreview.renderer,
        reason: pptxPreview.reason,
        count: pptxPreview.count,
      },
    },
  };

  await ensureDir(path.dirname(cfg.qaReport));
  await fs.writeFile(cfg.qaReport, JSON.stringify(report, null, 2), "utf8");

  console.log(
    JSON.stringify({
      ok: true,
      qaReport: cfg.qaReport,
      slides: report.slides,
      pptxSlides: report.pptxSlides,
      editable: report.editableElements,
      raster: report.rasterFallbacks,
      pptxPreviews: pptxPreview.count,
      diffAvailable: diff.available,
      warnings: report.warnings.length,
      libreoffice: report.compatibility.libreoffice,
    }),
  );
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
