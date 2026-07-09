import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { JSDOM } from "jsdom";
import JSZip from "jszip";
import pixelmatch from "pixelmatch";
import { chromium } from "playwright";
import { PNG } from "pngjs";

export const SLIDE_WIDTH_PX = 1280;
export const SLIDE_HEIGHT_PX = 720;
export const SLIDE_WIDTH_IN = 13.333;
export const SLIDE_HEIGHT_IN = 7.5;

const requireFromScript = createRequire(import.meta.url);

export async function readJsonFromStdin() {
  const chunks = [];

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }

  const input = Buffer.concat(chunks).toString("utf8").trim();

  if (!input) {
    throw new Error("脚本缺少 JSON 输入。");
  }

  return JSON.parse(input);
}

export function writeJsonResult(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

export function sanitizePathSegment(value) {
  return (
    String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "deck"
  );
}

export function toWorkspaceRelative(filePath, workspaceRoot) {
  return path.relative(workspaceRoot, filePath).split(path.sep).join("/");
}

export function toPortableRelativePath(fromDirectory, targetPath) {
  return path.relative(fromDirectory, targetPath).split(path.sep).join("/");
}

export async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function isInsideWorkspace(filePath, workspaceRoot) {
  const relativePath = path.relative(workspaceRoot, filePath);

  return Boolean(relativePath) && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function isRemoteReference(value) {
  return /^[a-z][a-z\d+.-]*:/i.test(value) && !value.startsWith("file:");
}

function isRemoteOrDataImageSource(value) {
  return /^(?:https?:|data:)/i.test(value);
}

function getImageMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".svg") {
    return "image/svg+xml";
  }

  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }

  if (extension === ".webp") {
    return "image/webp";
  }

  if (extension === ".gif") {
    return "image/gif";
  }

  return "image/png";
}

async function imageFileToDataUri(filePath) {
  const content = await fs.readFile(filePath);

  return `data:${getImageMimeType(filePath)};base64,${content.toString("base64")}`;
}

function resolveLocalImageSource(source, htmlAbsolutePath, workspaceRoot) {
  if (!source || isRemoteOrDataImageSource(source)) {
    return undefined;
  }

  try {
    const fileUrl = new URL(source, pathToFileURL(htmlAbsolutePath).href);

    if (fileUrl.protocol !== "file:") {
      return undefined;
    }

    const filePath = fileURLToPath(fileUrl);

    if (!isInsideWorkspace(filePath, workspaceRoot)) {
      return undefined;
    }

    return filePath;
  } catch {
    return undefined;
  }
}

export async function launchHtmlPptxBrowser() {
  const launchErrors = [];
  let browser;

  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    launchErrors.push(error instanceof Error ? error.message : "Playwright Chromium 启动失败。");
  }

  if (!browser) {
    try {
      browser = await chromium.launch({ channel: "chrome", headless: true });
    } catch (error) {
      launchErrors.push(error instanceof Error ? error.message : "Chrome channel 启动失败。");
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

export async function closeBrowser(browser, browserContext) {
  await browserContext.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
}

export async function openSlideHtml(browserContext, htmlAbsolutePath) {
  const page = await browserContext.newPage();

  await page.goto(pathToFileURL(htmlAbsolutePath).href, {
    waitUntil: "networkidle",
  });
  await page.evaluate(async () => {
    await document.fonts?.ready;
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  });

  return page;
}

async function inlineLocalImagesForDomToPptx(browserContext, htmlAbsolutePath, workspaceRoot) {
  const page = await openSlideHtml(browserContext, htmlAbsolutePath);

  try {
    const images = await page.evaluate(() =>
      Array.from(document.images).map((image, index) => ({
        index,
        source: image.getAttribute("src") || image.currentSrc || image.src || "",
      })),
    );
    let inlined = 0;

    for (const image of images) {
      const imagePath = resolveLocalImageSource(image.source, htmlAbsolutePath, workspaceRoot);

      if (!imagePath || !(await fileExists(imagePath))) {
        continue;
      }

      const dataUri = await imageFileToDataUri(imagePath);

      await page.evaluate(
        ({ dataUri: nextSource, index }) => {
          const image = document.images[index];

          if (!image) {
            return;
          }

          image.setAttribute("data-pptx-inline-source", image.getAttribute("src") || "");
          image.src = nextSource;
        },
        { dataUri, index: image.index },
      );
      inlined += 1;
    }

    await page.evaluate(async () => {
      await Promise.all(
        Array.from(document.images).map((image) =>
          image.complete
            ? Promise.resolve()
            : new Promise((resolve) => {
                image.addEventListener("load", () => resolve(), { once: true });
                image.addEventListener("error", () => resolve(), { once: true });
              }),
        ),
      );
    });

    return { inlined, page };
  } catch (error) {
    await page.close();
    throw error;
  }
}

async function readSlideHtmlDesignSources(htmlAbsolutePath, workspaceRoot) {
  const html = await fs.readFile(htmlAbsolutePath, "utf8");
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const cssTexts = Array.from(document.querySelectorAll("style"))
    .map((style) => style.textContent ?? "")
    .filter(Boolean);
  const stylesheetHrefs = Array.from(document.querySelectorAll('link[rel~="stylesheet"][href]')).map(
    (link) => link.getAttribute("href") ?? "",
  );

  for (const href of stylesheetHrefs) {
    if (!href || isRemoteReference(href) || href.startsWith("#")) {
      continue;
    }

    try {
      const cssUrl = new URL(href, pathToFileURL(htmlAbsolutePath).href);

      if (cssUrl.protocol !== "file:") {
        continue;
      }

      const cssPath = fileURLToPath(cssUrl);

      if (isInsideWorkspace(cssPath, workspaceRoot) && (await fileExists(cssPath))) {
        cssTexts.push(await fs.readFile(cssPath, "utf8"));
      }
    } catch {
      continue;
    }
  }

  return {
    css: cssTexts.join("\n"),
    html,
  };
}

function extractCssDeclarationValues(css, property) {
  const values = [];
  const pattern = new RegExp(`${property}\\s*:\\s*([^;{}]+)`, "gi");
  let match;

  while ((match = pattern.exec(css))) {
    values.push(match[1]?.trim() ?? "");
  }

  return values;
}

async function collectSourceDesignWarnings(htmlAbsolutePath, workspaceRoot) {
  const warnings = [];
  const { css } = await readSlideHtmlDesignSources(htmlAbsolutePath, workspaceRoot);
  const source = css.toLowerCase();

  if (/\bpadding-bottom\s*:/i.test(css)) {
    warnings.push({
      message: "设计规范禁止在主要内容流中使用 padding-bottom。",
      type: "design-padding-bottom",
    });
  }

  if (/@keyframes\b|\banimation(?:-[a-z]+)?\s*:/i.test(css)) {
    warnings.push({
      message: "设计规范禁止 CSS 动画和 @keyframes。",
      type: "design-animation",
    });
  }

  if (/\btransition(?:-[a-z]+)?\s*:/i.test(css)) {
    warnings.push({
      message: "设计规范禁止 transition。",
      type: "design-transition",
    });
  }

  if (/:hover\b/i.test(css)) {
    warnings.push({
      message: "设计规范禁止 :hover 伪类。",
      type: "design-hover",
    });
  }

  if (/\bbox-shadow\s*:/i.test(css)) {
    warnings.push({
      message: "设计规范禁止使用卡片阴影，避免网页 UI 感和 PPTX 映射偏差。",
      type: "design-box-shadow",
    });
  }

  const contentValues = extractCssDeclarationValues(css, "content");
  const injectedTextValues = contentValues.filter((value) => {
    const normalized = value.trim();

    return /^["']/.test(normalized) && !/^["']\s*["']$/.test(normalized) && !/^["']\\?[a-z0-9-]*["']$/i.test(normalized);
  });

  if (injectedTextValues.length) {
    warnings.push({
      message: "设计规范禁止用 CSS 伪元素 content 注入关键文字。",
      type: "design-pseudo-content-text",
    });
  }

  const borderRadiusValues = extractCssDeclarationValues(css, "border-radius");
  const largeRadius = borderRadiusValues.find((value) =>
    Array.from(value.matchAll(/([\d.]+)px/gi)).some((match) => Number(match[1]) > 8),
  );

  if (largeRadius) {
    warnings.push({
      message: `设计规范要求 UI 圆角不超过 8px，检测到 ${largeRadius}。`,
      type: "design-large-radius",
    });
  }

  const fontFamilyCount = new Set(
    extractCssDeclarationValues(source, "font-family").map((value) => value.replace(/\s+/g, " ").trim()),
  ).size;

  if (fontFamilyCount > 2) {
    warnings.push({
      message: `设计规范要求每套 deck 最多使用 2 种字体，检测到 ${fontFamilyCount} 种 font-family 声明。`,
      type: "design-too-many-fonts",
    });
  }

  return warnings;
}

async function collectRuntimeDesignWarnings(browserContext, htmlAbsolutePath, slideSelector) {
  const page = await openSlideHtml(browserContext, htmlAbsolutePath);

  try {
    return await page.evaluate((selector) => {
      const warnings = [];
      const slides = Array.from(document.querySelectorAll(selector));
      const textSelector = [
        "[data-pptx-editable]",
        "h1",
        "h2",
        "h3",
        "p",
        "li",
        "blockquote",
        "td",
        "th",
        "figcaption",
      ].join(",");

      for (const slide of slides) {
        const slideId = slide.dataset.slideId || "unknown";
        const slideStyle = window.getComputedStyle(slide);

        if (slideStyle.boxSizing !== "border-box") {
          warnings.push({
            message: "设计规范要求 slide 使用 box-sizing: border-box。",
            slideId,
            type: "design-slide-box-sizing",
          });
        }

        if (slideStyle.overflow !== "hidden") {
          warnings.push({
            message: "设计规范要求 slide 使用 overflow: hidden。",
            slideId,
            type: "design-slide-overflow",
          });
        }

        const textElements = Array.from(slide.querySelectorAll(textSelector)).filter((element) => {
          const text = element.textContent?.trim();

          return Boolean(text) && !element.closest("[data-pptx-raster]") && !element.closest("[data-pptx-ignore]") && !element.hasAttribute("data-pptx-fallback");
        });
        const absoluteTextCount = textElements.filter((element) => {
          const position = window.getComputedStyle(element).position;

          return position === "absolute" || position === "fixed";
        }).length;

        if (absoluteTextCount) {
          warnings.push({
            message: `设计规范禁止主内容文本使用绝对定位，检测到 ${absoluteTextCount} 个文本节点。`,
            slideId,
            type: "design-main-text-absolute",
          });
        }

        const denseParagraphs = Array.from(slide.querySelectorAll("p")).filter(
          (paragraph) => paragraph.textContent && paragraph.textContent.trim().length > 170 && !paragraph.closest("[data-pptx-raster]"),
        ).length;

        if (denseParagraphs) {
          warnings.push({
            message: `设计规范要求长文本提炼为列表或小标题块，检测到 ${denseParagraphs} 个过长段落。`,
            slideId,
            type: "design-long-paragraph",
          });
        }

        const paragraphCount = Array.from(slide.querySelectorAll("p")).filter(
          (paragraph) => paragraph.textContent?.trim() && !paragraph.closest("[data-pptx-raster]"),
        ).length;

        if (paragraphCount > 3) {
          warnings.push({
            message: `设计规范要求每页正文段落不超过 3 段，检测到 ${paragraphCount} 段。`,
            slideId,
            type: "design-too-many-paragraphs",
          });
        }

        const bodyTextElements = Array.from(slide.querySelectorAll("p, li, blockquote, td, th, figcaption, em")).filter(
          (element) => element.textContent?.trim() && !element.closest("[data-pptx-raster]") && !element.closest("[data-pptx-ignore]"),
        );
        const lowLineHeightCount = bodyTextElements.filter((element) => {
          const style = window.getComputedStyle(element);
          const fontSize = Number.parseFloat(style.fontSize);
          const lineHeight = Number.parseFloat(style.lineHeight);

          return fontSize > 0 && lineHeight > 0 && lineHeight / fontSize < 1.38;
        }).length;

        if (lowLineHeightCount) {
          warnings.push({
            message: `设计规范要求正文 line-height 接近 1.5 到 1.6，检测到 ${lowLineHeightCount} 个文本节点行高偏紧。`,
            slideId,
            type: "design-tight-line-height",
          });
        }

        const h2 = slide.querySelector("h2");

        if (h2 && !h2.classList.contains("summary-title")) {
          const fontSize = Number.parseFloat(window.getComputedStyle(h2).fontSize);

          if (fontSize < 30 || fontSize > 36) {
            warnings.push({
              message: `设计规范要求内容页标题约 32px，当前为 ${fontSize}px。`,
              slideId,
              type: "design-content-heading-size",
            });
          }
        }

        const deepEditableCount = textElements.filter((element) => {
          let depth = 0;
          let current = element;

          while (current && current !== slide) {
            depth += 1;
            current = current.parentElement;
          }

          return depth > 5;
        }).length;

        if (deepEditableCount) {
          warnings.push({
            message: `设计规范要求 DOM 结构扁平，检测到 ${deepEditableCount} 个关键文本节点嵌套过深。`,
            slideId,
            type: "design-deep-text-nesting",
          });
        }
      }

      const images = Array.from(document.querySelectorAll("img")).filter(
        (image) => !image.closest("[data-pptx-ignore]") && !image.hasAttribute("data-pptx-fallback"),
      );

      for (const image of images) {
        const rect = image.getBoundingClientRect();
        const style = window.getComputedStyle(image);
        const slide = image.closest(selector);
        const slideId = slide?.dataset.slideId || "unknown";

        if (rect.width <= 0 || rect.height <= 0) {
          warnings.push({
            message: "设计规范要求图片具有明确像素尺寸。",
            slideId,
            type: "design-image-size",
          });
        }

        if (style.objectFit === "fill") {
          warnings.push({
            message: "设计规范要求图片设置 object-fit，避免 PPTX 坐标和裁切不稳定。",
            slideId,
            type: "design-image-object-fit",
          });
        }
      }

      return warnings;
    }, slideSelector);
  } finally {
    await page.close();
  }
}

async function collectDesignGuidelineWarnings(browserContext, htmlAbsolutePath, slideSelector, workspaceRoot) {
  const [sourceWarnings, runtimeWarnings] = await Promise.all([
    collectSourceDesignWarnings(htmlAbsolutePath, workspaceRoot),
    collectRuntimeDesignWarnings(browserContext, htmlAbsolutePath, slideSelector),
  ]);

  return [...sourceWarnings, ...runtimeWarnings];
}

export async function collectHtmlMeasurements(browserContext, htmlAbsolutePath, slideSelector, workspaceRoot, preparedHtmlAbsolutePath) {
  const page = await openSlideHtml(browserContext, htmlAbsolutePath);

  try {
    const measured = await page.evaluate(
      ({ expectedHeight, expectedWidth, selector }) => {
        const warnings = [];
        const slides = Array.from(document.querySelectorAll(selector));
        const seenSlideIds = new Set();
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

          if (Math.abs(width - expectedWidth) > 1 || Math.abs(height - expectedHeight) > 1) {
            warnings.push({
              message: `slide 尺寸为 ${width}x${height}，预期为 ${expectedWidth}x${expectedHeight}。`,
              slideId: id,
              type: "slide-size-mismatch",
            });
          }

          if (slide.scrollWidth > slide.clientWidth || slide.scrollHeight > slide.clientHeight) {
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

        if (!slides.length) {
          warnings.push({
            message: `未找到 slide selector：${selector}`,
            type: "missing-slides",
          });
        }

        return {
          editableElements: document.querySelectorAll("[data-pptx-editable]").length,
          ignoredElements: document.querySelectorAll("[data-pptx-ignore]").length,
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
    const designWarnings = await collectDesignGuidelineWarnings(browserContext, htmlAbsolutePath, slideSelector, workspaceRoot);

    return {
      editableElements: measured.editableElements,
      ignoredElements: measured.ignoredElements,
      preparedHtml: toWorkspaceRelative(preparedHtmlAbsolutePath, workspaceRoot),
      rasterFallbacks: [],
      slideHeight: SLIDE_HEIGHT_PX,
      slideSelector,
      slides: measured.slideMeasurements,
      slideWidth: SLIDE_WIDTH_PX,
      sourceHtml: toWorkspaceRelative(htmlAbsolutePath, workspaceRoot),
      warnings: [...measured.warnings, ...designWarnings],
    };
  } finally {
    await page.close();
  }
}

export async function prepareSlideHtmlForPptx(args) {
  const {
    fallbackAssetsDirectory,
    htmlAbsolutePath,
    measurementsAbsolutePath,
    outHtmlAbsolutePath,
    slideSelector,
    workspaceRoot,
  } = args;
  const { browser, browserContext } = await launchHtmlPptxBrowser();

  try {
    const page = await openSlideHtml(browserContext, htmlAbsolutePath);
    const state = await page.evaluate(
      ({ expectedHeight, expectedWidth, selector }) => {
        const warnings = [];
        const slides = Array.from(document.querySelectorAll(selector));
        const seenSlideIds = new Set();
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

          if (Math.abs(width - expectedWidth) > 1 || Math.abs(height - expectedHeight) > 1) {
            warnings.push({
              message: `slide 尺寸为 ${width}x${height}，预期为 ${expectedWidth}x${expectedHeight}。`,
              slideId: id,
              type: "slide-size-mismatch",
            });
          }

          if (slide.scrollWidth > slide.clientWidth || slide.scrollHeight > slide.clientHeight) {
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
        const rasterElements = Array.from(document.querySelectorAll("[data-pptx-raster]")).map((element, index) => {
          const slide = element.closest(selector);
          const slideRect = slide?.getBoundingClientRect();
          const rect = element.getBoundingClientRect();
          const computedStyle = window.getComputedStyle(element);
          const slideId = slide?.dataset.slideId || `slide-${index + 1}`;
          const alt = element.getAttribute("data-pptx-alt") || element.getAttribute("aria-label") || "";

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

          return {
            alt,
            borderRadius: computedStyle.borderRadius,
            height: rect.height,
            index,
            left: slideRect ? rect.left - slideRect.left : rect.left,
            position: computedStyle.position,
            slideId,
            top: slideRect ? rect.top - slideRect.top : rect.top,
            width: rect.width,
            zIndex: computedStyle.zIndex,
          };
        });

        const ignoredElements = document.querySelectorAll("[data-pptx-ignore]").length;

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
          editableElements: document.querySelectorAll("[data-pptx-editable]").length,
          ignoredElements,
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
    const designWarnings = await collectDesignGuidelineWarnings(browserContext, htmlAbsolutePath, slideSelector, workspaceRoot);
    const warnings = [...state.warnings, ...designWarnings];
    const replacements = [];

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

      const assetName = `${sanitizePathSegment(rasterElement.slideId)}-${String(rasterElement.index + 1).padStart(2, "0")}.png`;
      const assetAbsolutePath = path.join(fallbackAssetsDirectory, assetName);
      const locator = page.locator(`[data-pptx-raster-index="${rasterElement.index}"]`);

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
        position: rasterElement.position,
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
          const original = document.querySelector(`[data-pptx-raster-index="${replacement.index}"]`);
          const slide = original?.closest(selector);

          if (!original || !slide) {
            continue;
          }

          const image = document.createElement("img");

          image.src = replacement.src;
          image.alt = replacement.alt;
          image.setAttribute("data-pptx-alt", replacement.alt);
          image.setAttribute("data-pptx-fallback", "true");
          image.style.width = `${replacement.width}px`;
          image.style.height = `${replacement.height}px`;
          image.style.objectFit = "contain";
          image.style.display = "block";
          image.style.margin = "0";
          image.style.zIndex = replacement.zIndex === "auto" ? "0" : replacement.zIndex;
          image.style.borderRadius = replacement.borderRadius;

          if (replacement.position === "static" || replacement.position === "relative") {
            image.style.position = replacement.position;
            original.replaceWith(image);
            continue;
          }

          image.style.position = "absolute";
          image.style.left = `${replacement.left}px`;
          image.style.top = `${replacement.top}px`;
          slide.appendChild(image);
          original.remove();
        }
      },
      {
        replacements,
        selector: slideSelector,
      },
    );

    const preparedHtml = await page.content();
    const measurements = {
      editableElements: state.editableElements,
      ignoredElements: state.ignoredElements,
      preparedHtml: toWorkspaceRelative(outHtmlAbsolutePath, workspaceRoot),
      rasterFallbacks: replacements.map((replacement) => ({
        alt: replacement.alt,
        asset: replacement.asset,
        height: Math.round(replacement.height * 100) / 100,
        index: replacement.index,
        left: Math.round(replacement.left * 100) / 100,
        position: replacement.position,
        slideId: replacement.slideId,
        top: Math.round(replacement.top * 100) / 100,
        width: Math.round(replacement.width * 100) / 100,
        zIndex: replacement.zIndex,
      })),
      slideHeight: SLIDE_HEIGHT_PX,
      slideSelector,
      slides: state.slideMeasurements,
      slideWidth: SLIDE_WIDTH_PX,
      sourceHtml: toWorkspaceRelative(htmlAbsolutePath, workspaceRoot),
      warnings,
    };

    await fs.mkdir(path.dirname(outHtmlAbsolutePath), { recursive: true });
    await fs.writeFile(outHtmlAbsolutePath, preparedHtml, "utf8");
    await fs.writeFile(measurementsAbsolutePath, `${JSON.stringify(measurements, null, 2)}\n`, "utf8");
    await page.close();

    return {
      measurementsPath: toWorkspaceRelative(measurementsAbsolutePath, workspaceRoot),
      outHtml: toWorkspaceRelative(outHtmlAbsolutePath, workspaceRoot),
      rasterFallbacks: replacements.length,
      warnings: warnings.length,
    };
  } finally {
    await closeBrowser(browser, browserContext);
  }
}

function findPackageRoot(startPath, packageName) {
  let current = startPath;

  while (current && current !== path.dirname(current)) {
    const packageJsonPath = path.join(current, "package.json");

    try {
      const packageJson = JSON.parse(requireFromScript("node:fs").readFileSync(packageJsonPath, "utf8"));

      if (packageJson.name === packageName) {
        return current;
      }
    } catch {
      // Keep walking.
    }

    current = path.dirname(current);
  }

  return undefined;
}

function resolveDomToPptxBundlePath() {
  const mainPath = requireFromScript.resolve("dom-to-pptx");
  const packageRoot = findPackageRoot(path.dirname(mainPath), "dom-to-pptx");

  if (!packageRoot) {
    return path.join(path.dirname(mainPath), "dom-to-pptx.bundle.js");
  }

  const packageJson = JSON.parse(requireFromScript("node:fs").readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  const browserField = typeof packageJson.browser === "string" ? packageJson.browser : "dist/dom-to-pptx.bundle.js";

  return path.join(packageRoot, browserField);
}

export async function exportHtmlToPptx(args) {
  const { author, htmlAbsolutePath, outPptxAbsolutePath, slideSelector, title, workspaceRoot } = args;
  const { browser, browserContext } = await launchHtmlPptxBrowser();
  const pageErrors = [];
  const consoleErrors = [];

  try {
    const { inlined, page } = await inlineLocalImagesForDomToPptx(browserContext, htmlAbsolutePath, workspaceRoot);

    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    const bundlePath = resolveDomToPptxBundlePath();

    await page.addScriptTag({ path: bundlePath });

    const bytes = await page.evaluate(
      async ({ author: deckAuthor, height, selector, title: deckTitle, width }) => {
        const api = window.domToPptx;

        if (!api?.exportToPptx) {
          throw new Error("dom-to-pptx browser bundle 未暴露 exportToPptx。");
        }

        const slideElements = Array.from(document.querySelectorAll(selector));

        if (!slideElements.length) {
          throw new Error(`未找到 slide selector：${selector}`);
        }

        const blob = await api.exportToPptx(slideElements, {
          author: deckAuthor,
          autoEmbedFonts: false,
          fileName: "deck.pptx",
          height,
          layout: "LAYOUT_WIDE",
          skipDownload: true,
          svgAsVector: true,
          title: deckTitle,
          width,
        });
        const arrayBuffer = await blob.arrayBuffer();

        return Array.from(new Uint8Array(arrayBuffer));
      },
      {
        author,
        height: SLIDE_HEIGHT_IN,
        selector: slideSelector,
        title,
        width: SLIDE_WIDTH_IN,
      },
    );

    await fs.mkdir(path.dirname(outPptxAbsolutePath), { recursive: true });
    await fs.writeFile(outPptxAbsolutePath, Buffer.from(bytes));
    await page.close();

    return {
      consoleErrors,
      html: toWorkspaceRelative(htmlAbsolutePath, workspaceRoot),
      inlined,
      outPptx: toWorkspaceRelative(outPptxAbsolutePath, workspaceRoot),
      pageErrors,
    };
  } finally {
    await closeBrowser(browser, browserContext);
  }
}

export async function renderHtmlPreviews(htmlAbsolutePath, previewDirectory, slideSelector, workspaceRoot) {
  await fs.rm(previewDirectory, { force: true, recursive: true });

  const { browser, browserContext } = await launchHtmlPptxBrowser();

  try {
    const page = await openSlideHtml(browserContext, htmlAbsolutePath);
    const slideIds = await page.evaluate((selector) => {
      return Array.from(document.querySelectorAll(selector)).map((slide, index) => slide.dataset.slideId || `slide-${index + 1}`);
    }, slideSelector);
    const previewPaths = [];

    await fs.mkdir(previewDirectory, { recursive: true });

    for (let index = 0; index < slideIds.length; index += 1) {
      const slideId = sanitizePathSegment(slideIds[index] ?? `slide-${index + 1}`);
      const previewPath = path.join(previewDirectory, `slide-${String(index + 1).padStart(2, "0")}-${slideId}.png`);

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

export async function inspectPptxFile(pptxAbsolutePath) {
  const zip = await JSZip.loadAsync(await fs.readFile(pptxAbsolutePath));
  const slideFiles = Object.keys(zip.files)
    .filter((fileName) => /^ppt\/slides\/slide\d+\.xml$/.test(fileName))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const mediaFiles = Object.keys(zip.files).filter((fileName) => /^ppt\/media\/.+/.test(fileName) && !zip.files[fileName]?.dir);
  let mediaBytes = 0;
  let textRuns = 0;
  let pictureCount = 0;

  for (const mediaFile of mediaFiles) {
    const content = await zip.file(mediaFile)?.async("uint8array");

    mediaBytes += content?.byteLength ?? 0;
  }

  for (const slideFile of slideFiles) {
    const xml = await zip.file(slideFile)?.async("string");

    if (!xml) {
      continue;
    }

    textRuns += xml.match(/<a:t>/g)?.length ?? 0;
    pictureCount += xml.match(/<p:pic>/g)?.length ?? 0;
  }

  return {
    mediaBytes,
    mediaFiles: mediaFiles.length,
    pictureCount,
    slideFiles: slideFiles.length,
    textRuns,
  };
}

export async function inspectPreparedHtmlImages(preparedHtmlAbsolutePath) {
  if (!(await fileExists(preparedHtmlAbsolutePath))) {
    return {
      dataUriImages: 0,
      fallbackImages: 0,
      images: 0,
      localImages: 0,
      remoteImages: 0,
    };
  }

  const html = await fs.readFile(preparedHtmlAbsolutePath, "utf8");
  const dom = new JSDOM(html);
  const images = Array.from(dom.window.document.querySelectorAll("img")).filter((image) => !image.closest("[data-pptx-ignore]"));
  const sourceValues = images.map((image) => image.getAttribute("src") ?? "");

  return {
    dataUriImages: sourceValues.filter((source) => source.startsWith("data:")).length,
    fallbackImages: images.filter((image) => image.hasAttribute("data-pptx-fallback")).length,
    images: images.length,
    localImages: sourceValues.filter((source) => source && !isRemoteOrDataImageSource(source)).length,
    remoteImages: sourceValues.filter((source) => /^https?:/i.test(source)).length,
  };
}

function runProcess(command, args, cwd, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
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

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        code: code ?? 1,
        stderr,
        stdout,
      });
    });
  });
}

async function commandExists(command, cwd) {
  if (path.isAbsolute(command)) {
    return fileExists(command);
  }

  try {
    const result = await runProcess("which", [command], cwd, 8000);

    return result.code === 0;
  } catch {
    return false;
  }
}

async function firstAvailableCommand(commands, cwd) {
  for (const command of commands) {
    if (command && (await commandExists(command, cwd))) {
      return command;
    }
  }

  return undefined;
}

async function renderQuickLookPptxThumbnail(pptxAbsolutePath, previewDirectory, workspaceRoot, warnings, fallbackStatus) {
  const qlmanage = await firstAvailableCommand(["qlmanage"], workspaceRoot);

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

  const result = await runProcess(qlmanage, ["-t", "-s", "1280", "-o", previewDirectory, pptxAbsolutePath], workspaceRoot, 60000);

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

  const thumbnailPath = path.join(previewDirectory, `${path.basename(pptxAbsolutePath)}.png`);

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

export async function renderPptxPreview(pptxAbsolutePath, previewDirectory, workspaceRoot) {
  const warnings = [];
  const files = [];

  await fs.rm(previewDirectory, { force: true, recursive: true });
  await fs.mkdir(previewDirectory, { recursive: true });

  const soffice = await firstAvailableCommand(
    [process.env.LIBREOFFICE_PATH, "soffice", "libreoffice", "/Applications/LibreOffice.app/Contents/MacOS/soffice"],
    workspaceRoot,
  );

  if (!soffice) {
    warnings.push({
      message: "未找到 LibreOffice，PPTX 预览未渲染。",
      type: "pptx-preview-not-checked",
    });

    return renderQuickLookPptxThumbnail(pptxAbsolutePath, previewDirectory, workspaceRoot, warnings, "not_checked");
  }

  const libreOfficeProfile = path.join(previewDirectory, "lo-profile");
  await fs.mkdir(libreOfficeProfile, { recursive: true });

  const convertResult = await runProcess(
    soffice,
    [
      "--headless",
      `-env:UserInstallation=${pathToFileURL(libreOfficeProfile).href}`,
      "--convert-to",
      "pdf",
      "--outdir",
      previewDirectory,
      pptxAbsolutePath,
    ],
    workspaceRoot,
  );

  await fs.rm(libreOfficeProfile, { force: true, recursive: true }).catch(() => undefined);

  if (convertResult.code !== 0) {
    warnings.push({
      message: `LibreOffice 转 PDF 失败：${convertResult.stderr || convertResult.stdout}`,
      type: "pptx-preview-failed",
    });

    return renderQuickLookPptxThumbnail(pptxAbsolutePath, previewDirectory, workspaceRoot, warnings, "failed");
  }

  const pdfPath = path.join(previewDirectory, `${path.basename(pptxAbsolutePath, path.extname(pptxAbsolutePath))}.pdf`);

  if (!(await fileExists(pdfPath))) {
    warnings.push({
      message: "LibreOffice 未产出 PDF 预览。",
      type: "pptx-preview-missing-pdf",
    });

    return renderQuickLookPptxThumbnail(pptxAbsolutePath, previewDirectory, workspaceRoot, warnings, "failed");
  }

  files.push(toWorkspaceRelative(pdfPath, workspaceRoot));

  const pdftoppm = await firstAvailableCommand(["pdftoppm"], workspaceRoot);

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
  const renderResult = await runProcess(pdftoppm, ["-png", "-r", "144", pdfPath, outputPrefix], workspaceRoot);

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
    .map((fileName) => toWorkspaceRelative(path.join(previewDirectory, fileName), workspaceRoot));

  files.push(...renderedFiles);

  return {
    files,
    status: renderedFiles.length ? "rendered" : "pdf-only",
    warnings,
  };
}

export async function readMeasurements(measurementsAbsolutePath) {
  if (!measurementsAbsolutePath || !(await fileExists(measurementsAbsolutePath))) {
    return undefined;
  }

  return JSON.parse(await fs.readFile(measurementsAbsolutePath, "utf8"));
}

function readPng(filePath) {
  return PNG.sync.read(requireFromScript("node:fs").readFileSync(filePath));
}

function resizeNearest(source, width, height) {
  if (source.width === width && source.height === height) {
    return source;
  }

  const target = new PNG({ width, height });

  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(source.height - 1, Math.floor((y / height) * source.height));

    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(source.width - 1, Math.floor((x / width) * source.width));
      const sourceIndex = (sourceY * source.width + sourceX) * 4;
      const targetIndex = (y * width + x) * 4;

      target.data[targetIndex] = source.data[sourceIndex];
      target.data[targetIndex + 1] = source.data[sourceIndex + 1];
      target.data[targetIndex + 2] = source.data[sourceIndex + 2];
      target.data[targetIndex + 3] = source.data[sourceIndex + 3];
    }
  }

  return target;
}

function calculateImageStats(image) {
  const sampleStep = Math.max(1, Math.floor((image.width * image.height) / 200000));
  let count = 0;
  let sum = 0;
  let sumSquares = 0;
  let nonWhite = 0;

  for (let index = 0; index < image.data.length; index += 4 * sampleStep) {
    const alpha = image.data[index + 3] / 255;
    const red = image.data[index] * alpha + 255 * (1 - alpha);
    const green = image.data[index + 1] * alpha + 255 * (1 - alpha);
    const blue = image.data[index + 2] * alpha + 255 * (1 - alpha);
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;

    count += 1;
    sum += luminance;
    sumSquares += luminance * luminance;

    if (Math.abs(red - 255) > 12 || Math.abs(green - 255) > 12 || Math.abs(blue - 255) > 12) {
      nonWhite += 1;
    }
  }

  const mean = count ? sum / count : 255;
  const variance = count ? sumSquares / count - mean * mean : 0;
  const nonWhitePercent = count ? (nonWhite / count) * 100 : 0;

  return {
    mean: Math.round(mean * 100) / 100,
    nonWhitePercent: Math.round(nonWhitePercent * 100) / 100,
    variance: Math.round(Math.max(0, variance) * 100) / 100,
  };
}

function absoluteFromWorkspaceRelative(workspaceRoot, relativePath) {
  return path.join(workspaceRoot, relativePath);
}

export async function collectVisualSmoke(htmlPreviews, pptxPreview, workspaceRoot) {
  const warnings = [];
  const htmlPngs = htmlPreviews.filter((filePath) => filePath.endsWith(".png"));
  const pptxPngs = pptxPreview.files.filter((filePath) => /preview-pptx\/slide-\d+\.png$/.test(filePath));

  if (pptxPreview.status !== "rendered") {
    return {
      available: false,
      reason: `pptx preview status: ${pptxPreview.status}`,
      slides: [],
      warnings,
    };
  }

  if (htmlPngs.length !== pptxPngs.length) {
    warnings.push({
      message: `HTML 预览页数 ${htmlPngs.length} 与 PPTX PNG 预览页数 ${pptxPngs.length} 不一致。`,
      type: "visual-preview-count-mismatch",
    });
  }

  const pageCount = Math.min(htmlPngs.length, pptxPngs.length);
  const slides = [];

  for (let index = 0; index < pageCount; index += 1) {
    const htmlImage = readPng(absoluteFromWorkspaceRelative(workspaceRoot, htmlPngs[index]));
    const pptxImage = readPng(absoluteFromWorkspaceRelative(workspaceRoot, pptxPngs[index]));
    const compareWidth = Math.min(640, htmlImage.width, pptxImage.width);
    const compareHeight = Math.min(360, htmlImage.height, pptxImage.height);
    const normalizedHtml = resizeNearest(htmlImage, compareWidth, compareHeight);
    const normalizedPptx = resizeNearest(pptxImage, compareWidth, compareHeight);
    const diff = new PNG({ width: compareWidth, height: compareHeight });
    const mismatches = pixelmatch(normalizedHtml.data, normalizedPptx.data, diff.data, compareWidth, compareHeight, {
      threshold: 0.2,
    });
    const mismatchPercent = Math.round((mismatches / (compareWidth * compareHeight)) * 10000) / 100;
    const stats = calculateImageStats(pptxImage);
    const blankRisk = stats.variance < 6 && stats.nonWhitePercent < 1.2;
    const status = blankRisk ? "blank-risk" : mismatchPercent > 70 ? "high-diff" : "ok";

    if (blankRisk) {
      warnings.push({
        message: `PPTX 第 ${index + 1} 页预览接近空白。`,
        slideId: `slide-${index + 1}`,
        type: "visual-blank-risk",
      });
    }

    if (mismatchPercent > 70) {
      warnings.push({
        message: `HTML 与 PPTX 第 ${index + 1} 页视觉差异过高：${mismatchPercent}%。`,
        slideId: `slide-${index + 1}`,
        type: "visual-high-diff",
      });
    }

    slides.push({
      blankRisk,
      htmlPreview: htmlPngs[index],
      index: index + 1,
      mismatchPercent,
      pptxPreview: pptxPngs[index],
      pptxStats: stats,
      status,
    });
  }

  return {
    available: true,
    slides,
    warnings,
  };
}

export async function validateHtmlPptxExport(args) {
  const {
    htmlAbsolutePath,
    measurementsAbsolutePath,
    pptxAbsolutePath,
    preparedHtmlAbsolutePath,
    previewHtmlDirectory,
    previewPptxDirectory,
    qaReportAbsolutePath,
    slideSelector,
    workspaceRoot,
  } = args;
  const { browser, browserContext } = await launchHtmlPptxBrowser();
  let measurements = await readMeasurements(measurementsAbsolutePath);

  try {
    if (!measurements) {
      measurements = await collectHtmlMeasurements(browserContext, htmlAbsolutePath, slideSelector, workspaceRoot, preparedHtmlAbsolutePath);
    }
  } finally {
    await closeBrowser(browser, browserContext);
  }

  const [htmlPreviews, preparedHtmlImages, pptxInspection, pptxPreview] = await Promise.all([
    renderHtmlPreviews(htmlAbsolutePath, previewHtmlDirectory, slideSelector, workspaceRoot),
    inspectPreparedHtmlImages(preparedHtmlAbsolutePath),
    inspectPptxFile(pptxAbsolutePath),
    renderPptxPreview(pptxAbsolutePath, previewPptxDirectory, workspaceRoot),
  ]);
  const pptxPreviewStatusPath = path.join(previewPptxDirectory, "render-status.json");
  const pptxPreviewStatusRelativePath = toWorkspaceRelative(pptxPreviewStatusPath, workspaceRoot);

  await fs.mkdir(previewPptxDirectory, { recursive: true });
  pptxPreview.files.push(pptxPreviewStatusRelativePath);
  await fs.writeFile(pptxPreviewStatusPath, `${JSON.stringify(pptxPreview, null, 2)}\n`, "utf8");

  const visualSmoke = await collectVisualSmoke(htmlPreviews, pptxPreview, workspaceRoot).catch((error) => ({
    available: false,
    reason: error instanceof Error ? error.message : "visual smoke check failed",
    slides: [],
    warnings: [
      {
        message: error instanceof Error ? error.message : "视觉 smoke check 执行失败。",
        type: "visual-smoke-failed",
      },
    ],
  }));

  const warnings = [...(measurements?.warnings ?? []), ...pptxPreview.warnings, ...visualSmoke.warnings];

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

  if (preparedHtmlImages.images > 0 && pptxInspection.pictureCount < preparedHtmlImages.images) {
    warnings.push({
      message: `PPTX 图片对象数 ${pptxInspection.pictureCount} 少于 prepared HTML 图片数 ${preparedHtmlImages.images}，可能存在视觉资产丢失。`,
      type: "pptx-image-count-mismatch",
    });
  }

  const designWarnings = warnings.filter((warning) => warning.type.startsWith("design-"));
  const report = {
    deck: toWorkspaceRelative(pptxAbsolutePath, workspaceRoot),
    designGuidelines: {
      reference:
        "skills/html-to-pptx/reference-materials/html-to-pptx-agent-design-guidelines.md",
      status: designWarnings.length ? "violations" : "passed",
      warnings: designWarnings,
    },
    editableElements: measurements.editableElements,
    generatedPptxPath: toWorkspaceRelative(pptxAbsolutePath, workspaceRoot),
    htmlPreviewPaths: htmlPreviews,
    ignoredElements: measurements.ignoredElements,
    measurementsPath: toWorkspaceRelative(measurementsAbsolutePath, workspaceRoot),
    preparedHtml: toWorkspaceRelative(preparedHtmlAbsolutePath, workspaceRoot),
    preparedHtmlImages,
    pptxInspection,
    pptxPreview,
    rasterFallbacks: measurements.rasterFallbacks.length,
    schema: "ranni.html-to-pptx.qa.v1",
    slideHeight: SLIDE_HEIGHT_PX,
    slideSelector,
    slides: measurements.slides.length,
    slideWidth: SLIDE_WIDTH_PX,
    sourceHtml: toWorkspaceRelative(htmlAbsolutePath, workspaceRoot),
    visualSmoke,
    warnings,
  };

  await fs.mkdir(path.dirname(qaReportAbsolutePath), { recursive: true });
  await fs.writeFile(qaReportAbsolutePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return {
    editableElements: report.editableElements,
    qaReport: toWorkspaceRelative(qaReportAbsolutePath, workspaceRoot),
    rasterFallbacks: report.rasterFallbacks,
    slides: report.slides,
    warnings: warnings.length,
  };
}
