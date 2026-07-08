import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { tools } from "../skills/slides/tools";

type CliOptions = {
  deckSlug: string;
  dir: string;
  overwrite: boolean;
  prompt: string;
  title: string;
  workspaceRoot?: string;
};

function readFlagValue(args: string[], flag: string) {
  const index = args.indexOf(flag);

  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

function sanitizePathSegment(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "deck"
  );
}

function parseCliOptions(): CliOptions {
  const args = process.argv.slice(2);
  const deckSlug = readFlagValue(args, "--deck-slug") ?? "slides-html-pptx-spike";
  const prompt =
    readFlagValue(args, "--prompt") ??
    [
      "创建一份 Ranni HTML-to-PPTX spike 演示稿。",
      "必须覆盖封面、目录、文本页、双栏图文页、数据表格页、复杂图表截图回退页、时间线页和总结页。",
      "重要文本保留可编辑，复杂图表使用局部截图回退，最终输出可验证的有限可编辑 PPTX。",
    ].join(" ");

  return {
    deckSlug,
    dir: readFlagValue(args, "--dir") ?? "slides-html-pptx-spike",
    overwrite: !args.includes("--no-overwrite"),
    prompt,
    title: readFlagValue(args, "--title") ?? "HTML-to-PPTX Spike",
    workspaceRoot: readFlagValue(args, "--workspace"),
  };
}

function defaultWorkspaceBase() {
  const configuredBase = process.env.RANNI_DEFAULT_WORKSPACE?.trim();

  if (configuredBase) {
    return path.resolve(configuredBase);
  }

  const homeDirectory = os.homedir() || process.cwd();
  const documentsDirectory = path.join(homeDirectory, "Documents");

  return path.join(documentsDirectory, "Ranni-Workspace");
}

async function ensureSessionWorkspace(workspaceRoot?: string) {
  const resolvedWorkspaceRoot = workspaceRoot
    ? path.resolve(workspaceRoot)
    : path.join(defaultWorkspaceBase(), "ranni-session-html-pptx-spike");

  if (!path.basename(resolvedWorkspaceRoot).startsWith("ranni-session-")) {
    throw new Error("workspace 必须是 ranni-session-* 目录。");
  }

  await fs.mkdir(resolvedWorkspaceRoot, { recursive: true });

  return resolvedWorkspaceRoot;
}

async function runTool(name: string, args: unknown, workspaceRoot: string) {
  const entry = tools.find((tool) => tool.tool.name === name);

  if (!entry) {
    throw new Error(`未找到工具：${name}`);
  }

  const result = await entry.execute(args, {
    activeSkillNames: ["slides"],
    workspaceRoot,
  });

  console.log(`\n[${name}]\n${result}`);
}

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function assertCondition(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`E2E 验证失败：${message}`);
  }
}

async function verifyE2EArtifacts(
  workspaceRoot: string,
  dir: string,
  finalPptx: string,
) {
  const requiredPaths = [
    `${dir}/prompt.txt`,
    `${dir}/html-generation-report.json`,
    `${dir}/deck.html`,
    `${dir}/deck.prepared.html`,
    `${dir}/styles.css`,
    `${dir}/measurements.json`,
    `${dir}/qa-report.json`,
    finalPptx,
  ];

  for (const requiredPath of requiredPaths) {
    assertCondition(
      await pathExists(path.join(workspaceRoot, requiredPath)),
      `缺少产物 ${requiredPath}`,
    );
  }

  const preparedHtml = await fs.readFile(
    path.join(workspaceRoot, dir, "deck.prepared.html"),
    "utf8",
  );
  const sourceHtml = await fs.readFile(
    path.join(workspaceRoot, dir, "deck.html"),
    "utf8",
  );
  const sourceCss = await fs.readFile(
    path.join(workspaceRoot, dir, "styles.css"),
    "utf8",
  );

  assertCondition(
    preparedHtml.includes('data-pptx-fallback="true"'),
    "prepared HTML 未检测到截图回退 img。",
  );
  assertCondition(
    !/<[^>]+\sdata-pptx-raster(?:[=>\s]|$)/.test(preparedHtml),
    "prepared HTML 仍残留 data-pptx-raster 节点。",
  );
  assertCondition(
    sourceHtml.includes("timeline-rail") &&
      sourceHtml.includes("timeline-node"),
    "时间线样例缺少 PPTX 友好的轨道或节点视觉层级。",
  );
  assertCondition(
    !/\bbox-shadow\s*:/i.test(sourceCss),
    "样例 CSS 不应依赖 box-shadow 修复视觉层级。",
  );

  const pptxStats = await fs.stat(path.join(workspaceRoot, finalPptx));

  assertCondition(pptxStats.size > 100_000, `PPTX 文件过小：${pptxStats.size}`);

  const qaPath = path.join(workspaceRoot, dir, "qa-report.json");
  const qa = JSON.parse(await fs.readFile(qaPath, "utf8")) as {
    designGuidelines?: {
      status: string;
      warnings: unknown[];
    };
    editableElements: number;
    generatedPptxPath: string;
    htmlPreviewPaths: string[];
    pptxInspection: {
      pictureCount: number;
      slideFiles: number;
      textRuns: number;
    };
    pptxPreview: {
      files: string[];
      status: string;
    };
    rasterFallbacks: number;
    slides: number;
    visualSmoke?: {
      available: boolean;
      slides: Array<{
        status: string;
      }>;
      warnings?: unknown[];
    };
    warnings: unknown[];
  };
  const previewPngCount = qa.pptxPreview.files.filter((filePath) =>
    /preview-pptx\/slide-\d+\.png$/.test(filePath),
  ).length;
  const htmlPreviewPngPaths = qa.htmlPreviewPaths.filter((filePath) =>
    filePath.endsWith(".png"),
  );
  const pptxPreviewPngPaths = qa.pptxPreview.files.filter((filePath) =>
    /preview-pptx\/slide-\d+\.png$/.test(filePath),
  );

  assertCondition(qa.slides === 8, `slide 数应为 8，实际 ${qa.slides}`);
  assertCondition(
    qa.editableElements >= 40,
    `可编辑元素数量过低：${qa.editableElements}`,
  );
  assertCondition(
    qa.rasterFallbacks >= 1,
    `应至少产生 1 个截图回退，实际 ${qa.rasterFallbacks}`,
  );
  assertCondition(
    qa.generatedPptxPath === finalPptx,
    `PPTX 路径不一致：${qa.generatedPptxPath}`,
  );
  assertCondition(
    qa.warnings.length === 0,
    `qa-report 仍有 warning：${JSON.stringify(qa.warnings)}`,
  );
  assertCondition(
    qa.designGuidelines?.status === "passed",
    `设计准则检查未通过：${JSON.stringify(qa.designGuidelines)}`,
  );
  assertCondition(
    qa.pptxInspection.slideFiles === qa.slides,
    `PPTX slide XML 数不匹配：${qa.pptxInspection.slideFiles}`,
  );
  assertCondition(
    qa.pptxInspection.textRuns > 0,
    "PPTX 中未检测到可编辑文本 run。",
  );
  assertCondition(
    qa.pptxInspection.pictureCount >= qa.rasterFallbacks,
    "PPTX 图片对象数量低于截图回退数量。",
  );
  assertCondition(
    qa.htmlPreviewPaths.length === qa.slides,
    `HTML preview 数不匹配：${qa.htmlPreviewPaths.length}`,
  );
  assertCondition(
    qa.pptxPreview.status === "rendered",
    `PPTX preview 状态应为 rendered，实际 ${qa.pptxPreview.status}`,
  );
  assertCondition(
    previewPngCount === qa.slides,
    `PPTX preview PNG 数应为 ${qa.slides}，实际 ${previewPngCount}`,
  );
  const visualSmoke = qa.visualSmoke;

  assertCondition(
    visualSmoke?.available === true,
    `visualSmoke 应可用：${JSON.stringify(visualSmoke)}`,
  );
  assertCondition(
    (visualSmoke?.slides.length ?? 0) === qa.slides,
    `visualSmoke 页数应为 ${qa.slides}，实际 ${visualSmoke?.slides.length ?? 0}`,
  );
  assertCondition(
    visualSmoke?.slides.every((slide) => slide.status === "ok") === true,
    `visualSmoke 存在异常：${JSON.stringify(visualSmoke)}`,
  );

  for (const previewPath of [...htmlPreviewPngPaths, ...pptxPreviewPngPaths]) {
    const stats = await fs.stat(path.join(workspaceRoot, previewPath));

    assertCondition(
      stats.size > 10_000,
      `预览图片过小，可能为空白：${previewPath} (${stats.size} bytes)`,
    );
  }

  return qa;
}

async function main() {
  const options = parseCliOptions();
  const workspaceRoot = await ensureSessionWorkspace(options.workspaceRoot);
  const finalPptx = `${options.dir}/final/${sanitizePathSegment(
    options.deckSlug,
  )}.pptx`;

  await runTool(
    "init_slide_html_workspace",
    {
      deckSlug: options.deckSlug,
      dir: options.dir,
      overwrite: options.overwrite,
      prompt: options.prompt,
      template: "spike-sample",
      title: options.title,
    },
    workspaceRoot,
  );
  await runTool(
    "prepare_slide_html_for_pptx",
    {
      html: `${options.dir}/deck.html`,
      measurementsPath: `${options.dir}/measurements.json`,
      outHtml: `${options.dir}/deck.prepared.html`,
    },
    workspaceRoot,
  );
  await runTool(
    "export_html_to_pptx",
    {
      html: `${options.dir}/deck.prepared.html`,
      outPptx: finalPptx,
      title: options.title,
    },
    workspaceRoot,
  );
  await runTool(
    "validate_html_pptx_export",
    {
      html: `${options.dir}/deck.html`,
      measurementsPath: `${options.dir}/measurements.json`,
      pptx: finalPptx,
      preparedHtml: `${options.dir}/deck.prepared.html`,
      qaReportPath: `${options.dir}/qa-report.json`,
    },
    workspaceRoot,
  );

  const qa = await verifyE2EArtifacts(workspaceRoot, options.dir, finalPptx);

  console.log(`\nWorkspace: ${workspaceRoot}`);
  console.log(`Deck: ${path.join(workspaceRoot, finalPptx)}`);
  console.log(`QA: ${path.join(workspaceRoot, options.dir, "qa-report.json")}`);
  console.log(
    `E2E: prompt -> HTML -> prepared HTML -> PPTX -> rendered preview 已通过。slides=${qa.slides}, editable=${qa.editableElements}, raster=${qa.rasterFallbacks}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
