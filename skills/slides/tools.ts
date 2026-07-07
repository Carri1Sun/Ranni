import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { ToolDefinition, ToolExecutionContext } from "../../lib/tools";
import { resolveWorkspacePath, toWorkspaceRelative } from "../../lib/workspace";

// ---------------------------------------------------------------------------
// slides skill 工具：HTML-to-PPTX 路线（唯一路线）
//
// 设计要点：
// - 工具只做薄壳：用 resolveWorkspacePath 守住路径边界，再把绝对路径通过 JSON
//   参数交给 skills/slides/scripts/html-pptx/*.mjs 子进程执行，cwd 使用 session workspace。
// - playwright / dom-to-pptx 只在 .mjs 子进程里引入，不进入 tsc 构建图与 dist bundle。
// - native PptxGenJS 路线（generate_pptx / init_deck_workspace）已下线，不再提供。
// ---------------------------------------------------------------------------

const HTML_PPTX_SCRIPTS_DIR = path.resolve(
  process.cwd(),
  "skills",
  "slides",
  "scripts",
  "html-pptx",
);

const HTML_PPTX_TEMPLATE_DIR = path.resolve(
  process.cwd(),
  "skills",
  "slides",
  "templates",
  "slide-html",
);

type HtmlPptxResult = Record<string, unknown> & { ok?: boolean };

async function runHtmlPptxScript(
  scriptName: string,
  config: Record<string, unknown>,
  context: ToolExecutionContext,
  timeoutMs = 180_000,
): Promise<HtmlPptxResult> {
  const scriptPath = path.join(HTML_PPTX_SCRIPTS_DIR, scriptName);

  if (!(await fileExists(scriptPath))) {
    throw new Error(`找不到 HTML-to-PPTX 脚本：${scriptPath}`);
  }

  const workspaceRoot = resolveWorkspacePath(".", context.workspaceRoot);
  const child = spawn(process.execPath, [scriptPath, JSON.stringify(config)], {
    cwd: workspaceRoot,
    env: { ...process.env, AGENT_WORKSPACE_ROOT: workspaceRoot },
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`脚本 ${scriptName} 超时（${timeoutMs}ms）。`));
    }, timeoutMs);
    child.on("error", (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      resolve(code ?? 0);
    });
  });

  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const lastLine = lines.length > 0 ? lines[lines.length - 1] : "";
  let parsed: HtmlPptxResult | null = null;
  if (lastLine.startsWith("{")) {
    try {
      parsed = JSON.parse(lastLine) as HtmlPptxResult;
    } catch {
      parsed = null;
    }
  }

  if (exitCode !== 0) {
    const message =
      (parsed?.error as string | undefined) ??
      stderr.trim() ??
      `脚本 ${scriptName} 退出码 ${exitCode}`;
    throw new Error(String(message));
  }

  if (!parsed) {
    throw new Error(
      `脚本 ${scriptName} 未返回可识别的结果。stdout: ${stdout.trim().slice(0, 800)}`,
    );
  }

  return parsed;
}

async function fileExists(target: string) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

const initSlideHtmlSchema = z.object({
  deckSlug: z.string().min(1),
  dir: z.string().min(1).optional(),
  title: z.string().optional(),
});

const prepareSlideHtmlSchema = z.object({
  html: z.string().min(1),
  outHtml: z.string().min(1).optional(),
  measurements: z.string().min(1).optional(),
  deviceScaleFactor: z.number().int().min(1).max(4).default(2),
});

const exportHtmlToPptxSchema = z.object({
  html: z.string().min(1),
  outPptx: z.string().min(1).optional(),
  deckName: z.string().optional(),
  author: z.string().optional(),
});

const validateHtmlPptxExportSchema = z.object({
  html: z.string().min(1),
  pptx: z.string().min(1),
  measurements: z.string().min(1).optional(),
  previewHtmlDir: z.string().min(1).optional(),
  previewPptxDir: z.string().min(1).optional(),
  qaReport: z.string().min(1).optional(),
});

async function initSlideHtmlWorkspace(
  rawArgs: unknown,
  context: ToolExecutionContext,
) {
  const args = initSlideHtmlSchema.parse(rawArgs);
  const deckDirAbs = resolveWorkspacePath(args.dir ?? args.deckSlug, context.workspaceRoot);

  await fs.mkdir(path.dirname(deckDirAbs), { recursive: true });
  await fs.cp(HTML_PPTX_TEMPLATE_DIR, deckDirAbs, { recursive: true });

  for (const sub of ["final", "preview-html", "preview-pptx", "fallback-assets"]) {
    await fs.mkdir(path.join(deckDirAbs, sub), { recursive: true });
  }

  const expectedPptx = path.join(deckDirAbs, "final", `${args.deckSlug}.pptx`);
  return [
    "已初始化 HTML-to-PPTX deck workspace（含受限 slide HTML 示例）。",
    `目录：${toWorkspaceRelative(deckDirAbs, context.workspaceRoot)}`,
    `HTML：${toWorkspaceRelative(path.join(deckDirAbs, "deck.html"), context.workspaceRoot)}`,
    `CSS：${toWorkspaceRelative(path.join(deckDirAbs, "styles.css"), context.workspaceRoot)}`,
    `预期 PPTX：${toWorkspaceRelative(expectedPptx, context.workspaceRoot)}`,
    "下一步：编辑 deck.html，再依次调用 prepare_slide_html_for_pptx → export_html_to_pptx → validate_html_pptx_export。",
  ].join("\n");
}

async function prepareSlideHtmlForPptx(
  rawArgs: unknown,
  context: ToolExecutionContext,
) {
  const args = prepareSlideHtmlSchema.parse(rawArgs);
  const deckHtmlAbs = resolveWorkspacePath(args.html, context.workspaceRoot);
  const deckDirAbs = path.dirname(deckHtmlAbs);
  const fallbackDirAbs = path.join(deckDirAbs, "fallback-assets");
  const outHtmlAbs = resolveWorkspacePath(
    args.outHtml ?? path.join(deckDirAbs, "deck.prepared.html"),
    context.workspaceRoot,
  );
  const measurementsAbs = resolveWorkspacePath(
    args.measurements ?? path.join(deckDirAbs, "measurements.json"),
    context.workspaceRoot,
  );

  const result = await runHtmlPptxScript(
    "prepare.mjs",
    {
      deckHtml: deckHtmlAbs,
      deckDir: deckDirAbs,
      fallbackDir: fallbackDirAbs,
      outHtml: outHtmlAbs,
      measurements: measurementsAbs,
      deviceScaleFactor: args.deviceScaleFactor,
    },
    context,
  );

  return [
    "已完成截图回退预处理，生成 deck.prepared.html 与 measurements.json。",
    `prepared：${toWorkspaceRelative(outHtmlAbs, context.workspaceRoot)}`,
    `measurements：${toWorkspaceRelative(measurementsAbs, context.workspaceRoot)}`,
    `slides=${result.slides ?? "?"}  raster=${result.raster ?? "?"}  editable=${result.editable ?? "?"}`,
    "下一步：调用 export_html_to_pptx 把 deck.prepared.html 转成 .pptx。",
  ].join("\n");
}

async function exportHtmlToPptx(
  rawArgs: unknown,
  context: ToolExecutionContext,
) {
  const args = exportHtmlToPptxSchema.parse(rawArgs);
  const preparedHtmlAbs = resolveWorkspacePath(args.html, context.workspaceRoot);
  const deckDirAbs = path.dirname(preparedHtmlAbs);
  const outPptxAbs = resolveWorkspacePath(
    args.outPptx ?? path.join(deckDirAbs, "final", "deck.pptx"),
    context.workspaceRoot,
  );

  const result = await runHtmlPptxScript(
    "export.mjs",
    {
      preparedHtml: preparedHtmlAbs,
      outPptx: outPptxAbs,
      deckName: args.deckName,
      author: args.author,
    },
    context,
  );

  return [
    "已通过 dom-to-pptx 生成 .pptx。",
    `pptx：${toWorkspaceRelative(outPptxAbs, context.workspaceRoot)}`,
    `bytes=${result.bytes ?? "?"}  slides=${result.slides ?? "?"}`,
    "下一步：调用 validate_html_pptx_export 生成预览与 qa-report.json。",
  ].join("\n");
}

async function validateHtmlPptxExport(
  rawArgs: unknown,
  context: ToolExecutionContext,
) {
  const args = validateHtmlPptxExportSchema.parse(rawArgs);
  const deckHtmlAbs = resolveWorkspacePath(args.html, context.workspaceRoot);
  const deckDirAbs = path.dirname(deckHtmlAbs);
  const pptxAbs = resolveWorkspacePath(args.pptx, context.workspaceRoot);
  const measurementsAbs = resolveWorkspacePath(
    args.measurements ?? path.join(deckDirAbs, "measurements.json"),
    context.workspaceRoot,
  );
  const previewHtmlDirAbs = resolveWorkspacePath(
    args.previewHtmlDir ?? path.join(deckDirAbs, "preview-html"),
    context.workspaceRoot,
  );
  const previewPptxDirAbs = resolveWorkspacePath(
    args.previewPptxDir ?? path.join(deckDirAbs, "preview-pptx"),
    context.workspaceRoot,
  );
  const qaReportAbs = resolveWorkspacePath(
    args.qaReport ?? path.join(deckDirAbs, "qa-report.json"),
    context.workspaceRoot,
  );

  const result = await runHtmlPptxScript(
    "validate.mjs",
    {
      deckHtml: deckHtmlAbs,
      pptx: pptxAbs,
      measurements: measurementsAbs,
      previewHtmlDir: previewHtmlDirAbs,
      previewPptxDir: previewPptxDirAbs,
      qaReport: qaReportAbs,
      deckDir: deckDirAbs,
    },
    context,
  );

  return [
    "已完成导出校验，写入 qa-report.json。",
    `qaReport：${toWorkspaceRelative(qaReportAbs, context.workspaceRoot)}`,
    `slides=${result.slides ?? "?"}  pptxSlides=${result.pptxSlides ?? "?"}  editable=${result.editable ?? "?"}  raster=${result.raster ?? "?"}`,
    `warnings=${result.warnings ?? "?"}  libreoffice=${result.libreoffice ?? "?"}`,
    "提示：preview-pptx 需要系统 LibreOffice；缺失时兼容性检查会标注 not_checked。",
  ].join("\n");
}

export const tools: ToolDefinition[] = [
  {
    schema: initSlideHtmlSchema,
    tool: {
      name: "init_slide_html_workspace",
      description:
        "Initialize the deck workspace for the HTML-to-PPTX route: copy the restricted slide-HTML template (deck.html, styles.css, assets/) and create final/preview-html/preview-pptx/fallback-assets subfolders. This is the entry point for slides creation.",
      input_schema: {
        type: "object",
        properties: {
          deckSlug: { type: "string", description: "Deck slug used for the artifact directory and default pptx name." },
          dir: { type: "string", description: "Deck artifact directory. Defaults to deckSlug." },
          title: { type: "string", description: "Deck title (informational)." },
        },
        required: ["deckSlug"],
      },
    },
    execute: initSlideHtmlWorkspace,
  },
  {
    schema: prepareSlideHtmlSchema,
    tool: {
      name: "prepare_slide_html_for_pptx",
      description:
        "Open the restricted slide HTML with Playwright, screenshot every [data-pptx-raster] node into fallback-assets/, replace each with an equal-sized <img>, inline local images as data URIs, and write deck.prepared.html + measurements.json. Runs before dom-to-pptx so the converter faces a stable HTML subset.",
      input_schema: {
        type: "object",
        properties: {
          html: { type: "string", description: "deck.html path (workspace-relative or absolute)." },
          outHtml: { type: "string", description: "Output prepared HTML path. Defaults to <deckDir>/deck.prepared.html." },
          measurements: { type: "string", description: "Output measurements.json path. Defaults to <deckDir>/measurements.json." },
          deviceScaleFactor: { type: "integer", minimum: 1, maximum: 4, default: 2 },
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
        "Convert deck.prepared.html to a .pptx via dom-to-pptx in a Playwright page (single browser session). Returns the generated pptx path and byte size.",
      input_schema: {
        type: "object",
        properties: {
          html: { type: "string", description: "deck.prepared.html path." },
          outPptx: { type: "string", description: "Output .pptx path. Defaults to <deckDir>/final/deck.pptx." },
          deckName: { type: "string" },
          author: { type: "string" },
        },
        required: ["html"],
      },
    },
    execute: exportHtmlToPptx,
  },
  {
    schema: validateHtmlPptxExportSchema,
    tool: {
      name: "validate_html_pptx_export",
      description:
        "Render HTML slide previews, render pptx previews via LibreOffice (marked not_checked when absent), count pptx slides, compute HTML-vs-PPTX pixel diff, verify fallback assets, and write qa-report.json.",
      input_schema: {
        type: "object",
        properties: {
          html: { type: "string", description: "Original deck.html path." },
          pptx: { type: "string", description: "Generated .pptx path." },
          measurements: { type: "string", description: "measurements.json path. Defaults to <deckDir>/measurements.json." },
          previewHtmlDir: { type: "string", description: "Defaults to <deckDir>/preview-html." },
          previewPptxDir: { type: "string", description: "Defaults to <deckDir>/preview-pptx." },
          qaReport: { type: "string", description: "Defaults to <deckDir>/qa-report.json." },
        },
        required: ["html", "pptx"],
      },
    },
    execute: validateHtmlPptxExport,
  },
];
