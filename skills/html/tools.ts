import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright";
import { z } from "zod";

import {
  findHtmlDesignStyle,
  findHtmlPageTemplate,
  getDefaultHtmlDesignStyleId,
  getDefaultHtmlPageTemplateId,
} from "../../lib/html-design/catalog";
import type { ToolDefinition, ToolExecutionContext } from "../../lib/tools";
import {
  getWorkspaceRoot,
  resolveWorkspacePath,
  toWorkspaceRelative,
} from "../../lib/workspace";

const initHtmlWorkspaceSchema = z.object({
  dir: z.string().min(1).optional(),
  overwrite: z.boolean().default(false),
  prompt: z.string().min(1).optional(),
  siteSlug: z.string().min(1),
  styleId: z.string().min(1).optional(),
  templateId: z.string().min(1).optional(),
  title: z.string().min(1).default("Static HTML page"),
});

const validateStaticHtmlSchema = z.object({
  html: z.string().min(1),
  previewDir: z.string().min(1).optional(),
  qaReportPath: z.string().min(1).optional(),
});

function sanitizePathSegment(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "site"
  );
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function summarizePrompt(value: string | undefined, fallback: string) {
  const normalized = (value?.trim() || fallback).replace(/\s+/g, " ");

  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeFileIfAllowed(
  filePath: string,
  content: string,
  overwrite: boolean,
) {
  if (!overwrite && (await fileExists(filePath))) {
    return false;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);

  return true;
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

function resolveDesignSelection(
  args: { styleId?: string; templateId?: string },
  context: ToolExecutionContext,
) {
  const styleId =
    args.styleId?.trim() ||
    context.toolSettings?.htmlDesign?.styleId?.trim() ||
    getDefaultHtmlDesignStyleId();
  const templateId =
    args.templateId?.trim() ||
    context.toolSettings?.htmlDesign?.templateId?.trim() ||
    getDefaultHtmlPageTemplateId();
  const style = findHtmlDesignStyle(styleId);
  const template = findHtmlPageTemplate(templateId);

  if (!style) {
    throw new Error(`未找到 HTML 设计风格：${styleId}`);
  }

  if (!template) {
    throw new Error(`未找到 HTML 网页类型模板：${templateId}`);
  }

  return {
    style,
    template,
  };
}

function createInitialHtml({
  prompt,
  styleId,
  templateId,
  title,
}: {
  prompt?: string;
  styleId: string;
  templateId: string;
  title: string;
}) {
  const safeTitle = escapeHtml(title);
  const safePrompt = escapeHtml(
    summarizePrompt(prompt, "根据选中的网页类型和设计风格继续完善内容。"),
  );

  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${safeTitle}</title>`,
    '  <link rel="stylesheet" href="./styles.css" />',
    "</head>",
    `<body data-ranni-html-template-id="${templateId}" data-ranni-design-style-id="${styleId}">`,
    '  <main class="site-shell">',
    '    <section class="hero" aria-labelledby="page-title">',
    '      <p class="eyebrow">Ranni HTML</p>',
    `      <h1 id="page-title">${safeTitle}</h1>`,
    `      <p class="lead">${safePrompt}</p>`,
    '      <div class="actions">',
    '        <a class="button button-primary" href="#content">查看内容</a>',
    '        <a class="button button-secondary" href="mailto:hello@example.com">联系我</a>',
    "      </div>",
    "    </section>",
    '    <section id="content" class="content-grid" aria-label="页面内容">',
    '      <article class="panel panel-large">',
    "        <h2>核心信息</h2>",
    "        <p>在这里补充面向用户的价值主张、证据和关键行动路径。</p>",
    "      </article>",
    '      <article class="panel">',
    "        <h2>亮点一</h2>",
    "        <p>用简短文案说明最重要的收益。</p>",
    "      </article>",
    '      <article class="panel">',
    "        <h2>亮点二</h2>",
    "        <p>补充场景、流程或可信证据。</p>",
    "      </article>",
    "    </section>",
    "  </main>",
    "</body>",
    "</html>",
  ].join("\n");
}

function createInitialCss({
  accentColor,
  surfaceColor,
}: {
  accentColor: string;
  surfaceColor: string;
}) {
  return [
    ":root {",
    `  --accent: ${accentColor};`,
    `  --surface: ${surfaceColor};`,
    "  --text: #101827;",
    "  --muted: #5b6475;",
    "  --line: rgba(15, 23, 42, 0.12);",
    "  --panel: rgba(255, 255, 255, 0.86);",
    "}",
    "",
    "*, *::before, *::after { box-sizing: border-box; }",
    "html { scroll-behavior: smooth; }",
    "body {",
    "  margin: 0;",
    "  min-width: 320px;",
    "  background: var(--surface);",
    "  color: var(--text);",
    "  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;",
    "}",
    "a { color: inherit; }",
    ".site-shell { width: min(1120px, calc(100% - 40px)); margin: 0 auto; }",
    ".hero { padding: 96px 0 64px; }",
    ".eyebrow { margin: 0 0 18px; color: var(--accent); font-size: 14px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; }",
    "h1 { max-width: 840px; margin: 0; font-size: clamp(44px, 7vw, 88px); line-height: 0.96; letter-spacing: 0; }",
    ".lead { max-width: 680px; margin: 28px 0 0; color: var(--muted); font-size: 20px; line-height: 1.65; }",
    ".actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 34px; }",
    ".button { display: inline-flex; min-height: 44px; align-items: center; justify-content: center; border: 1px solid var(--line); border-radius: 8px; padding: 0 18px; font-weight: 750; text-decoration: none; }",
    ".button-primary { background: var(--accent); border-color: var(--accent); color: white; }",
    ".button-secondary { background: rgba(255, 255, 255, 0.65); }",
    ".content-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; padding: 0 0 96px; }",
    ".panel { min-height: 220px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); padding: 24px; }",
    ".panel-large { grid-column: span 2; }",
    ".panel h2 { margin: 0 0 12px; font-size: 24px; line-height: 1.2; }",
    ".panel p { margin: 0; color: var(--muted); font-size: 16px; line-height: 1.65; }",
    "@media (max-width: 760px) {",
    "  .site-shell { width: min(100% - 28px, 1120px); }",
    "  .hero { padding: 64px 0 40px; }",
    "  .lead { font-size: 18px; }",
    "  .content-grid { grid-template-columns: 1fr; padding-bottom: 64px; }",
    "  .panel-large { grid-column: auto; }",
    "}",
  ].join("\n");
}

async function initHtmlWorkspace(
  rawArgs: unknown,
  context: ToolExecutionContext,
) {
  const args = initHtmlWorkspaceSchema.parse(rawArgs);
  const workspaceRoot = getWorkspaceRoot(context.workspaceRoot);
  const siteSlug = sanitizePathSegment(args.siteSlug);
  const baseRelativePath = args.dir ?? siteSlug;
  const baseAbsolutePath = resolveWorkspacePath(baseRelativePath, workspaceRoot);
  const { style, template } = resolveDesignSelection(args, context);
  const htmlPath = path.join(baseAbsolutePath, "index.html");
  const cssPath = path.join(baseAbsolutePath, "styles.css");
  const qaReportPath = path.join(baseAbsolutePath, "qa-report.json");
  const writtenFiles: string[] = [];
  const skippedFiles: string[] = [];
  const trackWrite = async (filePath: string, content: string) => {
    const didWrite = await writeFileIfAllowed(filePath, content, args.overwrite);
    const target = didWrite ? writtenFiles : skippedFiles;

    target.push(toWorkspaceRelative(filePath, workspaceRoot));
  };

  await fs.mkdir(path.join(baseAbsolutePath, "assets"), { recursive: true });
  await fs.mkdir(path.join(baseAbsolutePath, "preview"), { recursive: true });
  await trackWrite(
    htmlPath,
    createInitialHtml({
      prompt: args.prompt,
      styleId: style.id,
      templateId: template.id,
      title: args.title,
    }),
  );
  await trackWrite(
    cssPath,
    createInitialCss({
      accentColor: style.accentColor,
      surfaceColor: style.surfaceColor,
    }),
  );

  if (args.prompt) {
    await trackWrite(path.join(baseAbsolutePath, "prompt.txt"), `${args.prompt}\n`);
  }

  await trackWrite(
    path.join(baseAbsolutePath, "html-generation-report.json"),
    `${JSON.stringify(
      {
        prompt: args.prompt ?? "",
        route: "static-html",
        siteSlug,
        styleId: style.id,
        styleName: style.name,
        templateId: template.id,
        templateName: template.name,
        title: args.title,
      },
      null,
      2,
    )}\n`,
  );

  return [
    "已初始化 static HTML workspace。",
    `目录：${toWorkspaceRelative(baseAbsolutePath, workspaceRoot)}`,
    `HTML：${toWorkspaceRelative(htmlPath, workspaceRoot)}`,
    `CSS：${toWorkspaceRelative(cssPath, workspaceRoot)}`,
    `QA：${toWorkspaceRelative(qaReportPath, workspaceRoot)}`,
    `设计风格：${style.name} (${style.id})`,
    `网页类型：${template.name} (${template.id})`,
    writtenFiles.length ? `写入：${writtenFiles.join(", ")}` : "写入：无",
    skippedFiles.length
      ? `跳过已有文件：${skippedFiles.join(", ")}`
      : "跳过已有文件：无",
  ].join("\n");
}

async function validateStaticHtml(
  rawArgs: unknown,
  context: ToolExecutionContext,
) {
  const args = validateStaticHtmlSchema.parse(rawArgs);
  const workspaceRoot = getWorkspaceRoot(context.workspaceRoot);
  const htmlAbsolutePath = resolveWorkspacePath(args.html, workspaceRoot);
  const htmlDirectory = path.dirname(htmlAbsolutePath);
  const previewDirectory = resolveDefaultWorkspaceOutput(
    path.join(htmlDirectory, "preview"),
    args.previewDir,
    workspaceRoot,
  );
  const qaReportPath = resolveDefaultWorkspaceOutput(
    path.join(htmlDirectory, "qa-report.json"),
    args.qaReportPath,
    workspaceRoot,
  );
  const browser = await chromium.launch();
  const warnings: Array<{ message: string; type: string; viewport?: string }> = [];
  const previews: string[] = [];
  const viewportResults = [];

  await fs.mkdir(previewDirectory, { recursive: true });

  try {
    for (const viewport of [
      { height: 1000, name: "desktop", width: 1440 },
      { height: 844, name: "mobile", width: 390 },
    ]) {
      const page = await browser.newPage({
        viewport: { height: viewport.height, width: viewport.width },
      });

      await page.goto(pathToFileURL(htmlAbsolutePath).href, {
        waitUntil: "networkidle",
      });

      const screenshotPath = path.join(previewDirectory, `${viewport.name}.png`);

      await page.screenshot({ fullPage: true, path: screenshotPath });
      previews.push(toWorkspaceRelative(screenshotPath, workspaceRoot));

      const result = await page.evaluate(() => {
        const body = document.body;
        const scrollingElement = document.scrollingElement ?? document.documentElement;
        const imagesWithoutAlt = Array.from(document.images).filter(
          (image) => !image.hasAttribute("alt"),
        ).length;
        const linksWithoutText = Array.from(document.querySelectorAll("a")).filter(
          (link) => !link.textContent?.trim() && !link.getAttribute("aria-label"),
        ).length;
        const headings = Array.from(
          document.querySelectorAll("h1, h2, h3, h4, h5, h6"),
        ).map((heading) => heading.tagName.toLowerCase());

        return {
          bodyTextLength: body.innerText.trim().length,
          headings,
          horizontalOverflow:
            scrollingElement.scrollWidth > window.innerWidth + 2,
          imagesWithoutAlt,
          lang: document.documentElement.lang,
          linksWithoutText,
          title: document.title.trim(),
        };
      });

      if (!result.title) {
        warnings.push({
          message: "页面缺少 title。",
          type: "missing-title",
          viewport: viewport.name,
        });
      }

      if (!result.lang) {
        warnings.push({
          message: "html 元素缺少 lang。",
          type: "missing-lang",
          viewport: viewport.name,
        });
      }

      if (result.bodyTextLength < 120) {
        warnings.push({
          message: "正文文本量偏少，可能还没有完成内容创作。",
          type: "low-text-volume",
          viewport: viewport.name,
        });
      }

      if (result.imagesWithoutAlt > 0) {
        warnings.push({
          message: `存在 ${result.imagesWithoutAlt} 个图片缺少 alt。`,
          type: "image-alt-missing",
          viewport: viewport.name,
        });
      }

      if (result.linksWithoutText > 0) {
        warnings.push({
          message: `存在 ${result.linksWithoutText} 个链接缺少文本或 aria-label。`,
          type: "link-text-missing",
          viewport: viewport.name,
        });
      }

      if (result.horizontalOverflow) {
        warnings.push({
          message: "页面存在水平溢出。",
          type: "horizontal-overflow",
          viewport: viewport.name,
        });
      }

      viewportResults.push({
        ...result,
        screenshot: toWorkspaceRelative(screenshotPath, workspaceRoot),
        viewport,
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }

  await fs.writeFile(
    qaReportPath,
    `${JSON.stringify(
      {
        html: toWorkspaceRelative(htmlAbsolutePath, workspaceRoot),
        previews,
        schema: "ranni.static-html.qa.v1",
        viewports: viewportResults,
        warnings,
      },
      null,
      2,
    )}\n`,
  );

  return [
    "已验证 static HTML 产物。",
    `QA：${toWorkspaceRelative(qaReportPath, workspaceRoot)}`,
    `预览：${previews.join(", ")}`,
    `warning：${warnings.length}`,
  ].join("\n");
}

export const tools: ToolDefinition[] = [
  {
    schema: initHtmlWorkspaceSchema,
    tool: {
      name: "init_html_workspace",
      description:
        "Initialize a static HTML webpage workspace inside the session workspace. Creates index.html, styles.css, assets/, preview/, qa-report.json target, and generation metadata using selected design style and page template.",
      input_schema: {
        type: "object",
        properties: {
          dir: {
            type: "string",
            description:
              "Optional workspace-relative directory. Defaults to siteSlug.",
          },
          overwrite: {
            type: "boolean",
            default: false,
            description: "Overwrite existing index.html and styles.css.",
          },
          prompt: {
            type: "string",
            description: "Original user prompt to preserve.",
          },
          siteSlug: {
            type: "string",
            description: "Static site slug used for the directory.",
          },
          styleId: {
            type: "string",
            description:
              "Optional HTML design style id. Defaults to selected run style.",
          },
          templateId: {
            type: "string",
            description:
              "Optional HTML page template id. Defaults to selected run page type.",
          },
          title: {
            type: "string",
            default: "Static HTML page",
          },
        },
        required: ["siteSlug"],
      },
    },
    execute: initHtmlWorkspace,
  },
  {
    schema: validateStaticHtmlSchema,
    tool: {
      name: "validate_static_html",
      description:
        "Render a static HTML page with Playwright at desktop and mobile viewports, save preview screenshots, and write a QA report for title, lang, text volume, image alt, link text, and horizontal overflow.",
      input_schema: {
        type: "object",
        properties: {
          html: {
            type: "string",
            description: "Workspace-relative index.html path.",
          },
          previewDir: {
            type: "string",
            description:
              "Workspace-relative preview directory. Defaults to sibling preview/.",
          },
          qaReportPath: {
            type: "string",
            description:
              "Workspace-relative QA report path. Defaults to sibling qa-report.json.",
          },
        },
        required: ["html"],
      },
    },
    execute: validateStaticHtml,
  },
];
