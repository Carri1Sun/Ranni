import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import JSZip from "jszip";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { z } from "zod";

import type { ToolDefinition, ToolExecutionContext } from "../../lib/tools";
import {
  getWorkspaceRoot,
  resolveWorkspacePath,
  toWorkspaceRelative,
} from "../../lib/workspace";
import {
  createBlankSlideHtmlTemplate,
  createSpikeSlideHtmlTemplate,
} from "./html-spike-template";

const initSlideHtmlWorkspaceSchema = z.object({
  deckSlug: z.string().min(1),
  dir: z.string().min(1).optional(),
  overwrite: z.boolean().default(false),
  prompt: z.string().min(1).optional(),
  template: z.enum(["blank", "spike-sample"]).default("blank"),
  title: z.string().min(1).default("HTML to PPTX spike"),
});

const prepareSlideHtmlForPptxSchema = z.object({
  fallbackAssetsDir: z.string().min(1).optional(),
  html: z.string().min(1),
  measurementsPath: z.string().min(1).optional(),
  outHtml: z.string().min(1).optional(),
  slideSelector: z.string().min(1).default(".slide"),
});

const exportHtmlToPptxSchema = z.object({
  author: z.string().default("Ranni"),
  html: z.string().min(1),
  outPptx: z.string().min(1),
  slideSelector: z.string().min(1).default(".slide"),
  title: z.string().default("HTML to PPTX spike"),
});

const validateHtmlPptxExportSchema = z.object({
  html: z.string().min(1),
  measurementsPath: z.string().min(1).optional(),
  pptx: z.string().min(1),
  preparedHtml: z.string().min(1).optional(),
  qaReportPath: z.string().min(1).optional(),
  slideSelector: z.string().min(1).default(".slide"),
});

const SLIDE_WIDTH_PX = 1280;
const SLIDE_HEIGHT_PX = 720;
const SLIDE_WIDTH_IN = 13.333;
const SLIDE_HEIGHT_IN = 7.5;
const requireFromSkill = createRequire(__filename);

type HtmlPptxWarning = {
  message: string;
  slideId?: string;
  type: string;
};

type RasterFallbackMeasurement = {
  alt: string;
  asset: string;
  height: number;
  index: number;
  left: number;
  slideId: string;
  top: number;
  width: number;
  zIndex: string;
};

type SlideMeasurement = {
  height: number;
  id: string;
  index: number;
  scrollHeight: number;
  scrollWidth: number;
  width: number;
};

type HtmlPptxMeasurements = {
  editableElements: number;
  ignoredElements: number;
  preparedHtml: string;
  rasterFallbacks: RasterFallbackMeasurement[];
  slideHeight: number;
  slideSelector: string;
  slides: SlideMeasurement[];
  slideWidth: number;
  sourceHtml: string;
  warnings: HtmlPptxWarning[];
};

function sanitizePathSegment(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "deck"
  );
}

function toPortableRelativePath(fromDirectory: string, targetPath: string) {
  const relativePath = path.relative(fromDirectory, targetPath);

  return relativePath.split(path.sep).join("/");
}

function resolveDefaultWorkspaceOutput(
  defaultAbsolutePath: string,
  inputPath: string | undefined,
  workspaceRoot: string,
) {
  if (inputPath) {
    return resolveWorkspacePath(inputPath, workspaceRoot);
  }

  return resolveWorkspacePath(
    toWorkspaceRelative(defaultAbsolutePath, workspaceRoot),
    workspaceRoot,
  );
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeTextFileIfAllowed(
  filePath: string,
  content: string,
  overwrite: boolean,
) {
  if (!overwrite && (await fileExists(filePath))) {
    return false;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");

  return true;
}

async function launchHtmlPptxBrowser() {
  const launchErrors: string[] = [];
  let browser: Browser | undefined;

  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    launchErrors.push(
      error instanceof Error ? error.message : "Playwright Chromium 启动失败。",
    );
  }

  if (!browser) {
    try {
      browser = await chromium.launch({ channel: "chrome", headless: true });
    } catch (error) {
      launchErrors.push(
        error instanceof Error ? error.message : "Chrome channel 启动失败。",
      );
    }
  }

  if (!browser) {
    throw new Error(
      [
        "无法启动 Playwright 浏览器。",
        "请安装 Playwright Chromium，或确保本机可用 Google Chrome。",
        ...launchErrors,
      ].join("\n"),
    );
  }

  const browserContext = await browser.newContext({
    deviceScaleFactor: 2,
    viewport: {
      height: SLIDE_HEIGHT_PX,
      width: SLIDE_WIDTH_PX,
    },
  });

  return { browser, browserContext };
}

async function closeBrowser(
  browser: Browser,
  browserContext: BrowserContext,
) {
  await browserContext.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
}

async function openSlideHtml(
  browserContext: BrowserContext,
  htmlAbsolutePath: string,
) {
  const page = await browserContext.newPage();

  await page.goto(pathToFileURL(htmlAbsolutePath).href, {
    waitUntil: "networkidle",
  });
  await page.evaluate(async () => {
    await document.fonts?.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });

  return page;
}

async function initSlideHtmlWorkspace(
  rawArgs: unknown,
  context: ToolExecutionContext,
) {
  const args = initSlideHtmlWorkspaceSchema.parse(rawArgs);
  const workspaceRoot = getWorkspaceRoot(context.workspaceRoot);
  const deckSlug = sanitizePathSegment(args.deckSlug);
  const baseRelativePath = args.dir ?? deckSlug;
  const baseAbsolutePath = resolveWorkspacePath(baseRelativePath, workspaceRoot);
  const template =
    args.template === "spike-sample"
      ? createSpikeSlideHtmlTemplate(args.title, args.prompt)
      : createBlankSlideHtmlTemplate(args.title, args.prompt);
  const subDirectories = [
    "assets",
    "fallback-assets",
    "preview-html",
    "preview-pptx",
    "final",
  ];

  for (const subDirectory of subDirectories) {
    await fs.mkdir(path.join(baseAbsolutePath, subDirectory), {
      recursive: true,
    });
  }

  const htmlPath = path.join(baseAbsolutePath, "deck.html");
  const preparedHtmlPath = path.join(baseAbsolutePath, "deck.prepared.html");
  const cssPath = path.join(baseAbsolutePath, "styles.css");
  const measurementsPath = path.join(baseAbsolutePath, "measurements.json");
  const qaReportPath = path.join(baseAbsolutePath, "qa-report.json");
  const finalPptxPath = path.join(baseAbsolutePath, "final", `${deckSlug}.pptx`);
  const writtenFiles: string[] = [];
  const skippedFiles: string[] = [];
  const trackWrite = async (filePath: string, content: string) => {
    const didWrite = await writeTextFileIfAllowed(filePath, content, args.overwrite);
    const target = didWrite ? writtenFiles : skippedFiles;

    target.push(toWorkspaceRelative(filePath, workspaceRoot));
  };

  await trackWrite(htmlPath, template.html);
  await trackWrite(cssPath, template.css);

  if (args.prompt) {
    await trackWrite(path.join(baseAbsolutePath, "prompt.txt"), `${args.prompt}\n`);
    await trackWrite(
      path.join(baseAbsolutePath, "html-generation-report.json"),
      `${JSON.stringify(
        {
          deckSlug,
          prompt: args.prompt,
          route: "restricted-slide-html",
          template: args.template,
          title: args.title,
        },
        null,
        2,
      )}\n`,
    );
  }

  for (const [assetName, assetContent] of Object.entries(template.assets)) {
    await trackWrite(path.join(baseAbsolutePath, "assets", assetName), assetContent);
  }

  return [
    "已初始化 slide HTML workspace。",
    `目录：${toWorkspaceRelative(baseAbsolutePath, workspaceRoot)}`,
    `HTML：${toWorkspaceRelative(htmlPath, workspaceRoot)}`,
    `CSS：${toWorkspaceRelative(cssPath, workspaceRoot)}`,
    `Prepared HTML：${toWorkspaceRelative(preparedHtmlPath, workspaceRoot)}`,
    `measurements：${toWorkspaceRelative(measurementsPath, workspaceRoot)}`,
    `QA：${toWorkspaceRelative(qaReportPath, workspaceRoot)}`,
    `最终 PPTX：${toWorkspaceRelative(finalPptxPath, workspaceRoot)}`,
    writtenFiles.length ? `写入：${writtenFiles.join(", ")}` : "写入：无",
    skippedFiles.length
      ? `跳过已有文件：${skippedFiles.join(", ")}`
      : "跳过已有文件：无",
  ].join("\n");
}

async function collectHtmlMeasurements(
  browserContext: BrowserContext,
  htmlAbsolutePath: string,
  slideSelector: string,
) {
  const page = await openSlideHtml(browserContext, htmlAbsolutePath);

  try {
    return await page.evaluate(
      ({ expectedHeight, expectedWidth, selector }) => {
        const warnings: HtmlPptxWarning[] = [];
        const slides = Array.from(
          document.querySelectorAll<HTMLElement>(selector),
        );
        const seenSlideIds = new Set<string>();
        const slideMeasurements = slides.map((slide, index) => {
          const rect = slide.getBoundingClientRect();
          const id = slide.dataset.slideId || `slide-${index + 1}`;
          const width = Math.round(rect.width * 100) / 100;
          const height = Math.round(rect.height * 100) / 100;

          if (!slide.dataset.slideId) {
            warnings.push({
              message: "slide 缺少 data-slide-id，已使用页序作为临时标识。",
              slideId: id,
              type: "missing-slide-id",
            });
          }

          if (seenSlideIds.has(id)) {
            warnings.push({
              message: `slide id ${id} 重复。`,
              slideId: id,
              type: "duplicate-slide-id",
            });
          }

          seenSlideIds.add(id);

          if (
            Math.abs(width - expectedWidth) > 1 ||
            Math.abs(height - expectedHeight) > 1
          ) {
            warnings.push({
              message: `slide 尺寸为 ${width}x${height}，预期为 ${expectedWidth}x${expectedHeight}。`,
              slideId: id,
              type: "slide-size-mismatch",
            });
          }

          if (
            slide.scrollWidth > slide.clientWidth ||
            slide.scrollHeight > slide.clientHeight
          ) {
            warnings.push({
              message: "slide 内部出现滚动尺寸，导出可能裁切。",
              slideId: id,
              type: "slide-overflow",
            });
          }

          return {
            height,
            id,
            index,
            scrollHeight: slide.scrollHeight,
            scrollWidth: slide.scrollWidth,
            width,
          };
        });
        const rasterElements = Array.from(
          document.querySelectorAll<HTMLElement>("[data-pptx-raster]"),
        ).map((element, index) => {
          const slide = element.closest<HTMLElement>(selector);
          const slideRect = slide?.getBoundingClientRect();
          const rect = element.getBoundingClientRect();
          const computedStyle = window.getComputedStyle(element);
          const slideId = slide?.dataset.slideId || `slide-${index + 1}`;
          const alt =
            element.getAttribute("data-pptx-alt") ||
            element.getAttribute("aria-label") ||
            "";

          element.setAttribute("data-pptx-raster-index", String(index));

          if (!slide) {
            warnings.push({
              message: "data-pptx-raster 节点不在 slide 内。",
              type: "raster-outside-slide",
            });
          }

          if (!alt.trim()) {
            warnings.push({
              message: "截图回退节点缺少 data-pptx-alt。",
              slideId,
              type: "missing-raster-alt",
            });
          }

          if (computedStyle.position === "static") {
            warnings.push({
              message: "截图回退节点使用 static 布局，替换为绝对定位图片后可能影响周边流式布局。",
              slideId,
              type: "raster-static-position",
            });
          }

          return {
            alt,
            borderRadius: computedStyle.borderRadius,
            height: rect.height,
            index,
            left: slideRect ? rect.left - slideRect.left : rect.left,
            slideId,
            top: slideRect ? rect.top - slideRect.top : rect.top,
            width: rect.width,
            zIndex: computedStyle.zIndex,
          };
        });

        if (!slides.length) {
          warnings.push({
            message: `未找到 slide selector：${selector}`,
            type: "missing-slides",
          });
        }

        return {
          editableElements:
            document.querySelectorAll("[data-pptx-editable]").length,
          ignoredElements: document.querySelectorAll("[data-pptx-ignore]").length,
          rasterElements,
          slideMeasurements,
          warnings,
        };
      },
      {
        expectedHeight: SLIDE_HEIGHT_PX,
        expectedWidth: SLIDE_WIDTH_PX,
        selector: slideSelector,
      },
    );
  } finally {
    await page.close();
  }
}

async function prepareSlideHtmlForPptx(
  rawArgs: unknown,
  context: ToolExecutionContext,
) {
  const args = prepareSlideHtmlForPptxSchema.parse(rawArgs);
  const workspaceRoot = getWorkspaceRoot(context.workspaceRoot);
  const htmlAbsolutePath = resolveWorkspacePath(args.html, workspaceRoot);
  const htmlDirectory = path.dirname(htmlAbsolutePath);
  const outHtmlAbsolutePath = resolveDefaultWorkspaceOutput(
    path.join(htmlDirectory, "deck.prepared.html"),
    args.outHtml,
    workspaceRoot,
  );
  const fallbackAssetsDirectory = resolveDefaultWorkspaceOutput(
    path.join(htmlDirectory, "fallback-assets"),
    args.fallbackAssetsDir,
    workspaceRoot,
  );
  const measurementsAbsolutePath = resolveDefaultWorkspaceOutput(
    path.join(htmlDirectory, "measurements.json"),
    args.measurementsPath,
    workspaceRoot,
  );
  const { browser, browserContext } = await launchHtmlPptxBrowser();

  try {
    const page = await openSlideHtml(browserContext, htmlAbsolutePath);
    const state = await page.evaluate(
      ({ expectedHeight, expectedWidth, selector }) => {
        const warnings: HtmlPptxWarning[] = [];
        const slides = Array.from(
          document.querySelectorAll<HTMLElement>(selector),
        );
        const seenSlideIds = new Set<string>();
        const slideMeasurements = slides.map((slide, index) => {
          const rect = slide.getBoundingClientRect();
          const id = slide.dataset.slideId || `slide-${index + 1}`;
          const width = Math.round(rect.width * 100) / 100;
          const height = Math.round(rect.height * 100) / 100;

          if (!slide.dataset.slideId) {
            warnings.push({
              message: "slide 缺少 data-slide-id，已使用页序作为临时标识。",
              slideId: id,
              type: "missing-slide-id",
            });
          }

          if (seenSlideIds.has(id)) {
            warnings.push({
              message: `slide id ${id} 重复。`,
              slideId: id,
              type: "duplicate-slide-id",
            });
          }

          seenSlideIds.add(id);

          if (
            Math.abs(width - expectedWidth) > 1 ||
            Math.abs(height - expectedHeight) > 1
          ) {
            warnings.push({
              message: `slide 尺寸为 ${width}x${height}，预期为 ${expectedWidth}x${expectedHeight}。`,
              slideId: id,
              type: "slide-size-mismatch",
            });
          }

          if (
            slide.scrollWidth > slide.clientWidth ||
            slide.scrollHeight > slide.clientHeight
          ) {
            warnings.push({
              message: "slide 内部出现滚动尺寸，导出可能裁切。",
              slideId: id,
              type: "slide-overflow",
            });
          }

          return {
            height,
            id,
            index,
            scrollHeight: slide.scrollHeight,
            scrollWidth: slide.scrollWidth,
            width,
          };
        });
        const rasterElements = Array.from(
          document.querySelectorAll<HTMLElement>("[data-pptx-raster]"),
        ).map((element, index) => {
          const slide = element.closest<HTMLElement>(selector);
          const slideRect = slide?.getBoundingClientRect();
          const rect = element.getBoundingClientRect();
          const computedStyle = window.getComputedStyle(element);
          const slideId = slide?.dataset.slideId || `slide-${index + 1}`;
          const alt =
            element.getAttribute("data-pptx-alt") ||
            element.getAttribute("aria-label") ||
            "";

          element.setAttribute("data-pptx-raster-index", String(index));

          if (!slide) {
            warnings.push({
              message: "data-pptx-raster 节点不在 slide 内。",
              type: "raster-outside-slide",
            });
          }

          if (!alt.trim()) {
            warnings.push({
              message: "截图回退节点缺少 data-pptx-alt。",
              slideId,
              type: "missing-raster-alt",
            });
          }

          if (computedStyle.position === "static") {
            warnings.push({
              message: "截图回退节点使用 static 布局，替换为绝对定位图片后可能影响周边流式布局。",
              slideId,
              type: "raster-static-position",
            });
          }

          return {
            alt,
            borderRadius: computedStyle.borderRadius,
            height: rect.height,
            index,
            left: slideRect ? rect.left - slideRect.left : rect.left,
            slideId,
            top: slideRect ? rect.top - slideRect.top : rect.top,
            width: rect.width,
            zIndex: computedStyle.zIndex,
          };
        });

        const ignoredElements =
          document.querySelectorAll("[data-pptx-ignore]").length;

        document.querySelectorAll("[data-pptx-ignore]").forEach((element) => {
          element.remove();
        });

        if (!slides.length) {
          warnings.push({
            message: `未找到 slide selector：${selector}`,
            type: "missing-slides",
          });
        }

        return {
          editableElements:
            document.querySelectorAll("[data-pptx-editable]").length,
          ignoredElements,
          rasterElements,
          slideMeasurements,
          warnings,
        };
      },
      {
        expectedHeight: SLIDE_HEIGHT_PX,
        expectedWidth: SLIDE_WIDTH_PX,
        selector: args.slideSelector,
      },
    );
    const warnings = [...state.warnings];
    const replacements: Array<{
      alt: string;
      asset: string;
      borderRadius: string;
      height: number;
      index: number;
      left: number;
      slideId: string;
      src: string;
      top: number;
      width: number;
      zIndex: string;
    }> = [];

    await fs.mkdir(fallbackAssetsDirectory, { recursive: true });

    for (const rasterElement of state.rasterElements) {
      const width = Math.round(rasterElement.width);
      const height = Math.round(rasterElement.height);

      if (width <= 0 || height <= 0) {
        warnings.push({
          message: "截图回退节点尺寸为空，已跳过。",
          slideId: rasterElement.slideId,
          type: "empty-raster-node",
        });
        continue;
      }

      const assetName = `${sanitizePathSegment(rasterElement.slideId)}-${String(
        rasterElement.index + 1,
      ).padStart(2, "0")}.png`;
      const assetAbsolutePath = path.join(fallbackAssetsDirectory, assetName);
      const locator = page.locator(
        `[data-pptx-raster-index="${rasterElement.index}"]`,
      );

      await locator.screenshot({
        omitBackground: true,
        path: assetAbsolutePath,
      });

      replacements.push({
        alt: rasterElement.alt,
        asset: toWorkspaceRelative(assetAbsolutePath, workspaceRoot),
        borderRadius: rasterElement.borderRadius,
        height: rasterElement.height,
        index: rasterElement.index,
        left: rasterElement.left,
        slideId: rasterElement.slideId,
        src: toPortableRelativePath(path.dirname(outHtmlAbsolutePath), assetAbsolutePath),
        top: rasterElement.top,
        width: rasterElement.width,
        zIndex: rasterElement.zIndex,
      });
    }

    await page.evaluate(
      ({ replacements: browserReplacements, selector }) => {
        for (const replacement of browserReplacements) {
          const original = document.querySelector<HTMLElement>(
            `[data-pptx-raster-index="${replacement.index}"]`,
          );
          const slide = original?.closest<HTMLElement>(selector);

          if (!original || !slide) {
            continue;
          }

          const image = document.createElement("img");

          image.src = replacement.src;
          image.alt = replacement.alt;
          image.setAttribute("data-pptx-alt", replacement.alt);
          image.setAttribute("data-pptx-fallback", "true");
          image.style.position = "absolute";
          image.style.left = `${replacement.left}px`;
          image.style.top = `${replacement.top}px`;
          image.style.width = `${replacement.width}px`;
          image.style.height = `${replacement.height}px`;
          image.style.objectFit = "contain";
          image.style.display = "block";
          image.style.margin = "0";
          image.style.zIndex =
            replacement.zIndex === "auto" ? "0" : replacement.zIndex;
          image.style.borderRadius = replacement.borderRadius;
          slide.appendChild(image);
          original.remove();
        }
      },
      {
        replacements,
        selector: args.slideSelector,
      },
    );

    const preparedHtml = await page.content();
    const measurements: HtmlPptxMeasurements = {
      editableElements: state.editableElements,
      ignoredElements: state.ignoredElements,
      preparedHtml: toWorkspaceRelative(outHtmlAbsolutePath, workspaceRoot),
      rasterFallbacks: replacements.map((replacement) => ({
        alt: replacement.alt,
        asset: replacement.asset,
        height: Math.round(replacement.height * 100) / 100,
        index: replacement.index,
        left: Math.round(replacement.left * 100) / 100,
        slideId: replacement.slideId,
        top: Math.round(replacement.top * 100) / 100,
        width: Math.round(replacement.width * 100) / 100,
        zIndex: replacement.zIndex,
      })),
      slideHeight: SLIDE_HEIGHT_PX,
      slideSelector: args.slideSelector,
      slides: state.slideMeasurements,
      slideWidth: SLIDE_WIDTH_PX,
      sourceHtml: toWorkspaceRelative(htmlAbsolutePath, workspaceRoot),
      warnings,
    };

    await fs.mkdir(path.dirname(outHtmlAbsolutePath), { recursive: true });
    await fs.writeFile(outHtmlAbsolutePath, preparedHtml, "utf8");
    await fs.writeFile(
      measurementsAbsolutePath,
      `${JSON.stringify(measurements, null, 2)}\n`,
      "utf8",
    );
    await page.close();

    return [
      "已准备 HTML-to-PPTX 输入。",
      `Prepared HTML：${toWorkspaceRelative(outHtmlAbsolutePath, workspaceRoot)}`,
      `measurements：${toWorkspaceRelative(measurementsAbsolutePath, workspaceRoot)}`,
      `截图回退：${replacements.length}`,
      `warning：${warnings.length}`,
    ].join("\n");
  } finally {
    await closeBrowser(browser, browserContext);
  }
}

function resolveDomToPptxBundlePath() {
  const mainPath = requireFromSkill.resolve("dom-to-pptx");

  return path.join(path.dirname(mainPath), "dom-to-pptx.bundle.js");
}

async function exportHtmlToPptx(
  rawArgs: unknown,
  context: ToolExecutionContext,
) {
  const args = exportHtmlToPptxSchema.parse(rawArgs);
  const workspaceRoot = getWorkspaceRoot(context.workspaceRoot);
  const htmlAbsolutePath = resolveWorkspacePath(args.html, workspaceRoot);
  const outPptxAbsolutePath = resolveWorkspacePath(args.outPptx, workspaceRoot);
  const { browser, browserContext } = await launchHtmlPptxBrowser();

  try {
    const page = await openSlideHtml(browserContext, htmlAbsolutePath);
    const bundlePath = resolveDomToPptxBundlePath();

    await page.addScriptTag({ path: bundlePath });

    const bytes = await page.evaluate(
      async ({ author, height, selector, title, width }) => {
        type DomToPptxApi = {
          exportToPptx: (
            elementOrSelector: Element[] | string,
            options: {
              author: string;
              autoEmbedFonts: boolean;
              fileName: string;
              height: number;
              layout: string;
              skipDownload: boolean;
              svgAsVector: boolean;
              title: string;
              width: number;
            },
          ) => Promise<Blob>;
        };
        const api = (window as unknown as { domToPptx?: DomToPptxApi })
          .domToPptx;

        if (!api?.exportToPptx) {
          throw new Error("dom-to-pptx browser bundle 未暴露 exportToPptx。");
        }

        const slideElements = Array.from(document.querySelectorAll(selector));

        if (!slideElements.length) {
          throw new Error(`未找到 slide selector：${selector}`);
        }

        const blob = await api.exportToPptx(slideElements, {
          author,
          autoEmbedFonts: false,
          fileName: "deck.pptx",
          height,
          layout: "LAYOUT_WIDE",
          skipDownload: true,
          svgAsVector: true,
          title,
          width,
        });
        const arrayBuffer = await blob.arrayBuffer();

        return Array.from(new Uint8Array(arrayBuffer));
      },
      {
        author: args.author,
        height: SLIDE_HEIGHT_IN,
        selector: args.slideSelector,
        title: args.title,
        width: SLIDE_WIDTH_IN,
      },
    );

    await fs.mkdir(path.dirname(outPptxAbsolutePath), { recursive: true });
    await fs.writeFile(outPptxAbsolutePath, Buffer.from(bytes));
    await page.close();

    return [
      "已通过 dom-to-pptx 导出 PPTX。",
      `路径：${toWorkspaceRelative(outPptxAbsolutePath, workspaceRoot)}`,
      `HTML：${toWorkspaceRelative(htmlAbsolutePath, workspaceRoot)}`,
    ].join("\n");
  } finally {
    await closeBrowser(browser, browserContext);
  }
}

async function renderHtmlPreviews(
  htmlAbsolutePath: string,
  previewDirectory: string,
  slideSelector: string,
  workspaceRoot: string,
) {
  await fs.rm(previewDirectory, { force: true, recursive: true });

  const { browser, browserContext } = await launchHtmlPptxBrowser();

  try {
    const page = await openSlideHtml(browserContext, htmlAbsolutePath);
    const slideIds = await page.evaluate((selector) => {
      return Array.from(document.querySelectorAll<HTMLElement>(selector)).map(
        (slide, index) => slide.dataset.slideId || `slide-${index + 1}`,
      );
    }, slideSelector);
    const previewPaths: string[] = [];

    await fs.mkdir(previewDirectory, { recursive: true });

    for (let index = 0; index < slideIds.length; index += 1) {
      const slideId = sanitizePathSegment(slideIds[index] ?? `slide-${index + 1}`);
      const previewPath = path.join(
        previewDirectory,
        `slide-${String(index + 1).padStart(2, "0")}-${slideId}.png`,
      );

      await page.locator(slideSelector).nth(index).screenshot({
        omitBackground: true,
        path: previewPath,
      });
      previewPaths.push(toWorkspaceRelative(previewPath, workspaceRoot));
    }

    await page.close();

    return previewPaths;
  } finally {
    await closeBrowser(browser, browserContext);
  }
}

async function inspectPptxFile(pptxAbsolutePath: string) {
  const zip = await JSZip.loadAsync(await fs.readFile(pptxAbsolutePath));
  const slideFiles = Object.keys(zip.files)
    .filter((fileName) => /^ppt\/slides\/slide\d+\.xml$/.test(fileName))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  let textRuns = 0;
  let pictureCount = 0;

  for (const slideFile of slideFiles) {
    const xml = await zip.file(slideFile)?.async("string");

    if (!xml) {
      continue;
    }

    textRuns += xml.match(/<a:t>/g)?.length ?? 0;
    pictureCount += xml.match(/<p:pic>/g)?.length ?? 0;
  }

  return {
    pictureCount,
    slideFiles: slideFiles.length,
    textRuns,
  };
}

function runProcess(
  command: string,
  args: string[],
  cwd: string,
  signal: AbortSignal | undefined,
  timeoutMs = 120000,
) {
  return new Promise<{ code: number; stderr: string; stdout: string }>(
    (resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`命令超时：${command}`));
      }, timeoutMs);
      const abortHandler = () => {
        child.kill("SIGTERM");
        reject(new Error(`命令已取消：${command}`));
      };

      if (signal?.aborted) {
        abortHandler();
        return;
      }

      signal?.addEventListener("abort", abortHandler, { once: true });

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abortHandler);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abortHandler);
        resolve({
          code: code ?? 1,
          stderr,
          stdout,
        });
      });
    },
  );
}

async function commandExists(command: string) {
  if (path.isAbsolute(command)) {
    return fileExists(command);
  }

  try {
    const result = await runProcess("which", [command], process.cwd(), undefined, 8000);

    return result.code === 0;
  } catch {
    return false;
  }
}

async function firstAvailableCommand(commands: Array<string | undefined>) {
  for (const command of commands) {
    if (command && (await commandExists(command))) {
      return command;
    }
  }

  return undefined;
}

async function renderQuickLookPptxThumbnail(
  pptxAbsolutePath: string,
  previewDirectory: string,
  workspaceRoot: string,
  signal: AbortSignal | undefined,
  warnings: HtmlPptxWarning[],
  fallbackStatus: string,
) {
  const qlmanage = await firstAvailableCommand(["qlmanage"]);

  if (!qlmanage) {
    warnings.push({
      message: "未找到 qlmanage，PPTX 缩略图回退未执行。",
      type: "pptx-preview-quicklook-unavailable",
    });

    return {
      files: [],
      status: fallbackStatus,
      warnings,
    };
  }

  const result = await runProcess(
    qlmanage,
    ["-t", "-s", "1280", "-o", previewDirectory, pptxAbsolutePath],
    workspaceRoot,
    signal,
    60000,
  );

  if (result.code !== 0) {
    warnings.push({
      message: `Quick Look 缩略图生成失败：${result.stderr || result.stdout}`,
      type: "pptx-preview-quicklook-failed",
    });

    return {
      files: [],
      status: fallbackStatus,
      warnings,
    };
  }

  const thumbnailPath = path.join(
    previewDirectory,
    `${path.basename(pptxAbsolutePath)}.png`,
  );

  if (!(await fileExists(thumbnailPath))) {
    warnings.push({
      message: "Quick Look 未产出 PPTX 缩略图。",
      type: "pptx-preview-quicklook-missing",
    });

    return {
      files: [],
      status: fallbackStatus,
      warnings,
    };
  }

  return {
    files: [toWorkspaceRelative(thumbnailPath, workspaceRoot)],
    status: "quicklook-thumbnail",
    warnings,
  };
}

async function renderPptxPreview(
  pptxAbsolutePath: string,
  previewDirectory: string,
  workspaceRoot: string,
  signal: AbortSignal | undefined,
) {
  const warnings: HtmlPptxWarning[] = [];
  const files: string[] = [];

  await fs.rm(previewDirectory, { force: true, recursive: true });
  await fs.mkdir(previewDirectory, { recursive: true });

  const soffice = await firstAvailableCommand([
    process.env.LIBREOFFICE_PATH,
    "soffice",
    "libreoffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  ]);

  if (!soffice) {
    warnings.push({
      message: "未找到 LibreOffice，PPTX 预览未渲染。",
      type: "pptx-preview-not-checked",
    });

    return renderQuickLookPptxThumbnail(
      pptxAbsolutePath,
      previewDirectory,
      workspaceRoot,
      signal,
      warnings,
      "not_checked",
    );
  }

  const convertResult = await runProcess(
    soffice,
    [
      "--headless",
      "--convert-to",
      "pdf",
      "--outdir",
      previewDirectory,
      pptxAbsolutePath,
    ],
    workspaceRoot,
    signal,
  );

  if (convertResult.code !== 0) {
    warnings.push({
      message: `LibreOffice 转 PDF 失败：${convertResult.stderr || convertResult.stdout}`,
      type: "pptx-preview-failed",
    });

    return renderQuickLookPptxThumbnail(
      pptxAbsolutePath,
      previewDirectory,
      workspaceRoot,
      signal,
      warnings,
      "failed",
    );
  }

  const pdfPath = path.join(
    previewDirectory,
    `${path.basename(pptxAbsolutePath, path.extname(pptxAbsolutePath))}.pdf`,
  );

  if (!(await fileExists(pdfPath))) {
    warnings.push({
      message: "LibreOffice 未产出 PDF 预览。",
      type: "pptx-preview-missing-pdf",
    });

    return renderQuickLookPptxThumbnail(
      pptxAbsolutePath,
      previewDirectory,
      workspaceRoot,
      signal,
      warnings,
      "failed",
    );
  }

  files.push(toWorkspaceRelative(pdfPath, workspaceRoot));

  const pdftoppm = await firstAvailableCommand(["pdftoppm"]);

  if (!pdftoppm) {
    warnings.push({
      message: "未找到 pdftoppm，PPTX 预览仅保留 PDF。",
      type: "pptx-preview-pdf-only",
    });

    return {
      files,
      status: "pdf-only",
      warnings,
    };
  }

  const outputPrefix = path.join(previewDirectory, "slide");
  const renderResult = await runProcess(
    pdftoppm,
    ["-png", "-r", "144", pdfPath, outputPrefix],
    workspaceRoot,
    signal,
  );

  if (renderResult.code !== 0) {
    warnings.push({
      message: `pdftoppm 渲染失败：${renderResult.stderr || renderResult.stdout}`,
      type: "pptx-preview-render-failed",
    });

    return {
      files,
      status: "pdf-only",
      warnings,
    };
  }

  const renderedFiles = (await fs.readdir(previewDirectory))
    .filter((fileName) => /^slide-\d+\.png$/.test(fileName))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .map((fileName) =>
      toWorkspaceRelative(path.join(previewDirectory, fileName), workspaceRoot),
    );

  files.push(...renderedFiles);

  return {
    files,
    status: renderedFiles.length ? "rendered" : "pdf-only",
    warnings,
  };
}

async function readMeasurements(
  measurementsAbsolutePath: string | undefined,
) {
  if (!measurementsAbsolutePath || !(await fileExists(measurementsAbsolutePath))) {
    return undefined;
  }

  return JSON.parse(
    await fs.readFile(measurementsAbsolutePath, "utf8"),
  ) as HtmlPptxMeasurements;
}

async function validateHtmlPptxExport(
  rawArgs: unknown,
  context: ToolExecutionContext,
) {
  const args = validateHtmlPptxExportSchema.parse(rawArgs);
  const workspaceRoot = getWorkspaceRoot(context.workspaceRoot);
  const htmlAbsolutePath = resolveWorkspacePath(args.html, workspaceRoot);
  const htmlDirectory = path.dirname(htmlAbsolutePath);
  const preparedHtmlAbsolutePath = args.preparedHtml
    ? resolveWorkspacePath(args.preparedHtml, workspaceRoot)
    : path.join(htmlDirectory, "deck.prepared.html");
  const pptxAbsolutePath = resolveWorkspacePath(args.pptx, workspaceRoot);
  const measurementsAbsolutePath = args.measurementsPath
    ? resolveWorkspacePath(args.measurementsPath, workspaceRoot)
    : path.join(htmlDirectory, "measurements.json");
  const qaReportAbsolutePath = resolveDefaultWorkspaceOutput(
    path.join(htmlDirectory, "qa-report.json"),
    args.qaReportPath,
    workspaceRoot,
  );
  const previewHtmlDirectory = path.join(htmlDirectory, "preview-html");
  const previewPptxDirectory = path.join(htmlDirectory, "preview-pptx");
  const { browser, browserContext } = await launchHtmlPptxBrowser();
  let measurements = await readMeasurements(measurementsAbsolutePath);

  try {
    if (!measurements) {
      const measured = await collectHtmlMeasurements(
        browserContext,
        htmlAbsolutePath,
        args.slideSelector,
      );

      measurements = {
        editableElements: measured.editableElements,
        ignoredElements: measured.ignoredElements,
        preparedHtml: toWorkspaceRelative(preparedHtmlAbsolutePath, workspaceRoot),
        rasterFallbacks: [],
        slideHeight: SLIDE_HEIGHT_PX,
        slideSelector: args.slideSelector,
        slides: measured.slideMeasurements,
        slideWidth: SLIDE_WIDTH_PX,
        sourceHtml: toWorkspaceRelative(htmlAbsolutePath, workspaceRoot),
        warnings: measured.warnings,
      };
    }
  } finally {
    await closeBrowser(browser, browserContext);
  }

  const [htmlPreviews, pptxInspection, pptxPreview] = await Promise.all([
    renderHtmlPreviews(
      htmlAbsolutePath,
      previewHtmlDirectory,
      args.slideSelector,
      workspaceRoot,
    ),
    inspectPptxFile(pptxAbsolutePath),
    renderPptxPreview(
      pptxAbsolutePath,
      previewPptxDirectory,
      workspaceRoot,
      context.signal,
    ),
  ]);
  const pptxPreviewStatusPath = path.join(
    previewPptxDirectory,
    "render-status.json",
  );
  const pptxPreviewStatusRelativePath = toWorkspaceRelative(
    pptxPreviewStatusPath,
    workspaceRoot,
  );

  await fs.mkdir(previewPptxDirectory, { recursive: true });
  pptxPreview.files.push(pptxPreviewStatusRelativePath);
  await fs.writeFile(
    pptxPreviewStatusPath,
    `${JSON.stringify(pptxPreview, null, 2)}\n`,
    "utf8",
  );

  const warnings = [
    ...(measurements?.warnings ?? []),
    ...pptxPreview.warnings,
  ];

  if (pptxInspection.slideFiles !== measurements.slides.length) {
    warnings.push({
      message: `PPTX slide 文件数 ${pptxInspection.slideFiles} 与 HTML slide 数 ${measurements.slides.length} 不一致。`,
      type: "pptx-slide-count-mismatch",
    });
  }

  if (pptxInspection.textRuns === 0 && measurements.editableElements > 0) {
    warnings.push({
      message: "PPTX 中未检测到文本 run，可编辑文本可能未保留。",
      type: "pptx-no-text-runs",
    });
  }

  const report = {
    deck: toWorkspaceRelative(pptxAbsolutePath, workspaceRoot),
    editableElements: measurements.editableElements,
    generatedPptxPath: toWorkspaceRelative(pptxAbsolutePath, workspaceRoot),
    htmlPreviewPaths: htmlPreviews,
    ignoredElements: measurements.ignoredElements,
    measurementsPath: toWorkspaceRelative(measurementsAbsolutePath, workspaceRoot),
    preparedHtml: toWorkspaceRelative(preparedHtmlAbsolutePath, workspaceRoot),
    pptxInspection,
    pptxPreview,
    rasterFallbacks: measurements.rasterFallbacks.length,
    schema: "ranni.html-to-pptx.qa.v1",
    slideHeight: SLIDE_HEIGHT_PX,
    slideSelector: args.slideSelector,
    slides: measurements.slides.length,
    slideWidth: SLIDE_WIDTH_PX,
    sourceHtml: toWorkspaceRelative(htmlAbsolutePath, workspaceRoot),
    warnings,
  };

  await fs.mkdir(path.dirname(qaReportAbsolutePath), { recursive: true });
  await fs.writeFile(
    qaReportAbsolutePath,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );

  return [
    "已验证 HTML-to-PPTX spike 产物。",
    `QA：${toWorkspaceRelative(qaReportAbsolutePath, workspaceRoot)}`,
    `slide 数：${report.slides}`,
    `可编辑元素：${report.editableElements}`,
    `截图回退：${report.rasterFallbacks}`,
    `warning：${warnings.length}`,
  ].join("\n");
}

export const tools: ToolDefinition[] = [
  {
    schema: initSlideHtmlWorkspaceSchema,
    tool: {
      name: "init_slide_html_workspace",
      description:
        "Initialize a restricted slide HTML workspace for the HTML-to-PPTX spike route. Creates deck.html, styles.css, assets/, fallback-assets/, preview-html/, preview-pptx/, measurements.json target, qa-report.json target, and final/.",
      input_schema: {
        type: "object",
        properties: {
          deckSlug: {
            type: "string",
            description: "Deck slug used for the directory and final PPTX name.",
          },
          dir: {
            type: "string",
            description:
              "Optional workspace-relative directory. Defaults to deckSlug.",
          },
          overwrite: {
            type: "boolean",
            default: false,
            description: "Overwrite existing deck.html, styles.css, and assets.",
          },
          prompt: {
            type: "string",
            description:
              "Original user prompt to preserve and use when creating the HTML draft.",
          },
          template: {
            type: "string",
            enum: ["blank", "spike-sample"],
            default: "blank",
            description: "Use spike-sample to create the 8-slide validation deck.",
          },
          title: {
            type: "string",
            default: "HTML to PPTX spike",
          },
        },
        required: ["deckSlug"],
      },
    },
    execute: initSlideHtmlWorkspace,
  },
  {
    schema: prepareSlideHtmlForPptxSchema,
    tool: {
      name: "prepare_slide_html_for_pptx",
      description:
        "Use Playwright to validate restricted slide HTML, screenshot data-pptx-raster nodes into fallback-assets/, replace them with same-size img elements, and write deck.prepared.html plus measurements.json before dom-to-pptx conversion.",
      input_schema: {
        type: "object",
        properties: {
          fallbackAssetsDir: {
            type: "string",
            description:
              "Workspace-relative fallback asset directory. Defaults to sibling fallback-assets/.",
          },
          html: {
            type: "string",
            description: "Workspace-relative source deck.html path.",
          },
          measurementsPath: {
            type: "string",
            description:
              "Workspace-relative measurements.json path. Defaults to sibling measurements.json.",
          },
          outHtml: {
            type: "string",
            description:
              "Workspace-relative prepared HTML path. Defaults to sibling deck.prepared.html.",
          },
          slideSelector: {
            type: "string",
            default: ".slide",
          },
        },
        required: ["html"],
      },
    },
    execute: prepareSlideHtmlForPptx,
  },
  {
    schema: exportHtmlToPptxSchema,
    tool: {
      name: "export_html_to_pptx",
      description:
        "Use dom-to-pptx inside a Playwright-rendered page to export prepared restricted slide HTML into a limited editable .pptx.",
      input_schema: {
        type: "object",
        properties: {
          author: {
            type: "string",
            default: "Ranni",
          },
          html: {
            type: "string",
            description: "Workspace-relative prepared HTML path.",
          },
          outPptx: {
            type: "string",
            description: "Workspace-relative final .pptx path.",
          },
          slideSelector: {
            type: "string",
            default: ".slide",
          },
          title: {
            type: "string",
            default: "HTML to PPTX spike",
          },
        },
        required: ["html", "outPptx"],
      },
    },
    execute: exportHtmlToPptx,
  },
  {
    schema: validateHtmlPptxExportSchema,
    tool: {
      name: "validate_html_pptx_export",
      description:
        "Render HTML previews with Playwright, attempt PPTX previews via LibreOffice and Poppler, inspect PPTX structure, and write qa-report.json for the HTML-to-PPTX spike route.",
      input_schema: {
        type: "object",
        properties: {
          html: {
            type: "string",
            description: "Workspace-relative source deck.html path.",
          },
          measurementsPath: {
            type: "string",
            description:
              "Workspace-relative measurements.json path. Defaults to sibling measurements.json.",
          },
          pptx: {
            type: "string",
            description: "Workspace-relative generated .pptx path.",
          },
          preparedHtml: {
            type: "string",
            description:
              "Workspace-relative prepared HTML path. Defaults to sibling deck.prepared.html.",
          },
          qaReportPath: {
            type: "string",
            description:
              "Workspace-relative qa-report.json path. Defaults to sibling qa-report.json.",
          },
          slideSelector: {
            type: "string",
            default: ".slide",
          },
        },
        required: ["html", "pptx"],
      },
    },
    execute: validateHtmlPptxExport,
  },
];
