import type { ReceiptProjector } from "../receipts/registry";
import type { ReceiptProjection } from "../receipts/types";
import { getToolDefinitions } from "../tools";
import type { DeliverableContract } from "../acceptance";

export type SlideArtifactPhase = "off" | "slides" | "styles";

const UNSAFE_BYPASS_TOOLS = new Set([
  "delete_path",
  "move_path",
  "run_terminal",
  "write_file",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown, key: string) {
  return isRecord(value) && typeof value[key] === "string"
    ? value[key].trim()
    : "";
}

function readStringArray(value: unknown, key: string) {
  return isRecord(value) && Array.isArray(value[key])
    ? value[key].filter(
        (item): item is string => typeof item === "string" && Boolean(item.trim()),
      )
    : [];
}

function resultPath(result: string, label: string) {
  return result.match(new RegExp(`^${label}：(.+)$`, "m"))?.[1]?.trim();
}

export function getHtmlToPptxToolDefinitions(
  activeSkillNames: readonly string[] = [],
  phase: SlideArtifactPhase = "off",
) {
  const definitions = getToolDefinitions(activeSkillNames);

  if (phase === "off") {
    return definitions;
  }

  return definitions.filter((definition) => !UNSAFE_BYPASS_TOOLS.has(definition.name));
}

export function isToolAllowedForExecution(
  toolName: string,
  requestedToolNames: ReadonlySet<string>,
  currentToolNames: ReadonlySet<string>,
) {
  return requestedToolNames.has(toolName) && currentToolNames.has(toolName);
}

export function createHtmlToPptxDeliverableContract(
  prompt: string,
): DeliverableContract {
  const requestedPageCount = Number(
    prompt.match(/(?:分\s*)?(\d+)\s*页/i)?.[1] ?? Number.NaN,
  );
  const pageCount = Number.isFinite(requestedPageCount)
    ? requestedPageCount
    : undefined;

  return {
    criteria: [
      {
        description: "页面清单已经由工件工具固定",
        id: "manifest",
        kind: "artifact",
        required: true,
        target: "manifest",
      },
      {
        description: "全局样式已经组装并通过工件防线",
        id: "styles",
        kind: "artifact",
        required: true,
        target: "styles",
      },
      {
        description: pageCount
          ? `${pageCount} 个页面 fragment 已通过逐页硬约束`
          : "页面 fragment 已通过逐页硬约束",
        id: "slides",
        kind: "artifact",
        ...(pageCount ? { minimumCount: pageCount } : {}),
        required: true,
        target: "slide",
      },
      {
        description: "页面已经确定性组装为 deck",
        id: "deck",
        kind: "artifact",
        required: true,
        target: "deck",
      },
      {
        description: "PPTX 文件已经真实导出",
        id: "pptx",
        kind: "artifact",
        required: true,
        target: "pptx",
      },
      {
        description: "HTML-to-PPTX 最终 QA 已通过",
        id: "pptx-validation",
        kind: "verification",
        required: true,
        target: "html-to-pptx",
      },
      ...(pageCount
        ? [
            {
              description: `最终验证确认 PPTX 恰好包含 ${pageCount} 页`,
              id: "pptx-page-count",
              kind: "page-count" as const,
              minimumCount: pageCount,
              required: true,
              target: "html-to-pptx",
            },
          ]
        : []),
    ],
    textOnly: false,
    type: "pptx",
    verificationRequired: true,
  };
}

export const projectHtmlToPptxReceipt: ReceiptProjector = ({
  result,
  success,
  toolCall,
}) => {
  if (!success) {
    return toolCall.name === "validate_html_pptx_export"
      ? {
          verification: [
            {
              details: [result],
              passed: false,
              scope: "html-to-pptx",
            },
          ],
        }
      : null;
  }
  const deckDir = readString(toolCall.input, "deckDir") || ".";
  const artifacts: NonNullable<ReceiptProjection["artifacts"]> = [];
  const files: NonNullable<ReceiptProjection["files"]> = [];
  const verification: NonNullable<ReceiptProjection["verification"]> = [];

  if (toolCall.name === "init_slide_html_workspace") {
    const directory = resultPath(result, "目录") || deckDir;
    artifacts.push({
      key: `workspace:${directory}`,
      kind: "slide-workspace",
      path: directory,
      status: "accepted",
    });
  } else if (toolCall.name === "set_slide_manifest") {
    const slideIds = readStringArray(toolCall.input, "slideIds");
    const path = resultPath(result, "路径") || `${deckDir}/slide-manifest.json`;
    artifacts.push({
      count: slideIds.length,
      key: `manifest:${deckDir}`,
      kind: "manifest",
      path,
      status: "accepted",
    });
    files.push({ path, toolName: toolCall.name });
  } else if (toolCall.name === "write_style_fragment") {
    const styleId = readString(toolCall.input, "styleId");
    const path = resultPath(result, "路径") || `${deckDir}/styles/${styleId}.css`;
    artifacts.push({
      key: `style:${deckDir}:${styleId}`,
      kind: "style-fragment",
      path,
      status: "draft",
    });
    files.push({ path, toolName: toolCall.name });
  } else if (toolCall.name === "assemble_deck_styles") {
    const path = resultPath(result, "路径") || `${deckDir}/styles.css`;
    artifacts.push({
      key: `styles:${deckDir}`,
      kind: "styles",
      path,
      status: "accepted",
    });
    files.push({ path, toolName: toolCall.name });
  } else if (["write_slide_fragment", "patch_slide_fragment"].includes(toolCall.name)) {
    const slideId = readString(toolCall.input, "slideId");
    const path = resultPath(result, "accepted") || `${deckDir}/slides/${slideId}.html`;
    const hash = result.match(/^hash：(.+)$/m)?.[1]?.trim();
    artifacts.push({
      ...(hash ? { hash } : {}),
      key: `slide:${deckDir}:${slideId}`,
      kind: "slide",
      path,
      status: "accepted",
    });
    files.push({ ...(hash ? { hash } : {}), path, toolName: toolCall.name });
  } else if (toolCall.name === "assemble_slide_deck") {
    const path = resultPath(result, "HTML") || `${deckDir}/deck.html`;
    const count = Number(result.match(/^页面数：(\d+)$/m)?.[1] ?? Number.NaN);
    artifacts.push({
      ...(Number.isFinite(count) ? { count } : {}),
      key: `deck:${deckDir}`,
      kind: "deck",
      path,
      status: "accepted",
    });
    files.push({ path, toolName: toolCall.name });
  } else if (toolCall.name === "prepare_slide_html_for_pptx") {
    const path = resultPath(result, "Prepared HTML");
    artifacts.push({
      key: `prepared:${path || deckDir}`,
      kind: "prepared-html",
      ...(path ? { path } : {}),
      status: "prepared",
    });
    if (path) files.push({ path, toolName: toolCall.name });
  } else if (toolCall.name === "export_html_to_pptx") {
    const path = resultPath(result, "路径") || readString(toolCall.input, "outPptx");
    artifacts.push({
      key: `pptx:${path || deckDir}`,
      kind: "pptx",
      ...(path ? { path } : {}),
      status: "exported",
    });
    if (path) files.push({ path, toolName: toolCall.name });
  } else if (toolCall.name === "validate_html_pptx_export") {
    const slideCount = Number(result.match(/^slide 数：(\d+)$/m)?.[1] ?? Number.NaN);
    const pptx = readString(toolCall.input, "pptx");
    artifacts.push({
      ...(Number.isFinite(slideCount) ? { count: slideCount } : {}),
      key: `pptx:${pptx || deckDir}`,
      kind: "pptx",
      ...(pptx ? { path: pptx } : {}),
      status: "validated",
    });
    verification.push({
      details: [result],
      passed: true,
      scope: "html-to-pptx",
      ...(Number.isFinite(slideCount) ? { slideCount } : {}),
    });
  }

  return artifacts.length || files.length || verification.length
    ? { artifacts, files, verification }
    : null;
};
