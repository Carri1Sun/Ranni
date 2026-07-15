import {
  createTextDeliverableContract,
  createWorkspaceArtifactContract,
} from "../acceptance";
import type { RunPolicySet } from "../agent/policy";
import {
  createHtmlToPptxDeliverableContract,
  getHtmlToPptxToolDefinitions,
  projectHtmlToPptxReceipt,
  type SlideArtifactPhase,
} from "../html-to-pptx/artifact-policy";
import { getToolDefinitions } from "../tools";
import {
  createStaticHtmlDeliverableContract,
  projectStaticHtmlReceipt,
} from "../html/artifact-policy";

function isPptxRequest(prompt: string) {
  return /pptx?|幻灯片|演示文稿/i.test(prompt);
}

function isStaticHtmlRequest(prompt: string) {
  return /(?:html|静态网页|网页|网站|landing\s*page|website|webpage)/i.test(
    prompt,
  );
}

function isWorkspaceArtifactRequest(prompt: string) {
  if (/^(?:如何|怎么|怎样)|\bhow\s+to\b/i.test(prompt.trim())) return false;
  const explicitFile =
    /(?:文件|文档|脚本|代码|项目|组件|应用|artifact|\bfile\b|\bscript\b|\bcode\b|\bproject\b|\bcomponent\b|\bapp\b|\.[a-z0-9]{1,8}\b)/i.test(
      prompt,
    );
  const action =
    /(?:创建|生成|制作|编写|写入|修改|更新|修复|实现|重构|搭建|create|generate|build|write|edit|update|fix|implement|refactor)/i.test(
      prompt,
    );
  return explicitFile && action;
}

function requestsVerification(prompt: string) {
  return /(?:验证|测试|检查|构建|typecheck|lint|test|verify|validate|check|build)/i.test(
    prompt,
  );
}

export function createRunPolicySet({
  activeSkillNames,
  prompt,
}: {
  activeSkillNames: string[];
  prompt: string;
}): RunPolicySet {
  const hasSlideArtifact = (skillNames: string[]) =>
    skillNames.includes("html-to-pptx") && isPptxRequest(prompt);
  const hasStaticHtmlArtifact = (skillNames: string[]) =>
    skillNames.includes("html") && isStaticHtmlRequest(prompt);
  const contractFor = (skillNames: string[]) =>
    hasSlideArtifact(skillNames)
      ? createHtmlToPptxDeliverableContract(prompt)
      : hasStaticHtmlArtifact(skillNames)
        ? createStaticHtmlDeliverableContract()
        : isWorkspaceArtifactRequest(prompt)
          ? createWorkspaceArtifactContract({
              verificationRequired: requestsVerification(prompt),
            })
          : createTextDeliverableContract();
  let slideArtifactPhase: SlideArtifactPhase = "off";

  return {
    deliverableContract: contractFor(activeSkillNames),
    getDeliverableContract: contractFor,
    getInstructions(skillNames) {
      if (hasSlideArtifact(skillNames)) {
        return [
          "HTML-to-PPTX artifact policy:",
          `- Current artifact focus: ${slideArtifactPhase}. This describes observed artifact state and does not prescribe a step order.`,
          "- Dedicated artifact tools enforce manifest, draft, accepted, export, and validation invariants.",
          "- Research, evidence recording, task memory, safe file observation, artifact inspection, and validation remain available throughout artifact work.",
          "- Final delivery requires objective receipts for every acceptance item.",
        ];
      }
      return hasStaticHtmlArtifact(skillNames)
        ? [
            "Static HTML artifact policy:",
            "- Final delivery requires a successful desktop/mobile QA receipt with zero unresolved warnings.",
            "- Editing any output file after validation requires a fresh validation receipt.",
          ]
        : [];
    },
    getReceiptProjectors(skillNames) {
      return [
        ...(hasSlideArtifact(skillNames) ? [projectHtmlToPptxReceipt] : []),
        ...(hasStaticHtmlArtifact(skillNames) ? [projectStaticHtmlReceipt] : []),
      ];
    },
    getToolDefinitions(skillNames) {
      return hasSlideArtifact(skillNames)
        ? getHtmlToPptxToolDefinitions(skillNames, slideArtifactPhase)
        : getToolDefinitions(skillNames);
    },
    observeReceipts(receipts) {
      const statusMessages: string[] = [];
      if (
        slideArtifactPhase === "off" &&
        receipts.some(
          (receipt) =>
            receipt.success &&
            receipt.toolName === "init_slide_html_workspace",
        )
      ) {
        slideArtifactPhase = "styles";
        statusMessages.push(
          "HTML-to-PPTX 工件防线已启用，研究、读取、Task Memory、工件和验证能力保持可用。",
        );
      }
      if (
        slideArtifactPhase === "styles" &&
        receipts.some(
          (receipt) =>
            receipt.success && receipt.toolName === "assemble_deck_styles",
        )
      ) {
        slideArtifactPhase = "slides";
        statusMessages.push(
          "全局样式已通过工具校验，当前工件关注点更新为页面、导出与验证。",
        );
      }
      return { statusMessages };
    },
    snapshot() {
      return hasSlideArtifact(activeSkillNames)
        ? [{ id: "html-to-pptx", state: { slideArtifactPhase } }]
        : [];
    },
  };
}
