// HTML-to-PPTX spike 共享工具：路径、浏览器启动、dom-to-pptx bundle 解析、依赖探测。
// 这些脚本由 skills/slides/tools.ts 以子进程方式启动，cwd 为 session workspace。
// 路径安全由 tools.ts 的 resolveWorkspacePath 守护；脚本只接收绝对路径并落盘。

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { chromium } from "playwright";

// 受限 slide HTML 规范的固定画布尺寸（CSS 像素，16:9）。
export const SLIDE_W = 1280;
export const SLIDE_H = 720;

const requireFromLib = createRequire(import.meta.url);
const fsSync = requireFromLib("node:fs");

export async function ensureDir(target) {
  await fs.mkdir(target, { recursive: true });
  return target;
}

export async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

// 启动浏览器：优先用 Playwright 自带 chromium；失败时回退系统 Chrome（channel:'chrome'）。
// 这样即使 chromium 浏览器二进制没下载，只要机器装了 Chrome 就能继续。
export async function launchBrowser() {
  const errors = [];
  try {
    return await chromium.launch();
  } catch (error) {
    errors.push(`chromium: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return await chromium.launch({ channel: "chrome" });
  } catch (error) {
    errors.push(`chrome: ${error instanceof Error ? error.message : String(error)}`);
  }
  throw new Error(
    `无法启动浏览器（已尝试 Playwright chromium 与系统 Chrome）：${errors.join(" | ")}`,
  );
}

export function newSlidePage(browser, deviceScaleFactor = 2) {
  return browser.newPage({
    viewport: { width: SLIDE_W, height: SLIDE_H },
    deviceScaleFactor,
  });
}

const MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

// 把本地图片引用解析成绝对路径；不可识别（data:/http:/blob:）返回 null。
export function resolveLocalImageSrc(src, deckDir) {
  if (!src) {
    return null;
  }
  if (src.startsWith("data:") || /^(https?:|blob:)/i.test(src)) {
    return null;
  }
  let target = src;
  if (target.startsWith("file://")) {
    try {
      target = fileURLToPath(target);
    } catch {
      return null;
    }
  }
  return path.isAbsolute(target) ? target : path.resolve(deckDir, target);
}

// 读取本地图片并编码成 data URI。dom-to-pptx 在 file:// 页面里读不到 file:// 图片
// （canvas 防 CORS），把图片内联成 data URI 可彻底规避该问题，并让 prepared.html 自包含。
export async function encodeDataUri(absPath) {
  let bytes;
  try {
    bytes = await fs.readFile(absPath);
  } catch {
    return null;
  }
  const ext = path.extname(absPath).toLowerCase();
  const mime = MIME_BY_EXT[ext] || "application/octet-stream";
  if (mime === "image/svg+xml") {
    return `data:${mime};charset=utf8,${encodeURIComponent(bytes.toString("utf8"))}`;
  }
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

// 解析 dom-to-pptx 浏览器 bundle 的绝对路径（用于 addScriptTag 注入页面）。
// 注意：dom-to-pptx 的 exports 字段屏蔽了 ./package.json，不能直接 resolve
// "dom-to-pptx/package.json"；改为 resolve 主入口后向上查找 name 匹配的包根目录。
export function resolveDomToPptxBundle() {
  let resolvedMain;
  try {
    resolvedMain = requireFromLib.resolve("dom-to-pptx");
  } catch {
    throw new Error("找不到 dom-to-pptx 包。请先执行 `npm install dom-to-pptx`。");
  }
  const pkgDir = findPackageRoot(resolvedMain, "dom-to-pptx");
  if (!pkgDir) {
    throw new Error(
      `已解析 dom-to-pptx 主入口 ${resolvedMain}，但未能定位包根目录。`,
    );
  }
  const candidates = [
    path.join(pkgDir, "dist", "dom-to-pptx.bundle.js"),
    path.join(pkgDir, "dist", "dom-to-pptx.mjs"),
    path.join(pkgDir, "dom-to-pptx.bundle.js"),
  ];
  for (const candidate of candidates) {
    if (fsSync.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `在 ${pkgDir} 下找不到 dom-to-pptx 浏览器 bundle（已尝试 dist/dom-to-pptx.bundle.js 等）。`,
  );
}

// 从某个文件路径向上查找 name 匹配的包根目录（读取 package.json，规避 exports 限制）。
function findPackageRoot(startFile, expectedName) {
  let dir = path.dirname(startFile);
  while (true) {
    const manifest = path.join(dir, "package.json");
    if (fsSync.existsSync(manifest)) {
      try {
        const pkg = JSON.parse(fsSync.readFileSync(manifest, "utf8"));
        if (pkg.name === expectedName) {
          return dir;
        }
      } catch {
        /* 忽略损坏的 package.json，继续向上 */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

// 尝试加载 jszip（pptxgenjs 的间接依赖，可能被提升到顶层 node_modules）。
// 用于在 validate 阶段读取 pptx 的 slide 数量；不可用则返回 null，校验降级。
export function tryLoadJszip() {
  try {
    return requireFromLib("jszip");
  } catch {
    return null;
  }
}

// 尝试加载 pixelmatch + pngjs（用于 preview-html 与 preview-pptx 的像素差异检测）。
// pixelmatch v7 是 ESM，require 返回 { default: fn }，需取 default；不可用则返回 null。
export function tryLoadPixelmatch() {
  try {
    const { PNG } = requireFromLib("pngjs");
    const raw = requireFromLib("pixelmatch");
    const pixelmatch = typeof raw === "function" ? raw : raw.default;
    if (typeof pixelmatch !== "function") {
      return null;
    }
    return { PNG, pixelmatch };
  } catch {
    return null;
  }
}

// 找一个可用的 pdftoppm（poppler）可执行路径，用于把 LibreOffice 生成的 pdf 拆成逐页 png。
export function findPdftoppm() {
  const candidates = [
    "/opt/homebrew/bin/pdftoppm",
    "/usr/local/bin/pdftoppm",
    "/usr/bin/pdftoppm",
  ];
  for (const candidate of candidates) {
    if (fsSync.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

// 探测 LibreOffice 可执行文件（用于 pptx→png 预览）。
export async function findLibreOffice() {
  const candidates = [
    "/opt/homebrew/bin/soffice",
    "/opt/homebrew/bin/libreoffice",
    "/usr/local/bin/soffice",
    "/usr/local/bin/libreoffice",
    "/usr/bin/soffice",
    "/usr/bin/libreoffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  ];
  for (const candidate of candidates) {
    if (fsSync.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}
