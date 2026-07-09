import fs from "node:fs";
import path from "node:path";

import { buildHtmlDesignRuntimeInstruction } from "../html-design/catalog";
import type { ToolSettings } from "../tools";

type RuntimeInstructionContext = {
  activeSkillNames: string[];
  toolSettings?: ToolSettings;
};

type RuntimeInstructionBuilder = {
  build: (context: RuntimeInstructionContext) => string[];
  skillName: string;
};

let cachedHtmlDesignGuideInstruction: string[] | null = null;

function stripFrontmatter(content: string) {
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");

  if (!normalized.startsWith("---\n")) {
    return normalized.trim();
  }

  const endIndex = normalized.indexOf("\n---", 4);

  if (endIndex === -1) {
    return normalized.trim();
  }

  return normalized.slice(endIndex + "\n---".length).trim();
}

function buildHtmlDesignGuideRuntimeInstruction() {
  if (cachedHtmlDesignGuideInstruction) {
    return cachedHtmlDesignGuideInstruction;
  }

  const guidePath = path.resolve(
    process.cwd(),
    "skills",
    "html-design",
    "reference-materials",
    "base-html-design-guide.md",
  );

  try {
    const body = stripFrontmatter(fs.readFileSync(guidePath, "utf8"));

    cachedHtmlDesignGuideInstruction = body
      ? [
          "Base HTML design guide:",
          "Use this guide as the product-level baseline. Selected styles and page patterns are supplemental constraints.",
          body,
          "",
        ]
      : [];
  } catch (error) {
    console.warn(
      `Failed to load HTML design guide runtime instruction from ${guidePath}:`,
      error instanceof Error ? error.message : error,
    );
    cachedHtmlDesignGuideInstruction = [];
  }

  return cachedHtmlDesignGuideInstruction;
}

const runtimeInstructionBuilders = [
  {
    build: ({ toolSettings }) => [
      ...buildHtmlDesignGuideRuntimeInstruction(),
      ...(toolSettings?.htmlDesign
        ? buildHtmlDesignRuntimeInstruction({
            pageTemplateId: toolSettings.htmlDesign.templateId,
            styleId: toolSettings.htmlDesign.styleId,
            targetSkill: "html",
          })
        : []),
    ],
    skillName: "html",
  },
  {
    build: ({ toolSettings }) => [
      ...buildHtmlDesignGuideRuntimeInstruction(),
      ...(toolSettings?.htmlToPptx?.styleId
        ? buildHtmlDesignRuntimeInstruction({
            styleId: toolSettings.htmlToPptx.styleId,
            targetSkill: "html-to-pptx",
          })
        : []),
    ],
    skillName: "html-to-pptx",
  },
] satisfies RuntimeInstructionBuilder[];

export function buildSkillRuntimeInstructions(
  context: RuntimeInstructionContext,
) {
  const activeSkillNames = new Set(context.activeSkillNames);

  return runtimeInstructionBuilders.flatMap((builder) =>
    activeSkillNames.has(builder.skillName) ? builder.build(context) : [],
  );
}
