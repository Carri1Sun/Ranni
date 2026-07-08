import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { ToolDefinition, ToolExecutionContext } from "../../lib/tools";
import {
  findSlidesTemplate,
  getDefaultSlidesTemplateId,
  getSlidesTemplateDirectory,
} from "../../lib/slides/templates";
import {
  getWorkspaceRoot,
  resolveWorkspacePath,
  toWorkspaceRelative,
} from "../../lib/workspace";

const initSlideHtmlWorkspaceSchema = z.object({
  deckSlug: z.string().min(1),
  dir: z.string().min(1).optional(),
  overwrite: z.boolean().default(false),
  prompt: z.string().min(1).optional(),
  template: z.enum(["blank", "spike-sample"]).default("blank"),
  templateId: z.string().min(1).optional(),
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

function sanitizePathSegment(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "deck"
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

  return normalized.length > 68 ? `${normalized.slice(0, 65)}...` : normalized;
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

async function writeFileIfAllowed(
  filePath: string,
  content: Buffer | string,
  overwrite: boolean,
) {
  if (!overwrite && (await fileExists(filePath))) {
    return false;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);

  return true;
}

function createBlankSlideHtmlTemplate(title: string, prompt?: string) {
  const safeTitle = escapeHtml(title);
  const safePrompt = escapeHtml(
    summarizePrompt(prompt, "在这里放置受限 slide HTML 内容。"),
  );

  return {
    css: [
      "html, body { margin: 0; padding: 0; background: #eef2f7; overflow: hidden; }",
      "body { font-family: Inter, Arial, 'PingFang SC', sans-serif; color: #172033; }",
      "*, *::before, *::after { box-sizing: border-box; }",
      ".deck { width: 1280px; }",
      ".slide { position: relative; width: 1280px; height: 720px; overflow: hidden; background: #ffffff; padding: 80px 92px 0; }",
      ".slide-title { position: relative; z-index: 10; width: 920px; margin: 0 0 34px; color: #172033; font-size: 64px; line-height: 1.08; letter-spacing: 0; }",
      ".slide-copy { position: relative; z-index: 10; width: 720px; margin: 0; color: #41516a; font-size: 20px; line-height: 1.55; }",
    ].join("\n"),
    html: [
      "<!doctype html>",
      '<html lang="zh-CN">',
      "<head>",
      '  <meta charset="utf-8" />',
      '  <meta name="viewport" content="width=1280, initial-scale=1" />',
      `  <title>${safeTitle}</title>`,
      '  <link rel="stylesheet" href="./styles.css" />',
      "</head>",
      "<body>",
      '  <main class="deck" data-pptx-deck>',
      '    <section class="slide" data-slide-id="cover">',
      `      <h1 class="slide-title" data-pptx-editable>${safeTitle}</h1>`,
      `      <p class="slide-copy" data-pptx-editable>${safePrompt}</p>`,
      "    </section>",
      "  </main>",
      "</body>",
      "</html>",
    ].join("\n"),
  };
}

function resolveSkillPath(...segments: string[]) {
  const sourceCandidate = path.resolve(process.cwd(), "skills", "slides", ...segments);
  const localCandidate = path.resolve(__dirname, ...segments);

  return fileExists(sourceCandidate).then((exists) =>
    exists ? sourceCandidate : localCandidate,
  );
}

type CopyResult = {
  skippedFiles: string[];
  writtenFiles: string[];
};

async function copyTemplateDirectory(
  fromDirectory: string,
  toDirectory: string,
  workspaceRoot: string,
  overwrite: boolean,
  replacements: Record<string, string>,
): Promise<CopyResult> {
  const writtenFiles: string[] = [];
  const skippedFiles: string[] = [];
  const entries = await fs.readdir(fromDirectory, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(fromDirectory, entry.name);
    const targetPath = path.join(toDirectory, entry.name);

    if (entry.isDirectory()) {
      const nested = await copyTemplateDirectory(
        sourcePath,
        targetPath,
        workspaceRoot,
        overwrite,
        replacements,
      );

      writtenFiles.push(...nested.writtenFiles);
      skippedFiles.push(...nested.skippedFiles);
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    const isTextFile = [".css", ".html", ".js", ".json", ".md", ".svg", ".txt"].includes(extension);
    const sourceContent = await fs.readFile(sourcePath);
    const content = isTextFile
      ? Object.entries(replacements).reduce(
          (current, [token, value]) => current.replaceAll(token, value),
          sourceContent.toString("utf8"),
        )
      : sourceContent;
    const didWrite = await writeFileIfAllowed(targetPath, content, overwrite);

    if (didWrite) {
      writtenFiles.push(toWorkspaceRelative(targetPath, workspaceRoot));
    } else {
      skippedFiles.push(toWorkspaceRelative(targetPath, workspaceRoot));
    }
  }

  return { skippedFiles, writtenFiles };
}

async function writeBlankTemplate(
  baseAbsolutePath: string,
  workspaceRoot: string,
  overwrite: boolean,
  title: string,
  prompt: string | undefined,
): Promise<CopyResult> {
  const template = createBlankSlideHtmlTemplate(title, prompt);
  const targets = [
    {
      content: template.html,
      path: path.join(baseAbsolutePath, "deck.html"),
    },
    {
      content: template.css,
      path: path.join(baseAbsolutePath, "styles.css"),
    },
  ];
  const writtenFiles: string[] = [];
  const skippedFiles: string[] = [];

  for (const target of targets) {
    const didWrite = await writeFileIfAllowed(target.path, target.content, overwrite);

    if (didWrite) {
      writtenFiles.push(toWorkspaceRelative(target.path, workspaceRoot));
    } else {
      skippedFiles.push(toWorkspaceRelative(target.path, workspaceRoot));
    }
  }

  return { skippedFiles, writtenFiles };
}

async function runHtmlPptxScript(
  scriptName: "export" | "prepare" | "validate",
  input: Record<string, unknown>,
  workspaceRoot: string,
  signal: AbortSignal | undefined,
) {
  const scriptPath = await resolveSkillPath("scripts", "html-pptx", `${scriptName}.mjs`);

  if (!(await fileExists(scriptPath))) {
    throw new Error(`未找到 HTML-to-PPTX 脚本：${scriptPath}`);
  }

  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: workspaceRoot,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`HTML-to-PPTX 脚本超时：${scriptName}`));
    }, 300000);
    const abortHandler = () => {
      child.kill("SIGTERM");
      reject(new Error(`HTML-to-PPTX 脚本已取消：${scriptName}`));
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

      if (code !== 0) {
        reject(
          new Error(
            [
              `HTML-to-PPTX 脚本失败：${scriptName}`,
              stderr.trim(),
              stdout.trim(),
            ]
              .filter(Boolean)
              .join("\n"),
          ),
        );
        return;
      }

      const jsonLine = stdout
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .at(-1);

      if (!jsonLine) {
        reject(new Error(`HTML-to-PPTX 脚本没有返回 JSON：${scriptName}`));
        return;
      }

      try {
        resolve(JSON.parse(jsonLine) as Record<string, unknown>);
      } catch (error) {
        reject(
          new Error(
            `HTML-to-PPTX 脚本返回 JSON 解析失败：${scriptName}\n${jsonLine}\n${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    });
    child.stdin.end(`${JSON.stringify(input)}\n`);
  });
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
  const selectedTemplateId =
    args.templateId?.trim() || context.toolSettings?.slides?.templateId?.trim();
  const templateId =
    selectedTemplateId ||
    (args.template === "spike-sample" ? getDefaultSlidesTemplateId() : "");
  const selectedTemplate = templateId ? findSlidesTemplate(templateId) : undefined;

  if (templateId && !selectedTemplate) {
    throw new Error(`未找到 slides 模板：${templateId}`);
  }

  const safeTitle = escapeHtml(args.title);
  const safePrompt = escapeHtml(
    summarizePrompt(
      args.prompt,
      "验证受限 slide HTML、dom-to-pptx 和局部截图回退的组合边界。",
    ),
  );
  const templateResult =
    selectedTemplate
      ? await copyTemplateDirectory(
          getSlidesTemplateDirectory(selectedTemplate.id),
          baseAbsolutePath,
          workspaceRoot,
          args.overwrite,
          {
            "{{PROMPT}}": safePrompt,
            "{{TEMPLATE_ID}}": selectedTemplate.id,
            "{{TEMPLATE_NAME}}": escapeHtml(selectedTemplate.name),
            "{{TITLE}}": safeTitle,
          },
        )
      : await writeBlankTemplate(
          baseAbsolutePath,
          workspaceRoot,
          args.overwrite,
          args.title,
          args.prompt,
        );
  const writtenFiles = [...templateResult.writtenFiles];
  const skippedFiles = [...templateResult.skippedFiles];
  const trackWrite = async (filePath: string, content: string) => {
    const didWrite = await writeFileIfAllowed(filePath, content, args.overwrite);
    const target = didWrite ? writtenFiles : skippedFiles;

    target.push(toWorkspaceRelative(filePath, workspaceRoot));
  };

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
          templateId: selectedTemplate?.id ?? "blank",
          templateName: selectedTemplate?.name ?? "Blank",
          templateVersion: selectedTemplate?.version ?? "local",
          title: args.title,
        },
        null,
        2,
      )}\n`,
    );
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
    `模板：${selectedTemplate ? `${selectedTemplate.name} (${selectedTemplate.id})` : "Blank"}`,
    writtenFiles.length ? `写入：${writtenFiles.join(", ")}` : "写入：无",
    skippedFiles.length
      ? `跳过已有文件：${skippedFiles.join(", ")}`
      : "跳过已有文件：无",
  ].join("\n");
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
  const result = await runHtmlPptxScript(
    "prepare",
    {
      fallbackAssetsDirectory,
      htmlAbsolutePath,
      measurementsAbsolutePath,
      outHtmlAbsolutePath,
      slideSelector: args.slideSelector,
      workspaceRoot,
    },
    workspaceRoot,
    context.signal,
  );

  return [
    "已准备 HTML-to-PPTX 输入。",
    `Prepared HTML：${String(result.outHtml ?? toWorkspaceRelative(outHtmlAbsolutePath, workspaceRoot))}`,
    `measurements：${String(result.measurementsPath ?? toWorkspaceRelative(measurementsAbsolutePath, workspaceRoot))}`,
    `截图回退：${Number(result.rasterFallbacks ?? 0)}`,
    `warning：${Number(result.warnings ?? 0)}`,
  ].join("\n");
}

async function exportHtmlToPptx(
  rawArgs: unknown,
  context: ToolExecutionContext,
) {
  const args = exportHtmlToPptxSchema.parse(rawArgs);
  const workspaceRoot = getWorkspaceRoot(context.workspaceRoot);
  const htmlAbsolutePath = resolveWorkspacePath(args.html, workspaceRoot);
  const outPptxAbsolutePath = resolveWorkspacePath(args.outPptx, workspaceRoot);
  const result = await runHtmlPptxScript(
    "export",
    {
      author: args.author,
      htmlAbsolutePath,
      outPptxAbsolutePath,
      slideSelector: args.slideSelector,
      title: args.title,
      workspaceRoot,
    },
    workspaceRoot,
    context.signal,
  );
  const diagnosticLines = [
    Array.isArray(result.pageErrors) && result.pageErrors.length
      ? `page error：${result.pageErrors.join("; ")}`
      : undefined,
    Array.isArray(result.consoleErrors) && result.consoleErrors.length
      ? `console error：${result.consoleErrors.join("; ")}`
      : undefined,
  ].filter(Boolean);

  return [
    "已通过 dom-to-pptx 导出 PPTX。",
    `路径：${String(result.outPptx ?? toWorkspaceRelative(outPptxAbsolutePath, workspaceRoot))}`,
    `HTML：${String(result.html ?? toWorkspaceRelative(htmlAbsolutePath, workspaceRoot))}`,
    `内联本地图片：${Number(result.inlined ?? 0)}`,
    ...diagnosticLines,
  ].join("\n");
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
  const result = await runHtmlPptxScript(
    "validate",
    {
      htmlAbsolutePath,
      measurementsAbsolutePath,
      pptxAbsolutePath,
      preparedHtmlAbsolutePath,
      previewHtmlDirectory: path.join(htmlDirectory, "preview-html"),
      previewPptxDirectory: path.join(htmlDirectory, "preview-pptx"),
      qaReportAbsolutePath,
      expectedTemplateId: context.toolSettings?.slides?.templateId?.trim() || "",
      slideSelector: args.slideSelector,
      workspaceRoot,
    },
    workspaceRoot,
    context.signal,
  );

  return [
    "已验证 HTML-to-PPTX spike 产物。",
    `QA：${String(result.qaReport ?? toWorkspaceRelative(qaReportAbsolutePath, workspaceRoot))}`,
    `slide 数：${Number(result.slides ?? 0)}`,
    `可编辑元素：${Number(result.editableElements ?? 0)}`,
    `截图回退：${Number(result.rasterFallbacks ?? 0)}`,
    `warning：${Number(result.warnings ?? 0)}`,
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
            description:
              "Use spike-sample to copy the default 8-slide validation deck template. A selected slides templateId in tool settings also forces template package initialization.",
          },
          templateId: {
            type: "string",
            description:
              "Optional slides template package id. Defaults to the selected run template or the default template for spike-sample.",
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
        "Render HTML previews with Playwright, attempt PPTX previews via LibreOffice and Poppler, inspect PPTX structure, run objective visual smoke checks, and write qa-report.json for the HTML-to-PPTX route.",
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
