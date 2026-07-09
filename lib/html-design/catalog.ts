import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

export type HtmlDesignOption = {
  accentColor: string;
  description: string;
  guidance: string[];
  id: string;
  name: string;
  preview: string;
  surfaceColor: string;
  tags: string[];
};

export type HtmlPageTemplateOption = HtmlDesignOption & {
  sections: string[];
};

type RuntimeInstructionOptions = {
  pageTemplateId?: string;
  styleId?: string;
  targetSkill: "html" | "html-to-pptx";
};

type HtmlDesignCatalogAsset<TOption> = {
  option: TOption;
  referenceMaterialPath?: string;
};

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const htmlDesignAssetFrontmatterSchema = z.object({
  accentColor: hexColorSchema,
  description: z.string().trim().min(1),
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  preview: z.string().trim().min(1),
  surfaceColor: hexColorSchema,
  tags: z.array(z.string().trim().min(1)).min(1),
});

const htmlPagePatternAssetFrontmatterSchema =
  htmlDesignAssetFrontmatterSchema.extend({
    sections: z.array(z.string().trim().min(1)).min(1),
  });

function resolveHtmlDesignCatalogRoot() {
  return path.resolve(process.cwd(), "skills", "html-design");
}

function toProjectPath(filePath: string) {
  return path.relative(process.cwd(), filePath).split(path.sep).join("/");
}

function parseFrontmatterValue(
  value: string,
  filePath: string,
  key: string,
) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  if (
    trimmed.startsWith("[") ||
    trimmed.startsWith("{") ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch (error) {
      throw new Error(
        `${filePath} 的 frontmatter 字段 ${key} 解析失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function parseFrontmatterFields(frontmatter: string, filePath: string) {
  const fields: Record<string, unknown> = {};

  for (const line of frontmatter.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf(":");

    if (separatorIndex === -1) {
      throw new Error(`${filePath} 的 frontmatter 行缺少冒号：${trimmed}`);
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1);

    if (!key) {
      throw new Error(`${filePath} 的 frontmatter 存在空字段名。`);
    }

    fields[key] = parseFrontmatterValue(value, filePath, key);
  }

  return fields;
}

function readMarkdownCatalogAsset(filePath: string) {
  const normalized = fs
    .readFileSync(filePath, "utf8")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n");

  if (!normalized.startsWith("---\n")) {
    throw new Error(`${filePath} 缺少 frontmatter。`);
  }

  const endIndex = normalized.indexOf("\n---", 4);

  if (endIndex === -1) {
    throw new Error(`${filePath} 的 frontmatter 未闭合。`);
  }

  const frontmatter = normalized.slice(4, endIndex).trim();
  const body = normalized.slice(endIndex + "\n---".length).replace(/^\s*\n/, "");

  return {
    body: body.trim(),
    fields: parseFrontmatterFields(frontmatter, filePath),
  };
}

function parseGuidanceBody(body: string, filePath: string) {
  const guidance: string[] = [];
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }

    guidance.push(paragraph.join(" "));
    paragraph = [];
  };

  for (const line of body.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    if (/^#+\s+/.test(trimmed)) {
      flushParagraph();
      continue;
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/);

    if (bullet) {
      flushParagraph();
      guidance.push(bullet[1].trim());
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();

  if (guidance.length === 0) {
    throw new Error(`${filePath} 缺少正文 guidance。`);
  }

  return guidance;
}

function toLoadErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function loadCatalogDirectory<TFrontmatter, TOption>({
  createOption,
  directoryName,
  schema,
}: {
  createOption: (frontmatter: TFrontmatter, guidance: string[]) => TOption;
  directoryName: "patterns" | "styles";
  schema: z.ZodType<TFrontmatter>;
}): HtmlDesignCatalogAsset<TOption>[] {
  const directoryPath = path.join(resolveHtmlDesignCatalogRoot(), directoryName);

  if (!fs.existsSync(directoryPath)) {
    return [];
  }

  let entries: fs.Dirent[];

  try {
    entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  } catch (error) {
    console.warn(
      `Failed to read HTML design catalog directory ${directoryPath}:`,
      toLoadErrorMessage(error),
    );
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const assetDirectoryPath = path.join(directoryPath, entry.name);
      const filePath = path.join(assetDirectoryPath, "guide.md");
      const referenceMaterialPath = path.join(assetDirectoryPath, "reference.md");

      try {
        const { body, fields } = readMarkdownCatalogAsset(filePath);
        const frontmatter = schema.parse(fields);
        const guidance = parseGuidanceBody(body, filePath);

        return [
          {
            option: createOption(frontmatter, guidance),
            referenceMaterialPath: fs.existsSync(referenceMaterialPath)
              ? toProjectPath(referenceMaterialPath)
              : undefined,
          },
        ];
      } catch (error) {
        console.warn(
          `Failed to load HTML design catalog asset ${filePath}:`,
          toLoadErrorMessage(error),
        );
        return [];
      }
    });
}

function listHtmlDesignStyleAssets() {
  return loadCatalogDirectory({
    createOption: (frontmatter, guidance) => ({
      ...frontmatter,
      guidance,
    }),
    directoryName: "styles",
    schema: htmlDesignAssetFrontmatterSchema,
  });
}

function listHtmlPageTemplateAssets() {
  return loadCatalogDirectory({
    createOption: (frontmatter, guidance) => ({
      ...frontmatter,
      guidance,
    }),
    directoryName: "patterns",
    schema: htmlPagePatternAssetFrontmatterSchema,
  });
}

export function listHtmlDesignStyles(): HtmlDesignOption[] {
  return listHtmlDesignStyleAssets().map((asset) => asset.option);
}

export function listHtmlPageTemplates(): HtmlPageTemplateOption[] {
  return listHtmlPageTemplateAssets().map((asset) => asset.option);
}

export function getDefaultHtmlDesignStyleId() {
  return listHtmlDesignStyles()[0]?.id ?? "";
}

export function getDefaultHtmlPageTemplateId() {
  return listHtmlPageTemplates()[0]?.id ?? "";
}

export function findHtmlDesignStyle(styleId?: string) {
  const styles = listHtmlDesignStyleAssets().map((asset) => asset.option);
  const normalizedId = styleId?.trim();

  if (normalizedId) {
    return styles.find((style) => style.id === normalizedId);
  }

  return styles[0];
}

export function findHtmlPageTemplate(templateId?: string) {
  const pageTemplates = listHtmlPageTemplateAssets().map(
    (asset) => asset.option,
  );
  const normalizedId = templateId?.trim();

  if (normalizedId) {
    return pageTemplates.find((template) => template.id === normalizedId);
  }

  return pageTemplates[0];
}

function findHtmlDesignStyleAsset(styleId?: string) {
  const styles = listHtmlDesignStyleAssets();
  const normalizedId = styleId?.trim();

  if (normalizedId) {
    return styles.find((style) => style.option.id === normalizedId);
  }

  return styles[0];
}

function findHtmlPageTemplateAsset(templateId?: string) {
  const pageTemplates = listHtmlPageTemplateAssets();
  const normalizedId = templateId?.trim();

  if (normalizedId) {
    return pageTemplates.find((template) => template.option.id === normalizedId);
  }

  return pageTemplates[0];
}

export function buildHtmlDesignRuntimeInstruction({
  pageTemplateId,
  styleId,
  targetSkill,
}: RuntimeInstructionOptions) {
  const styleAsset = findHtmlDesignStyleAsset(styleId);
  const pageTemplateAsset =
    targetSkill === "html"
      ? findHtmlPageTemplateAsset(pageTemplateId)
      : undefined;
  const style = styleAsset?.option;
  const pageTemplate = pageTemplateAsset?.option;

  if (!style && !pageTemplate) {
    return [];
  }

  const lines = [
    "HTML design selection:",
    `- Target skill: ${targetSkill}`,
  ];

  if (style) {
    lines.push(
      `- Design style id: ${style.id}`,
      `- Design style name: ${style.name}`,
      `- Style description: ${style.description}`,
      "- Style rules:",
      ...style.guidance.map((rule) => `  - ${rule}`),
    );

    if (styleAsset.referenceMaterialPath) {
      lines.push(`- Design style 参考资料: ${styleAsset.referenceMaterialPath}`);
    }
  }

  if (pageTemplate) {
    lines.push(
      `- HTML page template id: ${pageTemplate.id}`,
      `- HTML page template name: ${pageTemplate.name}`,
      `- Template description: ${pageTemplate.description}`,
      `- Required section pattern: ${pageTemplate.sections.join(" / ")}`,
      "- Template rules:",
      ...pageTemplate.guidance.map((rule) => `  - ${rule}`),
    );

    if (pageTemplateAsset.referenceMaterialPath) {
      lines.push(
        `- HTML page template 参考资料: ${pageTemplateAsset.referenceMaterialPath}`,
      );
    }
  }

  if (lines.some((line) => line.includes("参考资料:"))) {
    lines.push(
      "- 在需要更细致的设计思路了解时，阅读参考资料；参考资料已包含本地化来源笔记，不需要访问外部 URL。",
    );
  }

  if (targetSkill === "html") {
    lines.push(
      "- When creating a static webpage, call init_html_workspace with the selected styleId and templateId, then edit index.html and styles.css inside the session workspace.",
      "- The webpage must be responsive, accessible, and previewable as static HTML. Keep generated files in the session workspace.",
    );
  } else {
    lines.push(
      "- When creating PPTX, apply the selected design style within the restricted slide HTML rules. Do not use responsive webpage-only layout behavior inside fixed 1280x720 slides.",
      "- Before editing slide HTML, plan the deck narrative, slide list, visual system, content density, and which complex visuals need local raster fallback.",
      "- Create slide layouts from the user's content and the selected style. Do not rely on a fixed PPTX template package.",
      "- A good PPTX has one clear job per slide, strong hierarchy, readable text, deliberate whitespace, consistent alignment, stable assets, and editable core text.",
    );
  }

  return [...lines, ""];
}
