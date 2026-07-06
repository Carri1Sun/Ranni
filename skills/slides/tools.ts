import fs from "node:fs/promises";
import path from "node:path";

import pptxgen from "pptxgenjs";
import { z } from "zod";

import type { ToolDefinition, ToolExecutionContext } from "../../lib/tools";
import { resolveWorkspacePath, toWorkspaceRelative } from "../../lib/workspace";

type Theme = {
  aspect: "16:9" | "4:3";
  bodySize: number;
  captionSize: number;
  colors: {
    accent: string;
    accentSoft: string;
    background: string;
    body: string;
    muted: string;
    sectionBackground: string;
    sectionTitle: string;
    title: string;
  };
  fontFace: string;
  gap: number;
  margins: {
    x: number;
    y: number;
  };
  name: string;
  titleSize: number;
};

type Box = {
  h: number;
  w: number;
  x: number;
  y: number;
};

type TextBox = Box & {
  align?: "center" | "left";
  bold?: boolean;
  color?: string;
  fontSize?: number;
  valign?: "middle" | "top";
};

type LayoutSlots = {
  body?: TextBox;
  image?: Box;
  left?: TextBox;
  right?: TextBox;
  title?: TextBox;
};

const layoutSchema = z
  .enum(["title", "title-bullets", "title-content", "two-col", "section", "blank"])
  .default("title-bullets");

const bulletSchema = z.union([
  z.string(),
  z.object({
    level: z.number().int().min(0).max(3).default(0),
    text: z.string().min(1),
  }),
]);

const chartSeriesSchema = z.object({
  labels: z.array(z.string()).min(1),
  name: z.string().min(1),
  values: z.array(z.number()).min(1),
});

const generatePptxSchema = z.object({
  aspect: z.enum(["16:9", "4:3"]).default("16:9"),
  outputPath: z.string().min(1),
  slides: z
    .array(
      z.object({
        bullets: z.array(bulletSchema).optional(),
        chart: z
          .object({
            data: z.array(chartSeriesSchema).min(1),
            title: z.string().optional(),
            type: z.enum(["bar", "line", "pie"]),
          })
          .optional(),
        image: z
          .object({
            path: z.string().min(1),
            placement: z.enum(["fit", "fill"]).default("fit"),
          })
          .optional(),
        layout: layoutSchema,
        notes: z.string().optional(),
        subtitle: z.string().optional(),
        title: z.string().default(""),
      }),
    )
    .min(1),
  theme: z.string().default("default"),
});

const initDeckSchema = z.object({
  audience: z.string().optional(),
  delivery: z.enum(["self-read", "speaker-led", "forward"]).default("self-read"),
  dir: z.string().min(1),
  title: z.string().min(1),
});

const SKILL_DIR = __dirname;

function canvasSize(aspect: "16:9" | "4:3") {
  return aspect === "4:3" ? { h: 7.5, w: 10 } : { h: 7.5, w: 13.333 };
}

async function loadTheme(name: string): Promise<Theme> {
  const filePath = path.join(SKILL_DIR, "templates", `${name}.theme.json`);
  const raw = await fs.readFile(filePath, "utf8");

  return JSON.parse(raw) as Theme;
}

function resolveLayout(
  layout: z.infer<typeof layoutSchema>,
  theme: Theme,
  aspect: "16:9" | "4:3",
): LayoutSlots {
  const { h: slideH, w: slideW } = canvasSize(aspect);
  const marginX = theme.margins.x;
  const marginY = theme.margins.y;
  const contentW = slideW - marginX * 2;
  const title: TextBox = {
    x: marginX,
    y: marginY,
    w: contentW,
    h: 0.8,
    bold: true,
    color: theme.colors.title,
    fontSize: theme.titleSize,
  };
  const body: TextBox = {
    x: marginX,
    y: marginY + 1.1,
    w: contentW,
    h: slideH - marginY * 2 - 1.1,
    color: theme.colors.body,
    fontSize: theme.bodySize,
  };

  if (layout === "blank") {
    return {};
  }

  if (layout === "title") {
    return {
      title: {
        x: marginX,
        y: slideH * 0.35,
        w: contentW,
        h: 1.1,
        align: "center",
        bold: true,
        color: theme.colors.title,
        fontSize: theme.titleSize + 8,
        valign: "middle",
      },
      body: {
        x: marginX + contentW * 0.14,
        y: slideH * 0.52,
        w: contentW * 0.72,
        h: 1,
        align: "center",
        color: theme.colors.muted,
        fontSize: theme.bodySize + 2,
      },
    };
  }

  if (layout === "section") {
    return {
      title: {
        x: marginX,
        y: slideH * 0.38,
        w: contentW,
        h: 1,
        align: "center",
        bold: true,
        color: theme.colors.sectionTitle,
        fontSize: theme.titleSize + 4,
        valign: "middle",
      },
      body: {
        x: marginX + contentW * 0.18,
        y: slideH * 0.54,
        w: contentW * 0.64,
        h: 0.9,
        align: "center",
        color: theme.colors.accentSoft,
        fontSize: theme.bodySize,
      },
    };
  }

  if (layout === "title-content") {
    return {
      title,
      body: {
        ...body,
        fontSize: theme.bodySize + 2,
      },
      image: {
        x: marginX,
        y: marginY + 1.15,
        w: contentW,
        h: slideH - marginY * 2 - 1.2,
      },
    };
  }

  if (layout === "two-col") {
    const colW = (contentW - theme.gap) / 2;

    return {
      title,
      left: {
        x: marginX,
        y: marginY + 1.15,
        w: colW,
        h: slideH - marginY * 2 - 1.2,
        color: theme.colors.body,
        fontSize: theme.bodySize,
      },
      right: {
        x: marginX + colW + theme.gap,
        y: marginY + 1.15,
        w: colW,
        h: slideH - marginY * 2 - 1.2,
        color: theme.colors.body,
        fontSize: theme.bodySize,
      },
      image: {
        x: marginX + colW + theme.gap,
        y: marginY + 1.15,
        w: colW,
        h: slideH - marginY * 2 - 1.2,
      },
    };
  }

  return {
    title,
    body,
  };
}

function toTextOptions(box: TextBox, theme: Theme): pptxgen.TextPropsOptions {
  return {
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    align: box.align,
    bold: box.bold,
    breakLine: false,
    color: box.color ?? theme.colors.body,
    fit: "shrink",
    fontFace: theme.fontFace,
    fontSize: box.fontSize,
    margin: 0.06,
    valign: box.valign,
  };
}

function normalizeBullets(bullets: z.infer<typeof bulletSchema>[]) {
  return bullets.map((bullet) =>
    typeof bullet === "string"
      ? {
          text: bullet,
          options: {
            bullet: { indent: 14 },
            hanging: 4,
          },
        }
      : {
          text: bullet.text,
          options: {
            bullet: { indent: 14 + bullet.level * 14 },
            hanging: 4,
            indentLevel: bullet.level,
          },
        },
  );
}

function splitBulletsForColumns(bullets: z.infer<typeof bulletSchema>[]) {
  const midpoint = Math.ceil(bullets.length / 2);

  return [bullets.slice(0, midpoint), bullets.slice(midpoint)] as const;
}

function chartType(type: "bar" | "line" | "pie") {
  return type;
}

function addBullets(
  slide: pptxgen.Slide,
  bullets: z.infer<typeof bulletSchema>[] | undefined,
  box: TextBox | undefined,
  theme: Theme,
) {
  if (!bullets?.length || !box) {
    return;
  }

  slide.addText(normalizeBullets(bullets), {
    ...toTextOptions(box, theme),
    breakLine: true,
    fit: "shrink",
  });
}

function addImage(
  slide: pptxgen.Slide,
  image: { path: string; placement: "fit" | "fill" },
  box: Box,
  context: ToolExecutionContext,
) {
  const imagePath = resolveWorkspacePath(image.path, context.workspaceRoot);

  slide.addImage({
    path: imagePath,
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    sizing: {
      type: image.placement === "fill" ? "crop" : "contain",
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
    },
  });
}

async function generatePptx(
  rawArgs: unknown,
  context: ToolExecutionContext,
) {
  const args = generatePptxSchema.parse(rawArgs);
  const theme = await loadTheme(args.theme);
  const pres = new pptxgen();

  pres.author = "Ranni";
  pres.company = "Ranni";
  pres.subject = "Generated editable presentation";
  pres.layout = args.aspect === "4:3" ? "LAYOUT_4X3" : "LAYOUT_WIDE";
  pres.theme = {
    headFontFace: theme.fontFace,
    bodyFontFace: theme.fontFace,
  };

  for (const spec of args.slides) {
    const slots = resolveLayout(spec.layout, theme, args.aspect);
    const slide = pres.addSlide();

    slide.background = {
      color:
        spec.layout === "section"
          ? theme.colors.sectionBackground
          : theme.colors.background,
    };

    if (spec.title && slots.title) {
      slide.addText(spec.title, toTextOptions(slots.title, theme));
    }

    if (spec.subtitle && slots.body && spec.layout === "title") {
      slide.addText(spec.subtitle, toTextOptions(slots.body, theme));
    }

    if (spec.layout === "two-col" && spec.bullets?.length) {
      const [leftBullets, rightBullets] = splitBulletsForColumns(spec.bullets);
      addBullets(slide, leftBullets, slots.left, theme);
      addBullets(slide, rightBullets, slots.right, theme);
    } else {
      addBullets(slide, spec.bullets, slots.body, theme);
    }

    if (spec.image) {
      addImage(slide, spec.image, slots.image ?? slots.body ?? slots.left ?? slots.title!, context);
    }

    if (spec.chart) {
      const chartBox = slots.image ?? slots.right ?? slots.body ?? {
        x: 1,
        y: 1.6,
        w: 6,
        h: 4,
      };

      slide.addChart(chartType(spec.chart.type), spec.chart.data, {
        x: chartBox.x,
        y: chartBox.y,
        w: chartBox.w,
        h: chartBox.h,
        showLegend: spec.chart.type !== "pie",
        showTitle: Boolean(spec.chart.title),
        title: spec.chart.title,
        valAxisLabelFontFace: theme.fontFace,
        catAxisLabelFontFace: theme.fontFace,
      });
    }

    if (spec.notes) {
      slide.addNotes(spec.notes);
    }
  }

  const outputPath = args.outputPath.endsWith(".pptx")
    ? args.outputPath
    : `${args.outputPath}.pptx`;
  const outputAbsolutePath = resolveWorkspacePath(outputPath, context.workspaceRoot);

  await fs.mkdir(path.dirname(outputAbsolutePath), { recursive: true });
  await pres.writeFile({ fileName: outputAbsolutePath });

  return [
    "已生成可编辑 native PPTX。",
    `路径：${toWorkspaceRelative(outputAbsolutePath, context.workspaceRoot)}`,
    `页数：${args.slides.length}`,
    "可编辑性：标题和正文使用 PowerPoint 文本对象，简单图表使用 native chart。",
  ].join("\n");
}

async function initDeckWorkspace(
  rawArgs: unknown,
  context: ToolExecutionContext,
) {
  const args = initDeckSchema.parse(rawArgs);
  const baseAbsolutePath = resolveWorkspacePath(args.dir, context.workspaceRoot);

  for (const subDirectory of [
    "assets",
    "final",
    "preview",
    "validation",
    "validation/package_preflight",
    "validation/structure_precheck",
    "validation/render_review",
  ]) {
    await fs.mkdir(path.join(baseAbsolutePath, subDirectory), {
      recursive: true,
    });
  }

  const brief = [
    "---",
    `title: ${JSON.stringify(args.title)}`,
    `audience: ${JSON.stringify(args.audience ?? "")}`,
    `delivery: ${args.delivery}`,
    "editability: editable",
    "aspect: \"16:9\"",
    "theme: default",
    "---",
    "",
    "# Deck Brief",
    "",
    "- 目标读者：",
    "- 使用场景：",
    "- 目标动作：",
    "- 视觉方向：",
    "- 信息密度：",
  ].join("\n");
  const narrative = [
    `# ${args.title}`,
    "",
    "## 顶层叙事",
    "",
    "- 开场：",
    "- 论证：",
    "- 结论：",
    "",
    "## 每页任务",
    "",
    "在这里记录 reader_question、page_task、key_message 和资产路由。",
  ].join("\n");
  const slideSpecs = [
    "# P0 slide specs",
    "# slides:",
    "#   - layout: title-bullets",
    "#     title: 示例标题",
    "#     bullets:",
    "#       - 示例要点",
    "slides: []",
  ].join("\n");

  await fs.writeFile(path.join(baseAbsolutePath, "brief.md"), brief, "utf8");
  await fs.writeFile(
    path.join(baseAbsolutePath, "deck_narrative.md"),
    narrative,
    "utf8",
  );
  await fs.writeFile(
    path.join(baseAbsolutePath, "slide_specs.yaml"),
    slideSpecs,
    "utf8",
  );

  return [
    "已初始化 deck 产物目录。",
    `目录：${toWorkspaceRelative(baseAbsolutePath, context.workspaceRoot)}`,
    "包含：brief.md / deck_narrative.md / slide_specs.yaml / assets/ / final/ / preview/ / validation/",
  ].join("\n");
}

export const tools: ToolDefinition[] = [
  {
    schema: initDeckSchema,
    tool: {
      name: "init_deck_workspace",
      description:
        "Initialize a deck artifact directory with brief.md, deck_narrative.md, slide_specs.yaml, assets/, final/, preview/, and validation/. Use before generate_pptx for non-trivial presentation work.",
      input_schema: {
        type: "object",
        properties: {
          audience: {
            type: "string",
            description: "Audience for the deck.",
          },
          delivery: {
            type: "string",
            enum: ["self-read", "speaker-led", "forward"],
            default: "self-read",
          },
          dir: {
            type: "string",
            description: "Deck artifact directory.",
          },
          title: {
            type: "string",
            description: "Deck title.",
          },
        },
        required: ["dir", "title"],
      },
    },
    execute: initDeckWorkspace,
  },
  {
    schema: generatePptxSchema,
    tool: {
      name: "generate_pptx",
      description:
        "Generate an editable native .pptx from structured slide specs. Keeps text editable and simple charts native. Use semantic layouts instead of hand-coded coordinates.",
      input_schema: {
        type: "object",
        properties: {
          aspect: {
            type: "string",
            enum: ["16:9", "4:3"],
            default: "16:9",
          },
          outputPath: {
            type: "string",
            description: "Output .pptx path.",
          },
          slides: {
            type: "array",
            minItems: 1,
            description: "Structured slide specs.",
            items: {
              type: "object",
              properties: {
                bullets: {
                  type: "array",
                  items: {
                    anyOf: [
                      { type: "string" },
                      {
                        type: "object",
                        properties: {
                          level: { type: "integer", minimum: 0, maximum: 3 },
                          text: { type: "string" },
                        },
                        required: ["text"],
                      },
                    ],
                  },
                },
                chart: {
                  type: "object",
                  properties: {
                    data: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          labels: {
                            type: "array",
                            items: { type: "string" },
                          },
                          name: { type: "string" },
                          values: {
                            type: "array",
                            items: { type: "number" },
                          },
                        },
                        required: ["name", "labels", "values"],
                      },
                    },
                    title: { type: "string" },
                    type: { type: "string", enum: ["bar", "line", "pie"] },
                  },
                  required: ["type", "data"],
                },
                image: {
                  type: "object",
                  properties: {
                    path: { type: "string" },
                    placement: {
                      type: "string",
                      enum: ["fit", "fill"],
                      default: "fit",
                    },
                  },
                  required: ["path"],
                },
                layout: {
                  type: "string",
                  enum: [
                    "title",
                    "title-bullets",
                    "title-content",
                    "two-col",
                    "section",
                    "blank",
                  ],
                  default: "title-bullets",
                },
                notes: { type: "string" },
                subtitle: { type: "string" },
                title: { type: "string" },
              },
            },
          },
          theme: {
            type: "string",
            default: "default",
          },
        },
        required: ["outputPath", "slides"],
      },
    },
    execute: generatePptx,
  },
];
