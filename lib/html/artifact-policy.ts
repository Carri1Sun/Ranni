import type { DeliverableContract } from "../acceptance";
import type { ReceiptProjector } from "../receipts/registry";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown, key: string) {
  return isRecord(value) && typeof value[key] === "string"
    ? value[key].trim()
    : "";
}

function resultPath(result: string, label: string) {
  return result.match(new RegExp(`^${label}：(.+)$`, "m"))?.[1]?.trim();
}

export function createStaticHtmlDeliverableContract(): DeliverableContract {
  return {
    criteria: [
      {
        description: "静态 HTML 文件已经生成",
        id: "static-html",
        kind: "artifact",
        required: true,
        target: "static-html",
      },
      {
        description: "桌面与移动视口的 HTML QA 已通过",
        id: "static-html-validation",
        kind: "verification",
        required: true,
        target: "static-html",
      },
    ],
    textOnly: false,
    type: "static-html",
    verificationRequired: true,
  };
}

export const projectStaticHtmlReceipt: ReceiptProjector = ({
  result,
  success,
  toolCall,
}) => {
  if (!success || toolCall.name !== "validate_static_html") return null;
  const html = readString(toolCall.input, "html");
  const qa = resultPath(result, "QA");
  const previews = (resultPath(result, "预览") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const warningCount = Number(
    result.match(/^warning：(\d+)$/m)?.[1] ?? Number.NaN,
  );
  const passed = Number.isFinite(warningCount) && warningCount === 0;
  const files = [html, qa, ...previews].filter(
    (item): item is string => Boolean(item),
  );

  return {
    artifacts: [
      {
        key: `static-html:${html}`,
        kind: "static-html",
        ...(html ? { path: html } : {}),
        status: passed ? "validated" : "draft",
      },
    ],
    files: files.map((path) => ({ path, toolName: toolCall.name })),
    verification: [
      {
        details: [result],
        passed,
        scope: "static-html",
      },
    ],
  };
};
