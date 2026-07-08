import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

const templateLayoutSchema = z.object({
  file: z.string().min(1),
  id: z.string().min(1),
  name: z.string().min(1),
  required: z.boolean().optional(),
});

const templateManifestSchema = z.object({
  compatibility: z
    .object({
      htmlToPptx: z.string().min(1).optional(),
      requiresRasterFallback: z.array(z.string().min(1)).optional(),
    })
    .optional(),
  accentColor: z.string().min(1).optional(),
  default: z.boolean().optional(),
  description: z.string().min(1),
  entryCss: z.string().min(1).default("styles.css"),
  entryHtml: z.string().min(1).default("deck.html"),
  fontPackages: z.array(z.string().min(1)).default([]),
  guidance: z.string().min(1).default("guidance.md"),
  id: z.string().min(1),
  layouts: z.array(templateLayoutSchema).default([]),
  name: z.string().min(1),
  preview: z.string().min(1).optional(),
  surfaceColor: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)).default([]),
  tokens: z.string().min(1).default("tokens.json"),
  version: z.string().min(1).default("v1"),
});

export type HtmlToPptxTemplateManifest = z.infer<typeof templateManifestSchema>;

export type HtmlToPptxTemplateSummary = HtmlToPptxTemplateManifest & {
  directoryName: string;
  guidanceText?: string;
};

function getTemplatesRoot() {
  return path.resolve(process.cwd(), "skills", "html-to-pptx", "templates");
}

function readJsonFile(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
}

function isDirectory(filePath: string) {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function readTemplateManifest(directoryPath: string) {
  const manifestPath = path.join(directoryPath, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    return undefined;
  }

  const parsed = templateManifestSchema.parse(readJsonFile(manifestPath));

  return {
    ...parsed,
    directoryName: path.basename(directoryPath),
  } satisfies HtmlToPptxTemplateSummary;
}

export function listHtmlToPptxTemplates() {
  const templatesRoot = getTemplatesRoot();

  if (!fs.existsSync(templatesRoot)) {
    return [];
  }

  return fs
    .readdirSync(templatesRoot)
    .map((entry) => path.join(templatesRoot, entry))
    .filter(isDirectory)
    .map(readTemplateManifest)
    .filter((item): item is HtmlToPptxTemplateSummary => Boolean(item))
    .sort((left, right) => {
      if (left.default && !right.default) {
        return -1;
      }

      if (!left.default && right.default) {
        return 1;
      }

      return left.name.localeCompare(right.name);
    });
}

export function getDefaultHtmlToPptxTemplateId() {
  const templates = listHtmlToPptxTemplates();

  return templates.find((template) => template.default)?.id ?? templates[0]?.id ?? "default-business";
}

export function findHtmlToPptxTemplate(templateId?: string) {
  const templates = listHtmlToPptxTemplates();
  const normalizedId = templateId?.trim();

  if (normalizedId) {
    return templates.find((template) => template.id === normalizedId);
  }

  return templates.find((template) => template.default) ?? templates[0];
}

export function getHtmlToPptxTemplateDirectory(templateId?: string) {
  const template = findHtmlToPptxTemplate(templateId);

  if (!template) {
    throw new Error("未找到可用 HTML-to-PPTX 模板。");
  }

  return path.join(getTemplatesRoot(), template.directoryName);
}

export function readHtmlToPptxTemplateGuidance(templateId?: string) {
  const template = findHtmlToPptxTemplate(templateId);

  if (!template) {
    return undefined;
  }

  const guidancePath = path.join(
    getTemplatesRoot(),
    template.directoryName,
    template.guidance,
  );

  if (!fs.existsSync(guidancePath)) {
    return undefined;
  }

  return fs.readFileSync(guidancePath, "utf8").trim();
}

export function buildHtmlToPptxTemplateRuntimeInstruction(templateId?: string) {
  const template = findHtmlToPptxTemplate(templateId);

  if (!template) {
    return [];
  }

  const guidance = readHtmlToPptxTemplateGuidance(template.id);
  const layoutList = template.layouts
    .map((layout) => `${layout.id}: ${layout.name}`)
    .join(", ");

  return [
    "HTML-to-PPTX template selection:",
    `- Template id: ${template.id}`,
    `- Template name: ${template.name}`,
    `- Version: ${template.version}`,
    `- Description: ${template.description}`,
    `- Font packages: ${template.fontPackages.join(", ") || "system fonts"}`,
    `- Layouts: ${layoutList || "unspecified"}`,
    "- When creating slide HTML for PPTX export, strictly use this template package. Call init_slide_html_workspace with this templateId, reuse its CSS/classes/layouts, and keep generated reports tied to this template.",
    guidance ? ["", "Template guidance:", guidance].join("\n") : "",
    "",
  ].filter(Boolean);
}
