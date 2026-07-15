import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { load } from "cheerio";
import { z } from "zod";

import {
  findHtmlDesignStyle,
  listHtmlDesignStyles,
} from "../../lib/html-design/catalog";
import type { ToolDefinition, ToolExecutionContext } from "../../lib/tools";
import {
  findHtmlToPptxSampleDeck,
  getDefaultHtmlToPptxSampleDeckId,
  getHtmlToPptxSampleDeckDirectory,
} from "../../lib/html-to-pptx/sample-decks";
import {
  getWorkspaceRoot,
  resolveWorkspacePath,
  toWorkspaceRelative,
} from "../../lib/workspace";

const MAX_SLIDE_FRAGMENT_CHARS = 8_000;
const MAX_STYLE_FRAGMENT_CHARS = 4_000;
const SLIDE_MANIFEST_FILE = "slide-manifest.json";
const RESERVED_SLIDE_IDS = new Set(["css", "style", "styles", "theme"]);
const slideIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(
    /^[a-zA-Z0-9._-]+$/,
    "slideId 只能包含字母、数字、点、下划线和连字符。",
  );
const styleIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(
    /^[a-zA-Z0-9._-]+$/,
    "styleId 只能包含字母、数字、点、下划线和连字符。",
  );

const initSlideHtmlWorkspaceSchema = z.object({
  deckSlug: z.string().min(1),
  dir: z.string().min(1).optional(),
  overwrite: z.boolean().default(false),
  prompt: z.string().min(1).optional(),
  styleId: z.preprocess(
    (value) =>
      typeof value === "string" && !value.trim() ? undefined : value,
    z.string().trim().min(1).optional(),
  ),
  exampleDeck: z.enum(["spike-sample"]).optional(),
  title: z.string().min(1).default("HTML to PPTX spike"),
});

const writeSlideFragmentSchema = z.object({
  deckDir: z.string().min(1),
  html: z.string().min(1),
  slideId: slideIdSchema,
});

const inspectSlideFragmentSchema = z.object({
  deckDir: z.string().min(1),
  slideId: slideIdSchema,
  source: z.enum(["draft", "accepted"]).default("draft"),
});

const patchSlideFragmentSchema = z.object({
  baseHash: z.string().regex(/^[a-f0-9]{64}$/i, "baseHash 必须是 SHA-256 hash。"),
  deckDir: z.string().min(1),
  expectedOccurrences: z.number().int().min(1).max(100).default(1),
  find: z.string().min(1),
  replace: z.string(),
  slideId: slideIdSchema,
  source: z.enum(["draft", "accepted"]).default("draft"),
});

const setSlideManifestSchema = z
  .object({
    deckDir: z.string().min(1),
    slideIds: z.array(slideIdSchema).min(1).max(100),
  })
  .superRefine(({ slideIds }, context) => {
    if (new Set(slideIds).size !== slideIds.length) {
      context.addIssue({
        code: "custom",
        message: "slideIds 不能包含重复页面。",
        path: ["slideIds"],
      });
    }

    const reservedId = slideIds.find((slideId) =>
      RESERVED_SLIDE_IDS.has(slideId.toLowerCase()),
    );

    if (reservedId) {
      context.addIssue({
        code: "custom",
        message: `slideId ${reservedId} 属于保留名称，不能用于页面。`,
        path: ["slideIds"],
      });
    }
  });

const writeStyleFragmentSchema = z.object({
  css: z.string().min(1).max(MAX_STYLE_FRAGMENT_CHARS),
  deckDir: z.string().min(1),
  styleId: styleIdSchema,
});

const assembleDeckStylesSchema = z
  .object({
    deckDir: z.string().min(1),
    styleIds: z.array(styleIdSchema).min(1).max(30),
  })
  .superRefine(({ styleIds }, context) => {
    if (new Set(styleIds).size !== styleIds.length) {
      context.addIssue({
        code: "custom",
        message: "styleIds 不能包含重复样式片段。",
        path: ["styleIds"],
      });
    }
  });

const assembleSlideDeckSchema = z.object({
  deckDir: z.string().min(1),
  outHtml: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
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

async function writeFileAtomically(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;

  try {
    await fs.writeFile(temporaryPath, content, "utf8");
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

type SlideDiagnosticIssue = {
  category?: string;
  code: string;
  message: string;
  severity: "error" | "warning";
  [key: string]: unknown;
};

type SlideDiagnostics = {
  errors: SlideDiagnosticIssue[];
  issues: SlideDiagnosticIssue[];
  schema: string;
  slides: Array<Record<string, unknown>>;
  status: "failed" | "passed" | "warning";
  summary: {
    errors: number;
    warnings: number;
  };
  warnings: SlideDiagnosticIssue[];
};

type SlideArtifactPaths = {
  accepted: string;
  diagnostics: string;
  draft: string;
  preview: string;
};

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function createSlideToolError(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
) {
  const payload = {
    code,
    message,
    schema: "ranni.html-to-pptx.tool-error.v1",
    ...details,
  };
  const error = new Error(`${code}\n${JSON.stringify(payload, null, 2)}`);

  error.name = "SlideToolError";
  return error;
}

function slideArtifactPaths(
  deckAbsolutePath: string,
  slideId: string,
): SlideArtifactPaths {
  return {
    accepted: path.join(deckAbsolutePath, "slides", `${slideId}.html`),
    diagnostics: path.join(
      deckAbsolutePath,
      "slides",
      ".draft",
      `${slideId}.diagnostics.json`,
    ),
    draft: path.join(
      deckAbsolutePath,
      "slides",
      ".draft",
      `${slideId}.html`,
    ),
    preview: path.join(
      deckAbsolutePath,
      "slides",
      ".draft",
      `${slideId}.png`,
    ),
  };
}

function createSingleIssueDiagnostics(
  code: string,
  message: string,
): SlideDiagnostics {
  const issue: SlideDiagnosticIssue = {
    category: "slide-diagnostic",
    code,
    message,
    severity: "error",
  };

  return {
    errors: [issue],
    issues: [issue],
    schema: "ranni.html-to-pptx.slide-diagnostics.v1",
    slides: [],
    status: "failed",
    summary: { errors: 1, warnings: 0 },
    warnings: [],
  };
}

function parseSlideDiagnostics(result: Record<string, unknown>): SlideDiagnostics {
  const issues = Array.isArray(result.issues)
    ? (result.issues as SlideDiagnosticIssue[])
    : [];
  const errors = Array.isArray(result.errors)
    ? (result.errors as SlideDiagnosticIssue[])
    : issues.filter((issue) => issue.severity === "error");
  const warnings = Array.isArray(result.warnings)
    ? (result.warnings as SlideDiagnosticIssue[])
    : issues.filter((issue) => issue.severity === "warning");

  return {
    errors,
    issues,
    schema:
      typeof result.schema === "string"
        ? result.schema
        : "ranni.html-to-pptx.slide-diagnostics.v1",
    slides: Array.isArray(result.slides)
      ? (result.slides as Array<Record<string, unknown>>)
      : [],
    status: errors.length ? "failed" : warnings.length ? "warning" : "passed",
    summary: { errors: errors.length, warnings: warnings.length },
    warnings,
  };
}

async function readHashIfPresent(filePath: string) {
  if (!(await fileExists(filePath))) {
    return undefined;
  }

  return sha256(await fs.readFile(filePath, "utf8"));
}

async function writeSlideArtifactDiagnostics({
  acceptedHash,
  diagnostics,
  draftHash,
  paths,
  slideId,
  status,
  workspaceRoot,
}: {
  acceptedHash?: string;
  diagnostics: SlideDiagnostics;
  draftHash: string;
  paths: SlideArtifactPaths;
  slideId: string;
  status: "accepted" | "failed";
  workspaceRoot: string;
}) {
  const report = {
    acceptedHash: acceptedHash ?? null,
    acceptedPath: toWorkspaceRelative(paths.accepted, workspaceRoot),
    diagnostics,
    draftHash,
    draftPath: toWorkspaceRelative(paths.draft, workspaceRoot),
    previewPath: (await fileExists(paths.preview))
      ? toWorkspaceRelative(paths.preview, workspaceRoot)
      : null,
    schema: "ranni.html-to-pptx.slide-artifact.v1",
    slideId,
    status,
  };

  await writeFileAtomically(paths.diagnostics, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function validateSlideFragment(html: string, expectedSlideId: string) {
  if (/<\/?(?:html|head|body)\b/i.test(html)) {
    throw new Error(
      `slide ${expectedSlideId} 只能包含单页 section，不能包含 html、head 或 body。`,
    );
  }

  const $ = load(html, undefined, false);
  const rootElements = $.root().children();
  const slides = $(".slide");

  if (rootElements.length !== 1 || slides.length !== 1) {
    throw new Error(
      `slide ${expectedSlideId} 必须且只能包含一个顶层 .slide 元素。`,
    );
  }

  const slide = slides.first();

  if (!rootElements.first().is(slide)) {
    throw new Error(`slide ${expectedSlideId} 的 .slide 必须是顶层元素。`);
  }

  const actualSlideId = slide.attr("data-slide-id")?.trim();

  if (actualSlideId !== expectedSlideId) {
    throw new Error(
      `slideId 不一致：参数为 ${expectedSlideId}，HTML 中为 ${actualSlideId || "空"}。`,
    );
  }

  if (slide.find("script, style, link").length > 0) {
    throw new Error(
      `slide ${expectedSlideId} 不能包含 script、style 或 link；全局样式请写入 CSS fragment。`,
    );
  }

  const visibleText = slide.text().replace(/\s+/g, "").trim();
  const visualElements = slide.find(
    "img, svg, canvas, video, [data-pptx-raster]",
  );

  if (!visibleText && visualElements.length === 0) {
    throw new Error(
      `slide ${expectedSlideId} 没有可见文字或视觉内容，拒绝写入空白页。`,
    );
  }
}

function validateCssFragment(css: string, styleId: string) {
  let braceDepth = 0;
  let quote = "";
  let inComment = false;

  for (let index = 0; index < css.length; index += 1) {
    const current = css[index];
    const next = css[index + 1];

    if (inComment) {
      if (current === "*" && next === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (current === "\\") {
        index += 1;
      } else if (current === quote) {
        quote = "";
      }
      continue;
    }

    if (current === "/" && next === "*") {
      inComment = true;
      index += 1;
    } else if (current === '"' || current === "'") {
      quote = current;
    } else if (current === "{") {
      braceDepth += 1;
    } else if (current === "}") {
      braceDepth -= 1;
      if (braceDepth < 0) {
        throw new Error(`CSS fragment ${styleId} 存在多余的右花括号。`);
      }
    }
  }

  if (inComment) {
    throw new Error(`CSS fragment ${styleId} 存在未闭合注释。`);
  }
  if (quote) {
    throw new Error(`CSS fragment ${styleId} 存在未闭合字符串。`);
  }
  if (braceDepth !== 0) {
    throw new Error(`CSS fragment ${styleId} 存在未闭合规则块。`);
  }
  if (!css.trim()) {
    throw new Error(`CSS fragment ${styleId} 不能为空。`);
  }
  if (/\.slide\s*>\s*\*\s*\{[^}]*\bposition\s*:/is.test(css)) {
    throw new Error(
      `CSS fragment ${styleId} 不能通过 .slide > * 统一覆盖 position；请把层级规则放在明确的内容或背景 class 上。`,
    );
  }
}

type SlideManifest = {
  schema: "ranni.html-to-pptx.slide-manifest.v1";
  slideIds: string[];
};

async function readSlideManifest(deckAbsolutePath: string) {
  const manifestPath = path.join(deckAbsolutePath, SLIDE_MANIFEST_FILE);

  if (!(await fileExists(manifestPath))) {
    throw new Error(
      `缺少 ${SLIDE_MANIFEST_FILE}，请先调用 set_slide_manifest 固定页面清单。`,
    );
  }

  let manifest: SlideManifest;

  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as SlideManifest;
  } catch (error) {
    throw new Error(
      `${SLIDE_MANIFEST_FILE} 无法解析：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const parsed = setSlideManifestSchema.parse({
    deckDir: ".",
    slideIds: manifest.slideIds,
  });

  return { manifest: { ...manifest, slideIds: parsed.slideIds }, manifestPath };
}

function indentFragment(html: string) {
  return html
    .trim()
    .split(/\r?\n/)
    .map((line) => `    ${line}`)
    .join("\n");
}

function createBlankSlideHtmlTemplate(title: string, prompt?: string) {
  const safeTitle = escapeHtml(title);
  const safePrompt = escapeHtml(
    summarizePrompt(prompt, "在这里放置受限 slide HTML 内容。"),
  );

  return {
    css: [
      "html, body { margin: 0; padding: 0; background: #eef2f7; overflow: hidden; }",
      "body { font-family: Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif; color: #172033; }",
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
  const sourceCandidate = path.resolve(
    process.cwd(),
    "skills",
    "html-to-pptx",
    ...segments,
  );
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
  scriptName: "export" | "preflight" | "prepare" | "validate",
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

async function runSlidePreflight({
  deckAbsolutePath,
  expectedSlideId,
  fragment,
  signal,
  screenshotAbsolutePath,
  stylesheetHref = "./styles.css",
  workspaceRoot,
}: {
  deckAbsolutePath: string;
  expectedSlideId: string;
  fragment: string;
  signal?: AbortSignal;
  screenshotAbsolutePath?: string;
  stylesheetHref?: string;
  workspaceRoot: string;
}) {
  const temporaryHtmlPath = path.join(
    deckAbsolutePath,
    `.slide-preflight.${process.pid}.${crypto.randomUUID()}.html`,
  );
  const preflightHtml = [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '  <meta charset="utf-8" />',
    `  <link rel="stylesheet" href="${escapeHtml(stylesheetHref)}" />`,
    "</head>",
    "<body>",
    fragment,
    "</body>",
    "</html>",
  ].join("\n");

  try {
    await fs.writeFile(temporaryHtmlPath, preflightHtml, "utf8");
    return await runHtmlPptxScript(
      "preflight",
      {
        expectedSlideId,
        htmlAbsolutePath: temporaryHtmlPath,
        screenshotAbsolutePath,
      },
      workspaceRoot,
      signal,
    );
  } finally {
    await fs.rm(temporaryHtmlPath, { force: true }).catch(() => undefined);
  }
}

async function ensureSlideFragmentPreconditions(
  deckAbsolutePath: string,
  slideId: string,
) {
  if (RESERVED_SLIDE_IDS.has(slideId.toLowerCase())) {
    throw createSlideToolError(
      "SLIDE_PRECONDITION_FAILED",
      `slideId ${slideId} 属于保留名称，不能用于页面。`,
      { slideId },
    );
  }

  const { manifest } = await readSlideManifest(deckAbsolutePath);

  if (!manifest.slideIds.includes(slideId)) {
    throw createSlideToolError(
      "SLIDE_PRECONDITION_FAILED",
      `slideId ${slideId} 不在已固定的页面清单中。清单：${manifest.slideIds.join(", ")}。`,
      { manifest: manifest.slideIds, slideId },
    );
  }

  const cssAbsolutePath = path.join(deckAbsolutePath, "styles.css");

  if (!(await fileExists(cssAbsolutePath))) {
    throw createSlideToolError(
      "SLIDE_PRECONDITION_FAILED",
      "缺少已组装的 styles.css，请先调用 assemble_deck_styles。",
      { slideId },
    );
  }
}

async function persistSlideCandidate({
  deckAbsolutePath,
  normalizedHtml,
  signal,
  slideId,
  workspaceRoot,
}: {
  deckAbsolutePath: string;
  normalizedHtml: string;
  signal?: AbortSignal;
  slideId: string;
  workspaceRoot: string;
}) {
  await ensureSlideFragmentPreconditions(deckAbsolutePath, slideId);

  const paths = slideArtifactPaths(deckAbsolutePath, slideId);

  await writeFileAtomically(paths.draft, normalizedHtml);

  const draftHash = sha256(normalizedHtml);
  const acceptedHashBefore = await readHashIfPresent(paths.accepted);
  const commonFailureDetails = {
    acceptedHash: acceptedHashBefore ?? null,
    acceptedUnchanged: true,
    diagnosticsPath: toWorkspaceRelative(paths.diagnostics, workspaceRoot),
    draftHash,
    draftPath: toWorkspaceRelative(paths.draft, workspaceRoot),
    previewPath: toWorkspaceRelative(paths.preview, workspaceRoot),
    slideId,
  };

  if (normalizedHtml.length > MAX_SLIDE_FRAGMENT_CHARS) {
    const message = `slide ${slideId} 内容过长（${normalizedHtml.length} chars，限制 ${MAX_SLIDE_FRAGMENT_CHARS} chars）。`;
    const diagnostics = createSingleIssueDiagnostics(
      "SLIDE_FRAGMENT_TOO_LARGE",
      message,
    );

    await writeSlideArtifactDiagnostics({
      acceptedHash: acceptedHashBefore,
      diagnostics,
      draftHash,
      paths,
      slideId,
      status: "failed",
      workspaceRoot,
    });
    throw createSlideToolError("SLIDE_FRAGMENT_TOO_LARGE", message, {
      ...commonFailureDetails,
      diagnostics,
    });
  }

  try {
    validateSlideFragment(normalizedHtml, slideId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const diagnostics = createSingleIssueDiagnostics(
      "SLIDE_STRUCTURE_INVALID",
      message,
    );

    await writeSlideArtifactDiagnostics({
      acceptedHash: acceptedHashBefore,
      diagnostics,
      draftHash,
      paths,
      slideId,
      status: "failed",
      workspaceRoot,
    });
    throw createSlideToolError("SLIDE_STRUCTURE_INVALID", message, {
      ...commonFailureDetails,
      diagnostics,
    });
  }

  let diagnostics: SlideDiagnostics;

  try {
    diagnostics = parseSlideDiagnostics(
      await runSlidePreflight({
        deckAbsolutePath,
        expectedSlideId: slideId,
        fragment: normalizedHtml,
        screenshotAbsolutePath: paths.preview,
        signal,
        workspaceRoot,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const infrastructureDiagnostics = createSingleIssueDiagnostics(
      "SLIDE_PREFLIGHT_INFRASTRUCTURE_FAILED",
      message,
    );

    await writeSlideArtifactDiagnostics({
      acceptedHash: acceptedHashBefore,
      diagnostics: infrastructureDiagnostics,
      draftHash,
      paths,
      slideId,
      status: "failed",
      workspaceRoot,
    });
    throw createSlideToolError(
      "SLIDE_PREFLIGHT_INFRASTRUCTURE_FAILED",
      "slide 浏览器预检无法完成。",
      {
        ...commonFailureDetails,
        cause: message,
        diagnostics: infrastructureDiagnostics,
      },
    );
  }

  if (diagnostics.errors.length) {
    await writeSlideArtifactDiagnostics({
      acceptedHash: acceptedHashBefore,
      diagnostics,
      draftHash,
      paths,
      slideId,
      status: "failed",
      workspaceRoot,
    });
    throw createSlideToolError(
      "SLIDE_CONTENT_VALIDATION_FAILED",
      `slide ${slideId} 存在 ${diagnostics.errors.length} 个内容或画布硬约束错误。`,
      {
        ...commonFailureDetails,
        diagnostics,
      },
    );
  }

  await writeFileAtomically(paths.accepted, normalizedHtml);

  const acceptedHash = sha256(normalizedHtml);
  const report = await writeSlideArtifactDiagnostics({
    acceptedHash,
    diagnostics,
    draftHash,
    paths,
    slideId,
    status: "accepted",
    workspaceRoot,
  });

  return {
    acceptedHash,
    diagnostics,
    draftHash,
    paths,
    report,
  };
}

function countExactOccurrences(value: string, find: string) {
  let count = 0;
  let cursor = 0;

  while (cursor <= value.length - find.length) {
    const index = value.indexOf(find, cursor);

    if (index < 0) {
      break;
    }

    count += 1;
    cursor = index + find.length;
  }

  return count;
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
  const selectedDesignStyleId =
    args.styleId?.trim() || context.toolSettings?.htmlToPptx?.styleId?.trim();
  const selectedDesignStyle = selectedDesignStyleId
    ? findHtmlDesignStyle(selectedDesignStyleId)
    : undefined;
  const sampleDeckId =
    args.exampleDeck === "spike-sample"
      ? getDefaultHtmlToPptxSampleDeckId()
      : "";
  const selectedSampleDeck = sampleDeckId
    ? findHtmlToPptxSampleDeck(sampleDeckId)
    : undefined;

  if (sampleDeckId && !selectedSampleDeck) {
    throw new Error(`未找到 HTML-to-PPTX 示例 deck：${sampleDeckId}`);
  }

  if (selectedDesignStyleId && !selectedDesignStyle) {
    const availableStyleIds = listHtmlDesignStyles().map((style) => style.id);
    throw new Error(
      [
        `未找到 HTML 设计风格：${selectedDesignStyleId}`,
        `可用风格 ID：${availableStyleIds.join(", ") || "无"}`,
        "也可以省略 styleId，并通过受限样式片段创建自定义风格。",
      ].join("\n"),
    );
  }

  const subDirectories = [
    "assets",
    "fallback-assets",
    "preview-html",
    "preview-pptx",
    "slides",
    "slides/.draft",
    "styles",
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

  const safeTitle = escapeHtml(args.title);
  const safePrompt = escapeHtml(
    summarizePrompt(
      args.prompt,
      "验证受限 slide HTML、dom-to-pptx 和局部截图回退的组合边界。",
    ),
  );
  const templateResult =
    selectedSampleDeck
      ? await copyTemplateDirectory(
          getHtmlToPptxSampleDeckDirectory(selectedSampleDeck.id),
          baseAbsolutePath,
          workspaceRoot,
          args.overwrite,
          {
            "{{PROMPT}}": safePrompt,
            "{{SAMPLE_DECK_ID}}": selectedSampleDeck.id,
            "{{SAMPLE_DECK_NAME}}": escapeHtml(selectedSampleDeck.name),
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
          designStyleId: selectedDesignStyle?.id ?? "",
          designStyleName: selectedDesignStyle?.name ?? "",
          exampleDeck: args.exampleDeck ?? "",
          sampleDeckId: selectedSampleDeck?.id ?? "",
          sampleDeckName: selectedSampleDeck?.name ?? "",
          sampleDeckVersion: selectedSampleDeck?.version ?? "",
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
    `设计风格：${selectedDesignStyle ? `${selectedDesignStyle.name} (${selectedDesignStyle.id})` : "未指定"}`,
    `示例 deck：${selectedSampleDeck ? `${selectedSampleDeck.name} (${selectedSampleDeck.id})` : "无"}`,
    writtenFiles.length ? `写入：${writtenFiles.join(", ")}` : "写入：无",
    skippedFiles.length
      ? `跳过已有文件：${skippedFiles.join(", ")}`
      : "跳过已有文件：无",
  ].join("\n");
}

async function setSlideManifest(
  rawArgs: unknown,
  context: ToolExecutionContext,
) {
  const args = setSlideManifestSchema.parse(rawArgs);
  const workspaceRoot = getWorkspaceRoot(context.workspaceRoot);
  const deckAbsolutePath = resolveWorkspacePath(args.deckDir, workspaceRoot);
  const slidesDirectory = path.join(deckAbsolutePath, "slides");
  const manifestPath = path.join(deckAbsolutePath, SLIDE_MANIFEST_FILE);
  const existingFragments = await fs
    .readdir(slidesDirectory)
    .catch(() => [] as string[]);
  const existingDrafts = await fs
    .readdir(path.join(slidesDirectory, ".draft"))
    .catch(() => [] as string[]);

  if (
    existingFragments.some((fileName) => fileName.endsWith(".html")) ||
    existingDrafts.some((fileName) => fileName.endsWith(".html"))
  ) {
    if (await fileExists(manifestPath)) {
      const current = await readSlideManifest(deckAbsolutePath);

      if (JSON.stringify(current.manifest.slideIds) === JSON.stringify(args.slideIds)) {
        return [
          "页面清单已固定且内容未变化。",
          `路径：${toWorkspaceRelative(manifestPath, workspaceRoot)}`,
          `页面数：${args.slideIds.length}`,
          `顺序：${args.slideIds.join(", ")}`,
        ].join("\n");
      }
    }

    throw new Error(
      "已有 slide fragment，不能再改变页面清单；请先完成当前 deck 或清理对应运行目录。",
    );
  }

  const manifest: SlideManifest = {
    schema: "ranni.html-to-pptx.slide-manifest.v1",
    slideIds: args.slideIds,
  };

  await writeFileAtomically(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  return [
    "已固定 slide 页面清单。",
    `路径：${toWorkspaceRelative(manifestPath, workspaceRoot)}`,
    `页面数：${args.slideIds.length}`,
    `顺序：${args.slideIds.join(", ")}`,
  ].join("\n");
}

async function writeStyleFragment(
  rawArgs: unknown,
  context: ToolExecutionContext,
) {
  const args = writeStyleFragmentSchema.parse(rawArgs);
  const workspaceRoot = getWorkspaceRoot(context.workspaceRoot);
  const deckAbsolutePath = resolveWorkspacePath(args.deckDir, workspaceRoot);
  const styleAbsolutePath = path.join(
    deckAbsolutePath,
    "styles",
    `${args.styleId}.css`,
  );
  const normalizedCss = `${args.css.trim()}\n`;

  validateCssFragment(normalizedCss, args.styleId);
  await writeFileAtomically(styleAbsolutePath, normalizedCss);

  return [
    "已原子写入 CSS fragment。",
    `styleId：${args.styleId}`,
    `路径：${toWorkspaceRelative(styleAbsolutePath, workspaceRoot)}`,
    `字符数：${normalizedCss.length}/${MAX_STYLE_FRAGMENT_CHARS}`,
  ].join("\n");
}

async function assembleDeckStyles(
  rawArgs: unknown,
  context: ToolExecutionContext,
) {
  const args = assembleDeckStylesSchema.parse(rawArgs);
  const workspaceRoot = getWorkspaceRoot(context.workspaceRoot);
  const deckAbsolutePath = resolveWorkspacePath(args.deckDir, workspaceRoot);
  const cssAbsolutePath = path.join(deckAbsolutePath, "styles.css");
  const candidateAbsolutePath = path.join(
    deckAbsolutePath,
    `.styles.${process.pid}.${crypto.randomUUID()}.candidate.css`,
  );
  const fragments: string[] = [];

  for (const styleId of args.styleIds) {
    const fragmentPath = path.join(
      deckAbsolutePath,
      "styles",
      `${styleId}.css`,
    );

    if (!(await fileExists(fragmentPath))) {
      throw new Error(
        `缺少 CSS fragment：${toWorkspaceRelative(fragmentPath, workspaceRoot)}。`,
      );
    }

    const fragment = await fs.readFile(fragmentPath, "utf8");

    validateCssFragment(fragment, styleId);
    fragments.push(`/* ${styleId} */\n${fragment.trim()}`);
  }

  const combinedCss = `${fragments.join("\n\n")}\n`;

  validateCssFragment(combinedCss, "assembled-styles");

  try {
    await fs.writeFile(candidateAbsolutePath, combinedCss, "utf8");
    const diagnostics = parseSlideDiagnostics(
      await runSlidePreflight({
        deckAbsolutePath,
        expectedSlideId: "style-probe",
        fragment:
          '<section class="slide" data-slide-id="style-probe"><p>Style preflight</p></section>',
        signal: context.signal,
        stylesheetHref: `./${path.basename(candidateAbsolutePath)}`,
        workspaceRoot,
      }),
    );

    if (diagnostics.errors.length) {
      throw createSlideToolError(
        "SLIDE_STYLE_PREFLIGHT_FAILED",
        `组装后的 CSS 违反 ${diagnostics.errors.length} 个 slide 画布硬约束。`,
        { diagnostics },
      );
    }
    await fs.rename(candidateAbsolutePath, cssAbsolutePath);
  } finally {
    await fs.rm(candidateAbsolutePath, { force: true }).catch(() => undefined);
  }

  return [
    "已校验并原子组装全局 CSS。",
    `路径：${toWorkspaceRelative(cssAbsolutePath, workspaceRoot)}`,
    `片段数：${args.styleIds.length}`,
    `顺序：${args.styleIds.join(", ")}`,
  ].join("\n");
}

async function writeSlideFragment(
  rawArgs: unknown,
  context: ToolExecutionContext,
) {
  const args = writeSlideFragmentSchema.parse(rawArgs);
  const workspaceRoot = getWorkspaceRoot(context.workspaceRoot);
  const deckAbsolutePath = resolveWorkspacePath(args.deckDir, workspaceRoot);
  const normalizedHtml = `${args.html.trim()}\n`;
  const result = await persistSlideCandidate({
    deckAbsolutePath,
    normalizedHtml,
    signal: context.signal,
    slideId: args.slideId,
    workspaceRoot,
  });

  return [
    "已保存 slide draft，通过硬约束验证后原子提升为 accepted fragment。",
    `slideId：${args.slideId}`,
    `draft：${toWorkspaceRelative(result.paths.draft, workspaceRoot)}`,
    `accepted：${toWorkspaceRelative(result.paths.accepted, workspaceRoot)}`,
    `diagnostics：${toWorkspaceRelative(result.paths.diagnostics, workspaceRoot)}`,
    `preview：${toWorkspaceRelative(result.paths.preview, workspaceRoot)}`,
    `hash：${result.acceptedHash}`,
    `字符数：${normalizedHtml.length}/${MAX_SLIDE_FRAGMENT_CHARS}`,
    `逐页预检：${result.diagnostics.status}（error ${result.diagnostics.errors.length} / warning ${result.diagnostics.warnings.length}）`,
    result.diagnostics.warnings.length
      ? `warning：${result.diagnostics.warnings
          .map((warning) =>
            [warning.code, warning.selector].filter(Boolean).join(" @ "),
          )
          .join("; ")}`
      : "warning：无",
    "下一步：写入下一页；全部页面完成后调用 assemble_slide_deck。",
  ].join("\n");
}

async function inspectSlideFragment(
  rawArgs: unknown,
  context: ToolExecutionContext,
) {
  const args = inspectSlideFragmentSchema.parse(rawArgs);
  const workspaceRoot = getWorkspaceRoot(context.workspaceRoot);
  const deckAbsolutePath = resolveWorkspacePath(args.deckDir, workspaceRoot);

  await ensureSlideFragmentPreconditions(deckAbsolutePath, args.slideId);

  const paths = slideArtifactPaths(deckAbsolutePath, args.slideId);
  const sourcePath = args.source === "draft" ? paths.draft : paths.accepted;

  if (!(await fileExists(sourcePath))) {
    throw createSlideToolError(
      args.source === "draft"
        ? "SLIDE_DRAFT_NOT_FOUND"
        : "SLIDE_ACCEPTED_NOT_FOUND",
      `没有找到 slide ${args.slideId} 的 ${args.source} fragment。`,
      {
        path: toWorkspaceRelative(sourcePath, workspaceRoot),
        slideId: args.slideId,
        source: args.source,
      },
    );
  }

  const html = await fs.readFile(sourcePath, "utf8");
  const diagnostics = await fs
    .readFile(paths.diagnostics, "utf8")
    .then((value) => JSON.parse(value) as unknown)
    .catch(() => null);
  const acceptedHash = await readHashIfPresent(paths.accepted);

  return JSON.stringify(
    {
      acceptedHash: acceptedHash ?? null,
      acceptedPath: toWorkspaceRelative(paths.accepted, workspaceRoot),
      diagnostics,
      diagnosticsPath: toWorkspaceRelative(paths.diagnostics, workspaceRoot),
      hash: sha256(html),
      html,
      path: toWorkspaceRelative(sourcePath, workspaceRoot),
      previewPath: (await fileExists(paths.preview))
        ? toWorkspaceRelative(paths.preview, workspaceRoot)
        : null,
      schema: "ranni.html-to-pptx.slide-inspection.v1",
      slideId: args.slideId,
      source: args.source,
    },
    null,
    2,
  );
}

async function patchSlideFragment(
  rawArgs: unknown,
  context: ToolExecutionContext,
) {
  const args = patchSlideFragmentSchema.parse(rawArgs);
  const workspaceRoot = getWorkspaceRoot(context.workspaceRoot);
  const deckAbsolutePath = resolveWorkspacePath(args.deckDir, workspaceRoot);

  await ensureSlideFragmentPreconditions(deckAbsolutePath, args.slideId);

  const paths = slideArtifactPaths(deckAbsolutePath, args.slideId);
  const sourcePath = args.source === "draft" ? paths.draft : paths.accepted;

  if (!(await fileExists(sourcePath))) {
    throw createSlideToolError(
      args.source === "draft"
        ? "SLIDE_DRAFT_NOT_FOUND"
        : "SLIDE_ACCEPTED_NOT_FOUND",
      `没有找到 slide ${args.slideId} 的 ${args.source} fragment。`,
      {
        path: toWorkspaceRelative(sourcePath, workspaceRoot),
        slideId: args.slideId,
        source: args.source,
      },
    );
  }

  const currentHtml = await fs.readFile(sourcePath, "utf8");
  const currentHash = sha256(currentHtml);

  if (currentHash.toLowerCase() !== args.baseHash.toLowerCase()) {
    throw createSlideToolError(
      "SLIDE_HASH_MISMATCH",
      `slide ${args.slideId} 的 ${args.source} fragment 已变化，请重新 inspect 后再 patch。`,
      {
        actualHash: currentHash,
        baseHash: args.baseHash,
        path: toWorkspaceRelative(sourcePath, workspaceRoot),
        slideId: args.slideId,
        source: args.source,
      },
    );
  }

  const actualOccurrences = countExactOccurrences(currentHtml, args.find);

  if (actualOccurrences !== args.expectedOccurrences) {
    throw createSlideToolError(
      "SLIDE_PATCH_MATCH_COUNT_MISMATCH",
      `精确替换匹配到 ${actualOccurrences} 处，预期 ${args.expectedOccurrences} 处。`,
      {
        actualOccurrences,
        expectedOccurrences: args.expectedOccurrences,
        slideId: args.slideId,
        source: args.source,
      },
    );
  }

  const patchedHtml = currentHtml.split(args.find).join(args.replace);
  const result = await persistSlideCandidate({
    deckAbsolutePath,
    normalizedHtml: `${patchedHtml.trim()}\n`,
    signal: context.signal,
    slideId: args.slideId,
    workspaceRoot,
  });

  return [
    "已按 baseHash 完成精确替换，并重新执行完整 slide 验证。",
    `slideId：${args.slideId}`,
    `source：${args.source}`,
    `替换次数：${actualOccurrences}`,
    `accepted：${toWorkspaceRelative(result.paths.accepted, workspaceRoot)}`,
    `diagnostics：${toWorkspaceRelative(result.paths.diagnostics, workspaceRoot)}`,
    `preview：${toWorkspaceRelative(result.paths.preview, workspaceRoot)}`,
    `hash：${result.acceptedHash}`,
    `逐页预检：${result.diagnostics.status}（error ${result.diagnostics.errors.length} / warning ${result.diagnostics.warnings.length}）`,
    result.diagnostics.warnings.length
      ? `warning：${result.diagnostics.warnings
          .map((warning) =>
            [warning.code, warning.selector].filter(Boolean).join(" @ "),
          )
          .join("; ")}`
      : "warning：无",
  ].join("\n");
}

async function assembleSlideDeck(
  rawArgs: unknown,
  context: ToolExecutionContext,
) {
  const args = assembleSlideDeckSchema.parse(rawArgs);
  const workspaceRoot = getWorkspaceRoot(context.workspaceRoot);
  const deckAbsolutePath = resolveWorkspacePath(args.deckDir, workspaceRoot);
  const defaultHtmlAbsolutePath = path.join(deckAbsolutePath, "deck.html");
  const outHtmlAbsolutePath = args.outHtml
    ? resolveWorkspacePath(args.outHtml, workspaceRoot)
    : defaultHtmlAbsolutePath;

  if (path.dirname(outHtmlAbsolutePath) !== deckAbsolutePath) {
    throw new Error("assemble_slide_deck 的 outHtml 必须位于 deckDir 根目录。");
  }

  const { manifest } = await readSlideManifest(deckAbsolutePath);
  const fragments: string[] = [];

  for (const slideId of manifest.slideIds) {
    const fragmentPath = path.join(deckAbsolutePath, "slides", `${slideId}.html`);

    if (!(await fileExists(fragmentPath))) {
      throw new Error(
        `缺少 slide fragment：${toWorkspaceRelative(fragmentPath, workspaceRoot)}。`,
      );
    }

    const fragment = await fs.readFile(fragmentPath, "utf8");

    validateSlideFragment(fragment, slideId);
    fragments.push(indentFragment(fragment));
  }

  let title = args.title?.trim();

  if (!title && (await fileExists(defaultHtmlAbsolutePath))) {
    const currentDeck = await fs.readFile(defaultHtmlAbsolutePath, "utf8");
    const $ = load(currentDeck);
    title = $("title").first().text().trim();
  }

  title ||= path.basename(deckAbsolutePath);

  const deckHtml = [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=1280, initial-scale=1" />',
    `  <title>${escapeHtml(title)}</title>`,
    '  <link rel="stylesheet" href="./styles.css" />',
    "</head>",
    "<body>",
    '  <main class="deck" data-pptx-deck>',
    fragments.join("\n"),
    "  </main>",
    "</body>",
    "</html>",
    "",
  ].join("\n");

  await writeFileAtomically(outHtmlAbsolutePath, deckHtml);

  return [
    "已确定性组装 slide deck。",
    `HTML：${toWorkspaceRelative(outHtmlAbsolutePath, workspaceRoot)}`,
    `页面数：${fragments.length}`,
    `顺序：${manifest.slideIds.join(", ")}`,
    "下一步：调用 prepare_slide_html_for_pptx。",
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

  if (Number(result.errors ?? 0) > 0) {
    throw createSlideToolError(
      "SLIDE_CONTENT_VALIDATION_FAILED",
      `prepare 检测到 ${Number(result.errors)} 个 slide 内容或画布硬约束错误。`,
      {
        diagnostics: result.diagnostics ?? null,
        measurementsPath: String(
          result.measurementsPath ??
            toWorkspaceRelative(measurementsAbsolutePath, workspaceRoot),
        ),
        preparedHtml: String(
          result.outHtml ?? toWorkspaceRelative(outHtmlAbsolutePath, workspaceRoot),
        ),
      },
    );
  }

  return [
    "已准备 HTML-to-PPTX 输入。",
    `Prepared HTML：${String(result.outHtml ?? toWorkspaceRelative(outHtmlAbsolutePath, workspaceRoot))}`,
    `measurements：${String(result.measurementsPath ?? toWorkspaceRelative(measurementsAbsolutePath, workspaceRoot))}`,
    `截图回退：${Number(result.rasterFallbacks ?? 0)}`,
    `文本稳定性候选：${Number(result.textLayoutRisks ?? 0)}`,
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
    `解析实际字体：${Number((result.fontResolution as { resolvedElements?: number } | undefined)?.resolvedElements ?? 0)}`,
    `嵌入中文字体子集：${Number((result.portableFont as { subsetCount?: number } | undefined)?.subsetCount ?? 0)}`,
    `稳定单行文本：${Number((result.textStabilization as { stabilizedElements?: number } | undefined)?.stabilizedElements ?? 0)}`,
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
      slideSelector: args.slideSelector,
      workspaceRoot,
    },
    workspaceRoot,
    context.signal,
  );

  if (Number(result.errors ?? 0) > 0) {
    throw createSlideToolError(
      "SLIDE_CONTENT_VALIDATION_FAILED",
      `最终 QA 检测到 ${Number(result.errors)} 个 slide 内容或画布硬约束错误。`,
      {
        diagnostics: result.diagnostics ?? null,
        qaReport: String(
          result.qaReport ?? toWorkspaceRelative(qaReportAbsolutePath, workspaceRoot),
        ),
      },
    );
  }

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
        "Initialize a restricted slide HTML workspace for the HTML-to-PPTX route. Creates deck.html, styles.css, styles/, slides/, slides/.draft/, assets/, fallback-assets/, preview-html/, preview-pptx/, measurements.json target, qa-report.json target, and final/.",
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
          styleId: {
            type: "string",
            description:
              "Optional registered HTML design style id. Omit it when creating a custom style with style fragments; otherwise it defaults to the selected run style.",
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
    schema: setSlideManifestSchema,
    tool: {
      name: "set_slide_manifest",
      description:
        "Persist the complete ordered slide id list before slide emission. The manifest becomes immutable after the first slide fragment exists.",
      input_schema: {
        type: "object",
        properties: {
          deckDir: {
            type: "string",
            description: "Workspace-relative deck directory.",
          },
          slideIds: {
            type: "array",
            minItems: 1,
            maxItems: 100,
            uniqueItems: true,
            items: {
              type: "string",
              pattern: "^[a-zA-Z0-9._-]+$",
            },
            description:
              "Complete ordered page list. Reserved ids style, styles, css, and theme are rejected.",
          },
        },
        required: ["deckDir", "slideIds"],
      },
    },
    execute: setSlideManifest,
  },
  {
    schema: writeStyleFragmentSchema,
    tool: {
      name: "write_style_fragment",
      description:
        "Atomically write one self-contained CSS fragment under styles/. Rejects unclosed comments, strings, and rule blocks.",
      input_schema: {
        type: "object",
        properties: {
          css: {
            type: "string",
            maxLength: MAX_STYLE_FRAGMENT_CHARS,
            description: "One compact, syntactically complete CSS fragment.",
          },
          deckDir: {
            type: "string",
            description: "Workspace-relative deck directory.",
          },
          styleId: {
            type: "string",
            pattern: "^[a-zA-Z0-9._-]+$",
            description: "Stable fragment id, for example base, layout, or components.",
          },
        },
        required: ["css", "deckDir", "styleId"],
      },
    },
    execute: writeStyleFragment,
  },
  {
    schema: assembleDeckStylesSchema,
    tool: {
      name: "assemble_deck_styles",
      description:
        "Validate and deterministically assemble ordered CSS fragments into styles.css, then run a 1280x720 browser preflight before replacing the current file.",
      input_schema: {
        type: "object",
        properties: {
          deckDir: {
            type: "string",
            description: "Workspace-relative deck directory.",
          },
          styleIds: {
            type: "array",
            minItems: 1,
            maxItems: 30,
            uniqueItems: true,
            items: {
              type: "string",
              pattern: "^[a-zA-Z0-9._-]+$",
            },
            description: "Ordered CSS fragment ids to assemble.",
          },
        },
        required: ["deckDir", "styleIds"],
      },
    },
    execute: assembleDeckStyles,
  },
  {
    schema: writeSlideFragmentSchema,
    tool: {
      name: "write_slide_fragment",
      description:
        "Save one manifested slide as slides/.draft/<slideId>.html, run semantic browser diagnostics, and atomically promote it to slides/<slideId>.html only when hard constraints pass. Failed drafts and diagnostics remain inspectable; keep html under 8000 characters.",
      input_schema: {
        type: "object",
        properties: {
          deckDir: {
            type: "string",
            description: "Workspace-relative deck directory created by init_slide_html_workspace.",
          },
          html: {
            type: "string",
            description:
              "One top-level .slide section only. It must have data-slide-id matching slideId and must not contain html/head/body wrappers.",
          },
          slideId: {
            type: "string",
            pattern: "^[a-zA-Z0-9._-]+$",
            description: "Stable unique slide id, for example 01-cover or 07-benchmarks.",
          },
        },
        required: ["deckDir", "html", "slideId"],
      },
    },
    execute: writeSlideFragment,
  },
  {
    schema: inspectSlideFragmentSchema,
    tool: {
      name: "inspect_slide_fragment",
      description:
        "Read the current draft or accepted slide fragment with its SHA-256 hash and latest structured diagnostics. Use the returned hash as patch_slide_fragment.baseHash.",
      input_schema: {
        type: "object",
        properties: {
          deckDir: {
            type: "string",
            description: "Workspace-relative deck directory.",
          },
          slideId: {
            type: "string",
            pattern: "^[a-zA-Z0-9._-]+$",
            description: "Manifested slide id.",
          },
          source: {
            type: "string",
            enum: ["draft", "accepted"],
            default: "draft",
            description: "Artifact to inspect. Defaults to the latest draft.",
          },
        },
        required: ["deckDir", "slideId"],
      },
    },
    execute: inspectSlideFragment,
  },
  {
    schema: patchSlideFragmentSchema,
    tool: {
      name: "patch_slide_fragment",
      description:
        "Apply an exact text replacement to an inspected draft or accepted slide when baseHash and expectedOccurrences still match, then rerun semantic validation and promote only on success.",
      input_schema: {
        type: "object",
        properties: {
          baseHash: {
            type: "string",
            pattern: "^[a-fA-F0-9]{64}$",
            description: "SHA-256 hash returned by inspect_slide_fragment.",
          },
          deckDir: {
            type: "string",
            description: "Workspace-relative deck directory.",
          },
          expectedOccurrences: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            default: 1,
            description: "Exact number of find matches required before editing.",
          },
          find: {
            type: "string",
            minLength: 1,
            description: "Exact source text to replace.",
          },
          replace: {
            type: "string",
            description: "Replacement text; may be empty.",
          },
          slideId: {
            type: "string",
            pattern: "^[a-zA-Z0-9._-]+$",
            description: "Manifested slide id.",
          },
          source: {
            type: "string",
            enum: ["draft", "accepted"],
            default: "draft",
            description: "Artifact version used as the patch base.",
          },
        },
        required: [
          "baseHash",
          "deckDir",
          "find",
          "replace",
          "slideId",
        ],
      },
    },
    execute: patchSlideFragment,
  },
  {
    schema: assembleSlideDeckSchema,
    tool: {
      name: "assemble_slide_deck",
      description:
        "Validate every slide fragment from the persisted slide manifest and deterministically assemble deck.html in manifest order.",
      input_schema: {
        type: "object",
        properties: {
          deckDir: {
            type: "string",
            description: "Workspace-relative deck directory created by init_slide_html_workspace.",
          },
          outHtml: {
            type: "string",
            description: "Optional workspace-relative output path in deckDir. Defaults to deckDir/deck.html.",
          },
          title: {
            type: "string",
            description: "Optional document title. Defaults to the current deck title or directory name.",
          },
        },
        required: ["deckDir"],
      },
    },
    execute: assembleSlideDeck,
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
