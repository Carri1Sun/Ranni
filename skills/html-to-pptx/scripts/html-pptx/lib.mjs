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
export const CSS_PX_PER_INCH = 96;
export const SLIDE_WIDTH_IN = SLIDE_WIDTH_PX / CSS_PX_PER_INCH;
export const SLIDE_HEIGHT_IN = SLIDE_HEIGHT_PX / CSS_PX_PER_INCH;

const EMU_PER_INCH = 914400;
const TEXT_WIDTH_BUFFER_RATIO = 0.05;
const TEXT_WIDTH_BUFFER_MIN_PX = 8;
const TEXT_WIDTH_BUFFER_MAX_PX = 16;
const PORTABLE_CJK_FONT_FAMILY = "Noto Sans SC";
const PORTABLE_CJK_FONT_PACKAGE = "@fontsource-variable/noto-sans-sc";

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

function diagnosticType(code) {
  return String(code || "slide-diagnostic")
    .toLowerCase()
    .replace(/_/g, "-");
}

export async function collectSlideDiagnostics(page, slideSelector = ".slide", options = {}) {
  const result = await page.evaluate(
    ({ expectedHeight, expectedSlideId, expectedWidth, requireOrigin, selector }) => {
      const round = (value) => Math.round(value * 100) / 100;
      const rectOutside = (rect, boundary) =>
        rect.left < boundary.left - 1 ||
        rect.top < boundary.top - 1 ||
        rect.right > boundary.right + 1 ||
        rect.bottom > boundary.bottom + 1;
      const visible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();

        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number.parseFloat(style.opacity || "1") > 0 &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      const selectorFor = (element, slide) => {
        const parts = [];
        let current = element;

        while (current && current !== slide && parts.length < 5) {
          let part = current.tagName.toLowerCase();

          if (current.id) {
            part += `#${CSS.escape(current.id)}`;
            parts.unshift(part);
            break;
          }

          const stableClass = Array.from(current.classList).find(
            (className) => className && !/^ranni-|^pptx-/i.test(className),
          );

          if (stableClass) {
            part += `.${CSS.escape(stableClass)}`;
          } else if (current.parentElement) {
            const siblings = Array.from(current.parentElement.children).filter(
              (sibling) => sibling.tagName === current.tagName,
            );

            if (siblings.length > 1) {
              part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
            }
          }

          parts.unshift(part);
          current = current.parentElement;
        }

        return parts.join(" > ") || element.tagName.toLowerCase();
      };
      const relevantStyles = (style) => ({
        bottom: style.bottom,
        height: style.height,
        left: style.left,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        position: style.position,
        right: style.right,
        top: style.top,
        width: style.width,
      });
      const rectDetails = (rect, slideRect) => ({
        bottom: round(rect.bottom - slideRect.top),
        height: round(rect.height),
        left: round(rect.left - slideRect.left),
        right: round(rect.right - slideRect.left),
        top: round(rect.top - slideRect.top),
        width: round(rect.width),
      });
      const issues = [];
      const issueKeys = new Set();
      const addIssue = (issue) => {
        const key = `${issue.code}:${issue.slideId || ""}:${issue.selector || ""}`;

        if (!issueKeys.has(key) && issues.length < 24) {
          issueKeys.add(key);
          issues.push(issue);
        }
      };
      const slides = Array.from(document.querySelectorAll(selector));
      const seenSlideIds = new Set();
      const measurements = [];

      if (!slides.length) {
        addIssue({
          code: "SLIDE_NOT_FOUND",
          message: `未找到 slide selector：${selector}`,
          severity: "error",
        });
      }

      if (expectedSlideId && slides.length !== 1) {
        addIssue({
          code: "SLIDE_COUNT_INVALID",
          message: `预检需要且只能包含一个 .slide，实际为 ${slides.length}。`,
          severity: "error",
        });
      }

      for (const [index, slide] of slides.entries()) {
        const slideRect = slide.getBoundingClientRect();
        const slideStyle = window.getComputedStyle(slide);
        const slideId = slide.dataset.slideId || `slide-${index + 1}`;
        const width = round(slideRect.width);
        const height = round(slideRect.height);
        const overflowWidth = Math.max(0, slide.scrollWidth - slide.clientWidth);
        const overflowHeight = Math.max(0, slide.scrollHeight - slide.clientHeight);

        if (!slide.dataset.slideId) {
          addIssue({
            code: "SLIDE_ID_MISSING",
            message: "slide 缺少 data-slide-id。",
            severity: "error",
            slideId,
          });
        }

        if (seenSlideIds.has(slideId)) {
          addIssue({
            code: "SLIDE_ID_DUPLICATE",
            message: `slide id ${slideId} 重复。`,
            severity: "error",
            slideId,
          });
        }
        seenSlideIds.add(slideId);

        if (expectedSlideId && slide.dataset.slideId !== expectedSlideId) {
          addIssue({
            code: "SLIDE_ID_MISMATCH",
            message: `预检 slideId 不一致：预期 ${expectedSlideId}，实际 ${slide.dataset.slideId || "空"}。`,
            severity: "error",
            slideId,
          });
        }

        if (Math.abs(width - expectedWidth) > 1 || Math.abs(height - expectedHeight) > 1) {
          addIssue({
            code: "SLIDE_SIZE_MISMATCH",
            message: `slide 尺寸为 ${width}x${height}，预期为 ${expectedWidth}x${expectedHeight}。`,
            severity: "error",
            slideId,
          });
        }

        if (slideStyle.overflowX !== "hidden" || slideStyle.overflowY !== "hidden") {
          addIssue({
            code: "SLIDE_OVERFLOW_POLICY_INVALID",
            message: "slide 必须设置 overflow: hidden。",
            severity: "error",
            slideId,
          });
        }

        if (requireOrigin && (Math.abs(slideRect.left) > 1 || Math.abs(slideRect.top) > 1)) {
          addIssue({
            code: "SLIDE_ORIGIN_MISMATCH",
            message: `slide 起点为 (${round(slideRect.left)}, ${round(slideRect.top)})，预期为 (0, 0)；请清除 html/body 默认 margin。`,
            severity: "error",
            slideId,
          });
        }

        const elements = Array.from(slide.querySelectorAll("*")).filter(
          (element) =>
            visible(element) &&
            !element.closest("[data-pptx-ignore]") &&
            !element.hasAttribute("data-pptx-ignore"),
        );
        const outsideElements = elements.filter((element) =>
          rectOutside(element.getBoundingClientRect(), slideRect),
        );
        const boundaryElements = outsideElements.filter(
          (element) =>
            !Array.from(element.children).some((child) =>
              outsideElements.includes(child),
            ),
        );
        let attributedOverflow = false;

        for (const element of boundaryElements) {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          const text = (element.textContent || "").replace(/\s+/g, " ").trim();
          const hasMedia = Boolean(
            element.matches("img, video, canvas, svg, [data-pptx-raster]") ||
              element.querySelector("img, video, canvas, svg, [data-pptx-raster]"),
          );
          const explicitlyDecorative =
            element.getAttribute("aria-hidden") === "true" ||
            element.getAttribute("role") === "presentation" ||
            element.hasAttribute("data-slide-decoration") ||
            element.hasAttribute("data-pptx-decoration");
          const positioned = style.position === "absolute" || style.position === "fixed";
          const decorative = positioned && !text && (!hasMedia || explicitlyDecorative);
          const selectorPath = selectorFor(element, slide);

          attributedOverflow = true;
          addIssue({
            clippedBySlide:
              slideStyle.overflowX === "hidden" && slideStyle.overflowY === "hidden",
            code: decorative ? "SLIDE_DECORATION_CLIPPED" : "SLIDE_CONTENT_OUTSIDE_CANVAS",
            element: rectDetails(rect, slideRect),
            message: decorative
              ? `无文本绝对定位装饰 ${selectorPath} 延伸到画布外，将由 slide 裁切。`
              : `内容元素 ${selectorPath} 延伸到 slide 画布外。`,
            selector: selectorPath,
            severity: decorative ? "warning" : "error",
            slideId,
            styles: relevantStyles(style),
            text: text.slice(0, 160),
          });
        }

        for (const element of elements) {
          const style = window.getComputedStyle(element);
          const clipsContent = [style.overflowX, style.overflowY].some((value) =>
            ["hidden", "clip", "scroll", "auto"].includes(value),
          );
          const hasText = Boolean((element.textContent || "").trim());
          const internalOverflow =
            element.scrollWidth > element.clientWidth + 1 ||
            element.scrollHeight > element.clientHeight + 1;

          if (clipsContent && hasText && internalOverflow) {
            const selectorPath = selectorFor(element, slide);

            addIssue({
              code: "SLIDE_TEXT_CLIPPED",
              element: rectDetails(element.getBoundingClientRect(), slideRect),
              message: `文本容器 ${selectorPath} 的内容超出自身边界并被裁切。`,
              selector: selectorPath,
              severity: "error",
              slideId,
              styles: relevantStyles(style),
              text: (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160),
            });
          }

          const directTextNodes = Array.from(element.childNodes).filter(
            (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
          );

          if (!directTextNodes.length) {
            continue;
          }

          const range = document.createRange();
          range.setStartBefore(directTextNodes[0]);
          range.setEndAfter(directTextNodes[directTextNodes.length - 1]);
          const textRect = range.getBoundingClientRect();

          if (textRect.width > 0 && textRect.height > 0 && rectOutside(textRect, slideRect)) {
            const selectorPath = selectorFor(element, slide);

            addIssue({
              code: "SLIDE_TEXT_OUTSIDE_CANVAS",
              element: rectDetails(textRect, slideRect),
              message: `文本 ${selectorPath} 延伸到 slide 画布外。`,
              selector: selectorPath,
              severity: "error",
              slideId,
              styles: relevantStyles(style),
              text: directTextNodes.map((node) => node.textContent || "").join(" ").trim().slice(0, 160),
            });
          }
        }

        if ((overflowWidth > 1 || overflowHeight > 1) && !attributedOverflow) {
          addIssue({
            code: "SLIDE_SCROLL_OVERFLOW_UNATTRIBUTED",
            message: `slide 的滚动尺寸超出画布 ${overflowWidth}px x ${overflowHeight}px，但未定位到可见责任元素；请检查伪元素或浏览器生成内容。`,
            severity: "warning",
            slideId,
          });
        }

        measurements.push({
          height,
          id: slideId,
          index,
          overflowHeight,
          overflowWidth,
          scrollHeight: slide.scrollHeight,
          scrollWidth: slide.scrollWidth,
          width,
        });
      }

      return { issues, slides: measurements };
    },
    {
      expectedHeight: Number(options.expectedHeight || SLIDE_HEIGHT_PX),
      expectedSlideId: String(options.expectedSlideId || ""),
      expectedWidth: Number(options.expectedWidth || SLIDE_WIDTH_PX),
      requireOrigin: Boolean(options.requireOrigin),
      selector: slideSelector,
    },
  );
  const issues = result.issues.map((issue) => ({
    ...issue,
    category: "slide-diagnostic",
    type: diagnosticType(issue.code),
  }));
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");

  return {
    errors,
    issues,
    schema: "ranni.html-to-pptx.slide-diagnostics.v1",
    slides: result.slides,
    status: errors.length ? "failed" : warnings.length ? "warning" : "passed",
    summary: {
      errors: errors.length,
      warnings: warnings.length,
    },
    warnings,
  };
}

function parseUnicodeRange(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim().replace(/^U\+/i, ""))
    .filter(Boolean)
    .map((entry) => {
      if (entry.includes("?")) {
        return {
          end: Number.parseInt(entry.replace(/\?/g, "f"), 16),
          start: Number.parseInt(entry.replace(/\?/g, "0"), 16),
        };
      }

      const [start, end = start] = entry.split("-");

      return {
        end: Number.parseInt(end, 16),
        start: Number.parseInt(start, 16),
      };
    })
    .filter((entry) => Number.isFinite(entry.start) && Number.isFinite(entry.end));
}

function unicodeRangeContainsAny(ranges, codePoints) {
  return codePoints.some((codePoint) => ranges.some((range) => codePoint >= range.start && codePoint <= range.end));
}

async function installPortableCjkFont(page, slideSelector) {
  const pageText = await page.evaluate((selector) => {
    const slides = Array.from(document.querySelectorAll(selector));

    return slides.map((slide) => slide.textContent || "").join("\n");
  }, slideSelector);

  if (!/[\u2e80-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(pageText)) {
    return {
      appliedElements: 0,
      available: true,
      bytes: 0,
      family: undefined,
      fonts: [],
      subsetCount: 0,
      subsets: [],
    };
  }

  try {
    const unicodePath = requireFromScript.resolve(`${PORTABLE_CJK_FONT_PACKAGE}/unicode.json`);
    const packageDirectory = path.dirname(unicodePath);
    const unicodeRanges = JSON.parse(await fs.readFile(unicodePath, "utf8"));
    const codePoints = Array.from(new Set(Array.from(pageText, (character) => character.codePointAt(0)))).filter(Number.isFinite);
    const selectedSubsets = Object.entries(unicodeRanges)
      .filter(([, unicodeRange]) => unicodeRangeContainsAny(parseUnicodeRange(unicodeRange), codePoints))
      .map(([subset, unicodeRange]) => ({
        fileStem: subset.replace(/^\[|\]$/g, ""),
        subset,
        unicodeRange,
      }));
    const fontSources = [];
    let bytes = 0;

    for (const subset of selectedSubsets) {
      const fileName = `noto-sans-sc-${subset.fileStem}-wght-normal.woff2`;
      const filePath = path.join(packageDirectory, "files", fileName);
      const buffer = await fs.readFile(filePath);
      const dataUri = `data:font/woff2;base64,${buffer.toString("base64")}#${fileName}`;

      bytes += buffer.byteLength;
      fontSources.push({
        dataUri,
        fileName,
        subset: subset.subset,
        unicodeRange: subset.unicodeRange,
      });
    }

    if (!fontSources.length) {
      throw new Error("没有找到覆盖当前文稿字符的 Noto Sans SC 字体子集。");
    }

    const css = [
      ...fontSources.map(
        (font) => `@font-face {
  font-family: "${PORTABLE_CJK_FONT_FAMILY}";
  font-style: normal;
  font-display: block;
  font-weight: 100 900;
  src: url("${font.dataUri}") format("woff2-variations");
  unicode-range: ${font.unicodeRange};
}`,
      ),
      `[data-ranni-portable-cjk-font="true"] {
  font-family: "${PORTABLE_CJK_FONT_FAMILY}" !important;
}`,
    ].join("\n");
    const appliedElements = await page.evaluate(
      ({ cssText, selector }) => {
        const hasCjk = (value) => /[\u2e80-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(value || "");
        const customFontFamilies = new Set();
        const style = document.createElement("style");

        for (const sheet of Array.from(document.styleSheets)) {
          try {
            for (const rule of Array.from(sheet.cssRules || [])) {
              if (rule.constructor.name !== "CSSFontFaceRule" && rule.type !== 5) {
                continue;
              }

              const family = rule.style.getPropertyValue("font-family").replace(/["']/g, "").trim();

              if (family) {
                customFontFamilies.add(family.toLowerCase());
              }
            }
          } catch {
            // Cross-origin stylesheets may not expose cssRules.
          }
        }

        style.setAttribute("data-ranni-portable-cjk-font-style", "true");
        style.textContent = cssText;
        document.head.appendChild(style);

        let applied = 0;

        for (const element of document.querySelectorAll(`${selector}, ${selector} *`)) {
          if (
            element.closest("[data-pptx-ignore]") ||
            element.closest("[data-pptx-raster]") ||
            element.closest('[data-pptx-fallback="true"]')
          ) {
            continue;
          }

          const directText = Array.from(element.childNodes)
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent || "")
            .join("");
          const leafText = element.children.length === 0 ? element.textContent || "" : "";
          const beforeContent = window.getComputedStyle(element, "::before").content.replace(/^['"]|['"]$/g, "");
          const afterContent = window.getComputedStyle(element, "::after").content.replace(/^['"]|['"]$/g, "");
          const combinedText = `${directText}${leafText}${beforeContent}${afterContent}`;
          const computedFamily = window.getComputedStyle(element).fontFamily.split(",")[0]?.replace(/["']/g, "").trim() || "";
          const customSourceFont = customFontFamilies.has(computedFamily.toLowerCase());
          const iconFont = /(?:font\s*awesome|material\s*icons?|icon)/i.test(computedFamily);

          if (!combinedText.trim() || iconFont || (customSourceFont && !hasCjk(combinedText))) {
            continue;
          }

          element.setAttribute("data-ranni-portable-cjk-font", "true");
          applied += 1;
        }

        return applied;
      },
      { cssText: css, selector: slideSelector },
    );

    await page.evaluate(
      async ({ family, sample }) => {
        const text = Array.from(new Set(Array.from(sample))).join("").slice(0, 4096);

        await Promise.all([
          document.fonts.load(`400 16px "${family}"`, text),
          document.fonts.load(`700 16px "${family}"`, text),
          document.fonts.ready,
        ]);
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      },
      { family: PORTABLE_CJK_FONT_FAMILY, sample: pageText },
    );

    return {
      appliedElements,
      available: true,
      bytes,
      family: PORTABLE_CJK_FONT_FAMILY,
      fonts: [
        {
          name: PORTABLE_CJK_FONT_FAMILY,
          style: "normal",
          urls: fontSources.map((font) => font.dataUri),
          weight: "400",
        },
      ],
      subsetCount: fontSources.length,
      subsets: fontSources.map((font) => font.subset),
    };
  } catch (error) {
    return {
      appliedElements: 0,
      available: false,
      bytes: 0,
      error: error instanceof Error ? error.message : String(error),
      family: undefined,
      fonts: [],
      subsetCount: 0,
      subsets: [],
    };
  }
}

async function removePortableCjkFont(page) {
  await page.evaluate(() => {
    document.querySelectorAll('[data-ranni-portable-cjk-font-style="true"]').forEach((style) => style.remove());
    document.querySelectorAll('[data-ranni-portable-cjk-font="true"]').forEach((element) => {
      element.removeAttribute("data-ranni-portable-cjk-font");
    });
  });
}

function summarizePortableFont(font) {
  return {
    appliedElements: font.appliedElements,
    available: font.available,
    bytes: font.bytes,
    error: font.error,
    family: font.family,
    subsetCount: font.subsetCount,
    subsets: font.subsets,
  };
}

async function collectTextLayoutDiagnostics(page, slideSelector, options = {}) {
  return page.evaluate(
    ({ bufferMaxPx, bufferMinPx, bufferRatio, selector, stabilize }) => {
      const compactAtomicClassPattern =
        /(^|[-_])(badge|chip|eyebrow|kicker|kpi|label|metric|num|number|pill|score|stat|tag|value)([-_]|$)/i;
      const titleAtomicClassPattern = /(^|[-_])(heading|title)([-_]|$)/i;
      const headingPattern = /^H[1-6]$/;
      const numericAtomPattern = /^[+-]?\d[\d,.]*(?:\s*(?:%|×|x|[A-Za-z]{1,8}))?(?:\s*[·:/→-]\s*[\w.+%×-]+)*$/u;
      const round = (value) => Math.round(value * 1000) / 1000;
      const slides = Array.from(document.querySelectorAll(selector));
      const items = [];
      let stabilizedElements = 0;

      for (const [slideIndex, slide] of slides.entries()) {
        const slideId = slide.dataset.slideId || `slide-${slideIndex + 1}`;
        const candidates = Array.from(slide.querySelectorAll("*")).filter((element) => {
          if (
            element.closest("[data-pptx-ignore]") ||
            element.closest("[data-pptx-raster]") ||
            element.closest('[data-pptx-fallback="true"]')
          ) {
            return false;
          }

          const text = element.textContent?.trim();

          if (!text) {
            return false;
          }

          return Array.from(element.children).every(
            (child) => child.tagName === "BR" || !(child.textContent || "").trim(),
          );
        });

        for (const [elementIndex, element] of candidates.entries()) {
          const style = window.getComputedStyle(element);
          const parentStyle = element.parentElement ? window.getComputedStyle(element.parentElement) : undefined;
          const rect = element.getBoundingClientRect();

          if (rect.width < 0.5 || rect.height < 0.5 || style.visibility === "hidden" || style.display === "none") {
            continue;
          }

          const range = document.createRange();
          range.selectNodeContents(element);
          const rangeRect = range.getBoundingClientRect();
          const lineTops = [];

          for (const fragment of Array.from(range.getClientRects())) {
            if (fragment.width < 0.1 || fragment.height < 0.1) {
              continue;
            }

            if (!lineTops.some((top) => Math.abs(top - fragment.top) < 1)) {
              lineTops.push(fragment.top);
            }
          }

          const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
          const paddingRight = Number.parseFloat(style.paddingRight) || 0;
          const contentWidth = Math.max(0, rect.width - paddingLeft - paddingRight);
          const textWidth = Math.min(contentWidth, rangeRect.width);
          const widthSlack = contentWidth - textWidth;
          const explicitLineCount = element.querySelectorAll("br").length + 1;
          const renderedLineCount = Math.max(1, lineTops.length);
          const normalizedText = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
          const parentDisplay = parentStyle?.display || "";
          const isFlexOrGridItem = /(?:flex|grid)/.test(parentDisplay);
          const standaloneTextBox = style.display !== "inline" || isFlexOrGridItem;
          const compactClassSignal = compactAtomicClassPattern.test(element.className || "");
          const titleClassSignal = titleAtomicClassPattern.test(element.className || "");
          const classSignal = compactClassSignal || titleClassSignal;
          const shortTitleAtom = titleClassSignal && normalizedText.length <= 20;
          const shortFlexAtom = isFlexOrGridItem && normalizedText.length <= 20;
          const strictAtomic =
            element.hasAttribute("data-pptx-atomic") ||
            numericAtomPattern.test(normalizedText) ||
            compactClassSignal ||
            shortTitleAtom ||
            (headingPattern.test(element.tagName) && normalizedText.length <= 20);
          const atomic =
            strictAtomic ||
            headingPattern.test(element.tagName) ||
            classSignal ||
            shortFlexAtom;
          const sourceKeepsLines = renderedLineCount <= explicitLineCount;
          const zeroSlack = widthSlack <= 1.5;
          const unintendedAtomicWrap = strictAtomic && explicitLineCount === 1 && renderedLineCount > 1;
          const proactiveShortAtom = strictAtomic && explicitLineCount === 1;
          let unwrappedWidth = rect.width;

          if (standaloneTextBox && atomic) {
            const clone = element.cloneNode(true);

            Object.assign(clone.style, {
              flex: "none",
              left: "-100000px",
              maxWidth: "none",
              minWidth: "0",
              overflowWrap: "normal",
              pointerEvents: "none",
              position: "fixed",
              top: "0",
              visibility: "hidden",
              whiteSpace: "nowrap",
              width: "max-content",
              wordBreak: "keep-all",
            });
            element.parentElement?.appendChild(clone);
            unwrappedWidth = clone.getBoundingClientRect().width || rect.width;
            clone.remove();
          }

          const stabilizationCandidate =
            standaloneTextBox && atomic && ((sourceKeepsLines && zeroSlack) || unintendedAtomicWrap || proactiveShortAtom);
          const alreadyNoWrap = style.whiteSpace === "nowrap" || style.whiteSpace === "pre";
          let bufferPx = 0;
          let buffered = false;

          if (stabilize && stabilizationCandidate) {
            const baseWidth = Math.max(rect.width, unwrappedWidth);

            bufferPx = Math.max(bufferMinPx, Math.min(bufferMaxPx, baseWidth * bufferRatio));
            element.style.setProperty("white-space", "nowrap", "important");
            element.style.setProperty("word-break", "keep-all", "important");
            element.style.setProperty("overflow-wrap", "normal", "important");
            element.setAttribute("data-ranni-text-stabilized", "true");

            if (isFlexOrGridItem || ["inline-block", "inline-flex", "flex"].includes(style.display)) {
              const bufferedWidth = baseWidth + bufferPx;

              element.style.setProperty("width", `${bufferedWidth}px`, "important");
              element.style.setProperty("min-width", `${bufferedWidth}px`, "important");
              element.style.setProperty("flex-shrink", "0", "important");
              buffered = true;
            }

            stabilizedElements += 1;
          }

          if (stabilizationCandidate) {
            items.push({
              alreadyNoWrap,
              bufferPx: round(bufferPx),
              buffered,
              className: element.className || "",
              contentWidth: round(contentWidth),
              elementIndex,
              explicitLineCount,
              renderedLineCount,
              slideId,
              tagName: element.tagName.toLowerCase(),
              text: normalizedText.slice(0, 120),
              textWidth: round(textWidth),
              unintendedAtomicWrap,
              unwrappedWidth: round(unwrappedWidth),
              width: round(rect.width),
              widthSlack: round(widthSlack),
            });
          }
        }
      }

      const overflowSlides = stabilize
        ? slides
            .filter((slide) => slide.scrollWidth > slide.clientWidth || slide.scrollHeight > slide.clientHeight)
            .map((slide, index) => slide.dataset.slideId || `slide-${index + 1}`)
        : [];

      return {
        buffer: {
          maxPx: bufferMaxPx,
          minPx: bufferMinPx,
          ratio: bufferRatio,
        },
        items,
        overflowSlides,
        riskCount: items.length,
        stabilizedElements,
      };
    },
    {
      bufferMaxPx: TEXT_WIDTH_BUFFER_MAX_PX,
      bufferMinPx: TEXT_WIDTH_BUFFER_MIN_PX,
      bufferRatio: TEXT_WIDTH_BUFFER_RATIO,
      selector: slideSelector,
      stabilize: Boolean(options.stabilize),
    },
  );
}

async function resolvePlatformFontsForPage(page, slideSelector, options = {}) {
  const apply = Boolean(options.apply);
  const compatibleCjkFamilies = [
    "Noto Sans CJK SC",
    "Noto Sans SC",
    "Source Han Sans SC",
    "Arial Unicode MS",
    "Microsoft YaHei",
    "Hiragino Sans GB",
    "PingFang SC",
  ];
  const probes = await page.evaluate((selector) => {
    const hasCjk = (value) => /[\u2e80-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(value);
    const probeHost = document.createElement("div");

    probeHost.setAttribute("data-ranni-font-probe-host", "true");
    document.body.appendChild(probeHost);

    const elements = Array.from(document.querySelectorAll(`${selector}, ${selector} *`)).filter((element) => {
      if (
        element.closest("[data-pptx-ignore]") ||
        element.closest("[data-pptx-raster]") ||
        element.closest('[data-pptx-fallback="true"]')
      ) {
        return false;
      }

      const directText = Array.from(element.childNodes).some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
      );

      return directText || (element.children.length === 0 && element.textContent?.trim());
    });

    return elements.map((element, index) => {
      const id = String(index);
      const text = element.textContent?.trim() || "";
      const style = window.getComputedStyle(element);
      const cjk = hasCjk(text);

      element.setAttribute("data-ranni-font-probe", id);

      if (cjk) {
        const probe = document.createElement("span");
        const cjkText = Array.from(text)
          .filter((character) => hasCjk(character))
          .join("") || "中文";

        probe.setAttribute("data-ranni-font-glyph-probe", id);
        probe.textContent = cjkText;
        Object.assign(probe.style, {
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontStretch: style.fontStretch,
          fontStyle: style.fontStyle,
          fontVariant: style.fontVariant,
          fontWeight: style.fontWeight,
          left: "-100000px",
          letterSpacing: style.letterSpacing,
          opacity: "0",
          pointerEvents: "none",
          position: "fixed",
          top: "0",
          whiteSpace: "nowrap",
        });
        probeHost.appendChild(probe);
      }

      return {
        cjk,
        cssFontFamily: style.fontFamily,
        id,
        text: text.replace(/\s+/g, " ").slice(0, 120),
      };
    });
  }, slideSelector);

  await page.evaluate((families) => {
    const probeHost = document.querySelector('[data-ranni-font-probe-host="true"]');

    if (!probeHost) {
      return;
    }

    for (const [index, family] of families.entries()) {
      const probe = document.createElement("span");

      probe.setAttribute("data-ranni-compatible-font-probe", String(index));
      probe.textContent = "中文排版 ABC 123";
      Object.assign(probe.style, {
        fontFamily: `"${family}", monospace`,
        fontSize: "16px",
        fontWeight: "400",
        left: "-100000px",
        opacity: "0",
        pointerEvents: "none",
        position: "fixed",
        top: "0",
        whiteSpace: "nowrap",
      });
      probeHost.appendChild(probe);
    }
  }, compatibleCjkFamilies);

  const cleanup = async () => {
    await page
      .evaluate(() => {
        document.querySelector('[data-ranni-font-probe-host="true"]')?.remove();
        document.querySelectorAll("[data-ranni-font-probe]").forEach((element) => {
          element.removeAttribute("data-ranni-font-probe");
        });
      })
      .catch(() => undefined);
  };

  if (!probes.length) {
    await cleanup();

    return {
      available: true,
      cjkFamilies: [],
      customFontCount: 0,
      fallbackElements: 0,
      families: [],
      resolvedElements: 0,
      totalElements: 0,
    };
  }

  let cdp;

  try {
    cdp = await page.context().newCDPSession(page);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument");
    const resolved = [];
    const availableCompatibleFonts = [];

    for (const [index, configuredFamily] of compatibleCjkFamilies.entries()) {
      const { nodeId } = await cdp.send("DOM.querySelector", {
        nodeId: root.nodeId,
        selector: `[data-ranni-compatible-font-probe="${index}"]`,
      });

      if (!nodeId) {
        continue;
      }

      const response = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
      const selected = [...(response.fonts || [])].sort((left, right) => right.glyphCount - left.glyphCount)[0];
      const configuredName = configuredFamily.toLowerCase().replace(/\s+/g, "");
      const actualName = selected?.familyName?.toLowerCase().replace(/\s+/g, "") || "";

      if (!selected?.familyName || !(actualName.includes(configuredName) || configuredName.includes(actualName))) {
        continue;
      }

      availableCompatibleFonts.push({
        custom: Boolean(selected.isCustomFont),
        family: selected.isCustomFont ? configuredFamily : selected.familyName,
      });
    }

    for (const probe of probes) {
      const probeSelector = probe.cjk
        ? `[data-ranni-font-glyph-probe="${probe.id}"]`
        : `[data-ranni-font-probe="${probe.id}"]`;
      const { nodeId } = await cdp.send("DOM.querySelector", {
        nodeId: root.nodeId,
        selector: probeSelector,
      });

      if (!nodeId) {
        continue;
      }

      const response = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
      const fonts = [...(response.fonts || [])].sort((left, right) => right.glyphCount - left.glyphCount);
      const selected = fonts[0];

      if (!selected?.familyName) {
        continue;
      }

      const configuredFirstFamily = probe.cssFontFamily.split(",")[0]?.replace(/["']/g, "").trim() || "";

      resolved.push({
        actualFamily: selected.familyName,
        cjk: probe.cjk,
        configuredFirstFamily,
        custom: Boolean(selected.isCustomFont),
        glyphCount: selected.glyphCount,
        id: probe.id,
        text: probe.text,
      });
    }

    const customCjkEntry = resolved.find((entry) => entry.cjk && entry.custom);
    const preferredCjkFont = customCjkEntry
      ? { custom: true, family: customCjkEntry.configuredFirstFamily || customCjkEntry.actualFamily }
      : availableCompatibleFonts[0];
    const deckHasCjk = resolved.some((entry) => entry.cjk);

    for (const entry of resolved) {
      if (entry.custom && entry.configuredFirstFamily) {
        entry.exportFamily = entry.configuredFirstFamily;
        entry.exportCustom = true;
      } else {
        entry.exportFamily = entry.cjk && preferredCjkFont ? preferredCjkFont.family : entry.actualFamily;
        entry.exportCustom = entry.cjk && preferredCjkFont ? preferredCjkFont.custom : entry.custom;
      }
    }

    if (apply && resolved.length) {
      await page.evaluate((entries) => {
        for (const entry of entries) {
          const element = document.querySelector(`[data-ranni-font-probe="${entry.id}"]`);

          if (!element) {
            continue;
          }

          const escapedFamily = entry.exportFamily.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

          element.style.setProperty("font-family", `"${escapedFamily}"`, "important");
          element.setAttribute("data-ranni-resolved-font", entry.exportFamily);
        }
      }, resolved);
    }

    const familyMap = new Map();
    const actualFamilyMap = new Map();

    for (const entry of resolved) {
      const current = familyMap.get(entry.exportFamily) || {
        cjkElements: 0,
        custom: entry.exportCustom,
        elements: 0,
        family: entry.exportFamily,
      };

      current.elements += 1;
      current.cjkElements += entry.cjk ? 1 : 0;
      current.custom ||= entry.exportCustom;
      familyMap.set(entry.exportFamily, current);
      actualFamilyMap.set(entry.actualFamily, (actualFamilyMap.get(entry.actualFamily) || 0) + 1);
    }

    const families = Array.from(familyMap.values()).sort((left, right) => right.elements - left.elements);
    const dominantFamily = families[0]?.family;

    return {
      available: true,
      actualFamilies: Array.from(actualFamilyMap, ([family, elements]) => ({ elements, family })).sort(
        (left, right) => right.elements - left.elements,
      ),
      cjkFamilies: deckHasCjk && preferredCjkFont ? [preferredCjkFont.family] : [],
      customFontCount: resolved.filter((entry) => entry.exportCustom).length,
      dominantFamily,
      fallbackElements: resolved.filter(
        (entry) => !entry.custom && entry.configuredFirstFamily.toLowerCase() !== entry.actualFamily.toLowerCase(),
      ).length,
      families,
      preferredCjkFamily: preferredCjkFont?.family,
      resolvedElements: resolved.length,
      totalElements: probes.length,
    };
  } catch (error) {
    return {
      available: false,
      cjkFamilies: [],
      customFontCount: 0,
      error: error instanceof Error ? error.message : String(error),
      fallbackElements: 0,
      families: [],
      resolvedElements: 0,
      totalElements: probes.length,
    };
  } finally {
    await cdp?.detach().catch(() => undefined);
    await cleanup();
  }
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
      message: "主要内容流使用了 padding-bottom，请确认没有改变 PPTX 高度测量。",
      type: "design-padding-bottom",
    });
  }

  if (/@keyframes\b|\banimation(?:-[a-z]+)?\s*:/i.test(css)) {
    warnings.push({
      message: "检测到 CSS 动画或 @keyframes，请确认最终静态状态可稳定导出。",
      type: "design-animation",
    });
  }

  if (/\btransition(?:-[a-z]+)?\s*:/i.test(css)) {
    warnings.push({
      message: "检测到 transition，请确认最终静态状态可稳定导出。",
      type: "design-transition",
    });
  }

  if (/:hover\b/i.test(css)) {
    warnings.push({
      message: "检测到 :hover，请确认关键信息不依赖交互状态。",
      type: "design-hover",
    });
  }

  if (/\bbox-shadow\s*:/i.test(css)) {
    warnings.push({
      message: "检测到卡片阴影，请确认视觉效果和 PPTX 映射结果符合预期。",
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
      message: "检测到 CSS 伪元素文字，请确认关键信息仍以可编辑 DOM 文本保留。",
      type: "design-pseudo-content-text",
    });
  }

  const borderRadiusValues = extractCssDeclarationValues(css, "border-radius");
  const largeRadius = borderRadiusValues.find((value) =>
    Array.from(value.matchAll(/([\d.]+)px/gi)).some((match) => Number(match[1]) > 8),
  );

  if (largeRadius) {
    warnings.push({
      message: `检测到较大圆角 ${largeRadius}，请确认视觉风格符合当前 deck。`,
      type: "design-large-radius",
    });
  }

  const fontFamilyCount = new Set(
    extractCssDeclarationValues(source, "font-family").map((value) => value.replace(/\s+/g, " ").trim()),
  ).size;

  if (fontFamilyCount > 2) {
    warnings.push({
      message: `检测到 ${fontFamilyCount} 种 font-family 声明，请确认字体系统保持一致。`,
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
            message: `检测到 ${absoluteTextCount} 个绝对定位文本节点，请确认其位置和 PPTX 映射稳定。`,
            slideId,
            type: "design-main-text-absolute",
          });
        }

        const denseParagraphs = Array.from(slide.querySelectorAll("p")).filter(
          (paragraph) => paragraph.textContent && paragraph.textContent.trim().length > 170 && !paragraph.closest("[data-pptx-raster]"),
        ).length;

        if (denseParagraphs) {
          warnings.push({
            message: `检测到 ${denseParagraphs} 个较长段落，请确认页面仍易于扫读。`,
            slideId,
            type: "design-long-paragraph",
          });
        }

        const paragraphCount = Array.from(slide.querySelectorAll("p")).filter(
          (paragraph) => paragraph.textContent?.trim() && !paragraph.closest("[data-pptx-raster]"),
        ).length;

        if (paragraphCount > 3) {
          warnings.push({
            message: `检测到 ${paragraphCount} 段正文，请确认页面密度符合叙事任务。`,
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
            message: `检测到 ${lowLineHeightCount} 个正文节点行高偏紧，请确认阅读舒适度。`,
            slideId,
            type: "design-tight-line-height",
          });
        }

        const h2 = slide.querySelector("h2");

        if (h2 && !h2.classList.contains("summary-title")) {
          const fontSize = Number.parseFloat(window.getComputedStyle(h2).fontSize);

          if (fontSize < 30 || fontSize > 36) {
            warnings.push({
              message: `内容页标题当前为 ${fontSize}px，请确认字号层级清晰。`,
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
            message: `检测到 ${deepEditableCount} 个关键文本节点嵌套较深，请确认 PPTX 映射稳定。`,
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
    const portableFont = await installPortableCjkFont(page, slideSelector);
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
    const slideDiagnostics = await collectSlideDiagnostics(page, slideSelector);
    const textLayout = await collectTextLayoutDiagnostics(page, slideSelector);
    const platformFonts = await resolvePlatformFontsForPage(page, slideSelector);
    const designWarnings = await collectDesignGuidelineWarnings(browserContext, htmlAbsolutePath, slideSelector, workspaceRoot);

    textLayout.platformFonts = platformFonts;
    textLayout.portableFont = summarizePortableFont(portableFont);

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
      textLayout,
      slideDiagnostics,
      warnings: [...measured.warnings, ...slideDiagnostics.issues, ...designWarnings],
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
    const portableFont = await installPortableCjkFont(page, slideSelector);
    const slideDiagnostics = await collectSlideDiagnostics(page, slideSelector);
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
    const textLayout = await collectTextLayoutDiagnostics(page, slideSelector);
    const platformFonts = await resolvePlatformFontsForPage(page, slideSelector);
    const designWarnings = await collectDesignGuidelineWarnings(browserContext, htmlAbsolutePath, slideSelector, workspaceRoot);

    textLayout.platformFonts = platformFonts;
    textLayout.portableFont = summarizePortableFont(portableFont);
    const warnings = [...state.warnings, ...slideDiagnostics.issues, ...designWarnings];
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

    await removePortableCjkFont(page);
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
      slideDiagnostics,
      slideSelector,
      slides: state.slideMeasurements,
      slideWidth: SLIDE_WIDTH_PX,
      sourceHtml: toWorkspaceRelative(htmlAbsolutePath, workspaceRoot),
      textLayout,
      warnings,
    };

    await fs.mkdir(path.dirname(outHtmlAbsolutePath), { recursive: true });
    await fs.writeFile(outHtmlAbsolutePath, preparedHtml, "utf8");
    await fs.writeFile(measurementsAbsolutePath, `${JSON.stringify(measurements, null, 2)}\n`, "utf8");
    await page.close();

    return {
      diagnostics: slideDiagnostics,
      measurementsPath: toWorkspaceRelative(measurementsAbsolutePath, workspaceRoot),
      outHtml: toWorkspaceRelative(outHtmlAbsolutePath, workspaceRoot),
      errors: slideDiagnostics.errors.length,
      rasterFallbacks: replacements.length,
      textLayoutRisks: textLayout.riskCount,
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
        const text = message.text();
        const selfFileOriginMatch = text.match(/^Unsafe attempt to load URL (file:.+?) from frame with URL (file:.+?)\. 'file:'/s);

        if (selfFileOriginMatch?.[1] === selfFileOriginMatch?.[2]) {
          return;
        }

        const location = message.location();
        const source = location.url ? ` (${location.url}:${location.lineNumber}:${location.columnNumber})` : "";

        consoleErrors.push(`${text}${source}`);
      }
    });

    const portableFont = await installPortableCjkFont(page, slideSelector);
    const fontResolution = await resolvePlatformFontsForPage(page, slideSelector, { apply: true });
    const textStabilization = await collectTextLayoutDiagnostics(page, slideSelector, { stabilize: true });
    const autoEmbedFonts = fontResolution.available && fontResolution.customFontCount > 0;
    const bundlePath = resolveDomToPptxBundlePath();

    await page.addScriptTag({ path: bundlePath });

    const bytes = await page.evaluate(
      async ({ author: deckAuthor, autoEmbedFonts: embedFonts, fonts, height, selector, title: deckTitle, width }) => {
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
          autoEmbedFonts: embedFonts,
          fileName: "deck.pptx",
          fonts,
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
        autoEmbedFonts,
        fonts: portableFont.fonts,
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
      fontResolution: {
        ...fontResolution,
        autoEmbedFonts,
      },
      html: toWorkspaceRelative(htmlAbsolutePath, workspaceRoot),
      inlined,
      outPptx: toWorkspaceRelative(outPptxAbsolutePath, workspaceRoot),
      pageErrors,
      portableFont: summarizePortableFont(portableFont),
      textStabilization,
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
    await installPortableCjkFont(page, slideSelector);
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
  let textBoxes = 0;
  let wrapNoneTextBoxes = 0;
  let wrapSquareTextBoxes = 0;
  let autoFitTextBoxes = 0;
  const typefaceCounts = new Map();
  const cjkTypefaceCounts = new Map();
  const shortWrapSquareTextBoxes = [];

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

    for (const match of xml.matchAll(/<a:(?:latin|ea|cs)\s+typeface="([^"]+)"/g)) {
      const family = match[1];

      typefaceCounts.set(family, (typefaceCounts.get(family) || 0) + 1);
    }

    for (const run of xml.matchAll(/<a:r>.*?<\/a:r>/gs)) {
      const text = Array.from(run[0].matchAll(/<a:t>(.*?)<\/a:t>/gs))
        .map((textMatch) => textMatch[1])
        .join("");

      if (!/[\u2e80-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(text)) {
        continue;
      }

      const eastAsiaTypeface = run[0].match(/<a:ea\s+typeface="([^"]+)"/)?.[1];

      if (eastAsiaTypeface) {
        cjkTypefaceCounts.set(eastAsiaTypeface, (cjkTypefaceCounts.get(eastAsiaTypeface) || 0) + 1);
      }
    }

    for (const shape of xml.matchAll(/<p:sp>.*?<\/p:sp>/gs)) {
      if (!shape[0].includes("<p:txBody>")) {
        continue;
      }

      textBoxes += 1;
      const bodyProperties = shape[0].match(/<a:bodyPr([^>]*)>/)?.[1] || "";
      const wrap = bodyProperties.match(/\bwrap="([^"]+)"/)?.[1] || "default";

      if (wrap === "none") {
        wrapNoneTextBoxes += 1;
      }

      if (wrap === "square") {
        wrapSquareTextBoxes += 1;
      }

      if (shape[0].includes("<a:spAutoFit/>")) {
        autoFitTextBoxes += 1;
      }

      const text = Array.from(shape[0].matchAll(/<a:t>(.*?)<\/a:t>/gs))
        .map((textMatch) => textMatch[1])
        .join("")
        .replace(/\s+/g, " ")
        .trim();

      if (wrap === "square" && text && text.length <= 40) {
        const widthEmu = Number(shape[0].match(/<a:ext cx="(\d+)" cy="\d+"/)?.[1] || 0);

        shortWrapSquareTextBoxes.push({
          slide: Number(slideFile.match(/slide(\d+)\.xml$/)?.[1] || 0),
          text: text.slice(0, 120),
          widthPx: Math.round((widthEmu / (EMU_PER_INCH / CSS_PX_PER_INCH)) * 1000) / 1000,
        });
      }
    }
  }

  const presentationXml = await zip.file("ppt/presentation.xml")?.async("string");
  const slideSizeMatch = presentationXml?.match(/<p:sldSz\s+cx="(\d+)"\s+cy="(\d+)"/);
  const slideSize = slideSizeMatch
    ? {
        cx: Number(slideSizeMatch[1]),
        cy: Number(slideSizeMatch[2]),
        expectedCx: Math.round(SLIDE_WIDTH_IN * EMU_PER_INCH),
        expectedCy: Math.round(SLIDE_HEIGHT_IN * EMU_PER_INCH),
      }
    : undefined;
  const fontFiles = Object.keys(zip.files).filter((fileName) => /^ppt\/fonts\/.+/.test(fileName) && !zip.files[fileName]?.dir);
  const toCountList = (counts) =>
    Array.from(counts, ([family, count]) => ({ count, family })).sort((left, right) => right.count - left.count);

  return {
    autoFitTextBoxes,
    cjkTypefaces: toCountList(cjkTypefaceCounts),
    embeddedFonts: {
      files: fontFiles.length,
      listed: Boolean(presentationXml?.includes("<p:embeddedFontLst")),
    },
    mediaBytes,
    mediaFiles: mediaFiles.length,
    pictureCount,
    shortWrapSquareTextBoxes,
    slideSize,
    slideFiles: slideFiles.length,
    textBoxes,
    textRuns,
    typefaces: toCountList(typefaceCounts),
    wrapNoneTextBoxes,
    wrapSquareTextBoxes,
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
  const pptxPngs = pptxPreview.files.filter((filePath) => /(?:^|\/)slide-\d+\.png$/.test(filePath));

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
  let slideDiagnostics;

  try {
    if (!measurements) {
      measurements = await collectHtmlMeasurements(browserContext, htmlAbsolutePath, slideSelector, workspaceRoot, preparedHtmlAbsolutePath);
    } else if (!measurements.textLayout) {
      const page = await openSlideHtml(browserContext, htmlAbsolutePath);

      try {
        const portableFont = await installPortableCjkFont(page, slideSelector);
        const textLayout = await collectTextLayoutDiagnostics(page, slideSelector);

        textLayout.platformFonts = await resolvePlatformFontsForPage(page, slideSelector);
        textLayout.portableFont = summarizePortableFont(portableFont);
        measurements.textLayout = textLayout;
      } finally {
        await page.close();
      }
    }

    const diagnosticsPage = await openSlideHtml(browserContext, htmlAbsolutePath);

    try {
      slideDiagnostics = await collectSlideDiagnostics(diagnosticsPage, slideSelector);
    } finally {
      await diagnosticsPage.close();
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

  const measurementWarnings = (measurements?.warnings ?? []).filter(
    (warning) => warning.category !== "slide-diagnostic",
  );
  const warnings = [
    ...measurementWarnings,
    ...(slideDiagnostics?.issues ?? []),
    ...pptxPreview.warnings,
    ...visualSmoke.warnings,
  ];
  const portableFont = measurements.textLayout?.portableFont;

  if (portableFont?.available === false) {
    warnings.push({
      message: `可移植 CJK 字体加载失败：${portableFont.error || "unknown error"}`,
      type: "portable-cjk-font-unavailable",
    });
  }

  const expectedSlideCx = Math.round(SLIDE_WIDTH_IN * EMU_PER_INCH);
  const expectedSlideCy = Math.round(SLIDE_HEIGHT_IN * EMU_PER_INCH);
  const actualSlideSize = pptxInspection.slideSize;

  if (!actualSlideSize || actualSlideSize.cx !== expectedSlideCx || actualSlideSize.cy !== expectedSlideCy) {
    warnings.push({
      message: `PPTX 画布尺寸为 ${actualSlideSize?.cx ?? "unknown"}x${actualSlideSize?.cy ?? "unknown"} EMU，预期为 ${expectedSlideCx}x${expectedSlideCy} EMU。`,
      type: "pptx-slide-size-mismatch",
    });
  }

  const sourceTextRisks = Number(measurements.textLayout?.riskCount || 0);
  const minimumExpectedNoWrap = sourceTextRisks ? Math.max(1, Math.ceil(sourceTextRisks * 0.8)) : 0;

  if (minimumExpectedNoWrap && pptxInspection.wrapNoneTextBoxes < minimumExpectedNoWrap) {
    warnings.push({
      message: `检测到 ${sourceTextRisks} 个单行文本稳定化候选，但 PPTX 仅有 ${pptxInspection.wrapNoneTextBoxes} 个禁止自动换行文本框。`,
      type: "text-wrap-stabilization-missing",
    });
  }

  const expectedCjkFamilies = measurements.textLayout?.platformFonts?.cjkFamilies || [];
  const actualCjkFamilies = new Set(pptxInspection.cjkTypefaces.map((entry) => entry.family.toLowerCase()));
  const missingCjkFamilies = expectedCjkFamilies.filter((family) => !actualCjkFamilies.has(family.toLowerCase()));

  if (missingCjkFamilies.length) {
    warnings.push({
      message: `PPTX 东亚字体没有保留 Chromium 实际字体：${missingCjkFamilies.join(", ")}。`,
      type: "pptx-font-mapping-drift",
    });
  }

  if (
    Number(measurements.textLayout?.platformFonts?.customFontCount || 0) > 0 &&
    !pptxInspection.embeddedFonts.listed &&
    pptxInspection.embeddedFonts.files === 0
  ) {
    warnings.push({
      message: "HTML 使用了自定义 Web 字体，但 PPTX 中未检测到嵌入字体。",
      type: "pptx-font-embedding-missing",
    });
  }

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
    schema: "ranni.html-to-pptx.qa.v2",
    slideDiagnostics,
    slideHeight: SLIDE_HEIGHT_PX,
    slideSelector,
    slides: measurements.slides.length,
    slideWidth: SLIDE_WIDTH_PX,
    sourceHtml: toWorkspaceRelative(htmlAbsolutePath, workspaceRoot),
    textLayout: {
      output: {
        cjkTypefaces: pptxInspection.cjkTypefaces,
        shortWrapSquareTextBoxes: pptxInspection.shortWrapSquareTextBoxes,
        wrapNoneTextBoxes: pptxInspection.wrapNoneTextBoxes,
        wrapSquareTextBoxes: pptxInspection.wrapSquareTextBoxes,
      },
      source: measurements.textLayout,
      status: warnings.some((warning) =>
        [
          "portable-cjk-font-unavailable",
          "pptx-font-embedding-missing",
          "pptx-font-mapping-drift",
          "text-wrap-stabilization-missing",
        ].includes(warning.type),
      )
        ? "warning"
        : "passed",
    },
    visualSmoke,
    warnings,
  };

  await fs.mkdir(path.dirname(qaReportAbsolutePath), { recursive: true });
  await fs.writeFile(qaReportAbsolutePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return {
    diagnostics: slideDiagnostics,
    editableElements: report.editableElements,
    errors: slideDiagnostics?.errors.length ?? 0,
    qaReport: toWorkspaceRelative(qaReportAbsolutePath, workspaceRoot),
    rasterFallbacks: report.rasterFallbacks,
    slides: report.slides,
    warnings: warnings.length,
  };
}
