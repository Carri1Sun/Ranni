export type HtmlDesignSource = {
  note: string;
  title: string;
  url: string;
};

export type HtmlDesignOption = {
  accentColor: string;
  description: string;
  guidance: string[];
  id: string;
  name: string;
  preview: string;
  sources: HtmlDesignSource[];
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

const localGuideSource = {
  note: "Ranni 本地产品要求，定义首批 10 个产物形式模板和 10 个风格方向。",
  title: "Ranni HTML design guide",
  url: "docs/product/slides-design/html-design-guide.md",
} satisfies HtmlDesignSource;

const responsiveSource = {
  note: "响应式网页需要随设备能力和屏幕尺寸调整布局。",
  title: "web.dev Responsive web design basics",
  url: "https://web.dev/articles/responsive-web-design-basics",
} satisfies HtmlDesignSource;

const gridSource = {
  note: "响应式网格由 columns、gutters、margins 组成。",
  title: "Material Design Responsive layout grid",
  url: "https://m2.material.io/design/layout/responsive-layout-grid.html",
} satisfies HtmlDesignSource;

const carbonGridSource = {
  note: "2x Grid 为 typography、columns、boxes、icons、illustrations 提供几何基础。",
  title: "Carbon Design System 2x Grid",
  url: "https://carbondesignsystem.com/elements/2x-grid/overview/",
} satisfies HtmlDesignSource;

const homepageSource = {
  note: "首页首屏应清楚传达价值主张和用户行动。",
  title: "Nielsen Norman Group Homepage Design Principles",
  url: "https://www.nngroup.com/articles/homepage-design-principles/",
} satisfies HtmlDesignSource;

const scanningSource = {
  note: "网页读者倾向扫描页面，需要清楚层级、标题和可扫读结构。",
  title: "Nielsen Norman Group How People Read Online",
  url: "https://www.nngroup.com/articles/how-people-read-online/",
} satisfies HtmlDesignSource;

const formsSource = {
  note: "表单要减少字段、清楚标注、保持视觉组织。",
  title: "Nielsen Norman Group Website Forms Usability",
  url: "https://www.nngroup.com/topic/forms/",
} satisfies HtmlDesignSource;

const contrastSource = {
  note: "普通文本至少 4.5:1，大文本至少 3:1。",
  title: "W3C WCAG 2.2 Contrast Minimum",
  url: "https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html",
} satisfies HtmlDesignSource;

const vitalsSource = {
  note: "Web Vitals 关注加载、交互和视觉稳定性等体验信号。",
  title: "web.dev Web Vitals",
  url: "https://web.dev/articles/vitals",
} satisfies HtmlDesignSource;

const typographySource = {
  note: "排版选择影响可读性、信息层级和品牌风格。",
  title: "Apple Human Interface Guidelines Typography",
  url: "https://developer.apple.com/design/human-interface-guidelines/typography",
} satisfies HtmlDesignSource;

const portfolioSource = {
  note: "作品集应选择少量高质量项目，并解释角色、过程和影响。",
  title: "Nielsen Norman Group UX Design Portfolios",
  url: "https://www.nngroup.com/articles/ux-design-portfolios/",
} satisfies HtmlDesignSource;

const productPageSource = {
  note: "产品页面需要支持购买或转化决策，信息结构和证据完整度影响 UX 表现。",
  title: "Baymard Product Page UX Best Practices",
  url: "https://baymard.com/blog/current-state-ecommerce-product-page-ux",
} satisfies HtmlDesignSource;

export const htmlDesignStyles = [
  {
    accentColor: "#2563eb",
    description: "大留白、浅背景、清晰层级和现代产品感。",
    guidance: [
      "使用白色或浅灰背景，主色控制在一个，按钮和链接使用同一强调色。",
      "首屏只放核心价值主张、简短说明和一个主 CTA。",
      "卡片阴影保持极轻，边框、留白和字号层级承担主要秩序。",
      "适合 SaaS、AI 工具、App、小产品、等候名单和功能发布。",
    ],
    id: "minimal-saas",
    name: "极简 SaaS 风",
    preview: "/html-design-previews/styles/minimal-saas.svg",
    sources: [localGuideSource, homepageSource, gridSource, contrastSource],
    surfaceColor: "#f8fafc",
    tags: ["product", "clean", "conversion"],
  },
  {
    accentColor: "#7c3aed",
    description: "模块化卡片、强网格和清楚信息块。",
    guidance: [
      "使用 12 或 16 列网格，把主卖点放大卡片，辅助信息放小卡片。",
      "同一屏内卡片尺寸要形成节奏，避免所有卡片等权。",
      "卡片内部保持标题、数字、说明和小图标的固定层级。",
      "适合功能展示、产品卖点、个人主页和数据总结。",
    ],
    id: "bento-grid",
    name: "Bento Grid 风",
    preview: "/html-design-previews/styles/bento-grid.svg",
    sources: [localGuideSource, carbonGridSource, gridSource, contrastSource],
    surfaceColor: "#f5f3ff",
    tags: ["grid", "cards", "feature"],
  },
  {
    accentColor: "#facc15",
    description: "粗边框、硬阴影、高对比和大色块。",
    guidance: [
      "使用黑色粗线、硬阴影和高饱和强调色建立记忆点。",
      "标题可以夸张，但布局必须按网格对齐，避免随机堆叠。",
      "按钮和标签使用实体色块，正文仍保持足够行高和对比度。",
      "适合年轻化产品、创作者工具和社区项目。",
    ],
    id: "neo-brutalism",
    name: "新粗野派风",
    preview: "/html-design-previews/styles/neo-brutalism.svg",
    sources: [localGuideSource, gridSource, contrastSource, scanningSource],
    surfaceColor: "#fff7ed",
    tags: ["bold", "creator", "contrast"],
  },
  {
    accentColor: "#60a5fa",
    description: "柔和凸起、浅色背景和低对比阴影。",
    guidance: [
      "使用浅灰、米白或淡蓝背景，组件像从背景中浮起。",
      "阴影和高光成对出现，边缘柔和，文本对比度不能降低。",
      "交互控件需要明显边界和状态，避免按钮融入背景。",
      "适合轻量工具、健康类、个人页和生活方式内容。",
    ],
    id: "neumorphism",
    name: "新拟态风",
    preview: "/html-design-previews/styles/neumorphism.svg",
    sources: [localGuideSource, contrastSource, typographySource],
    surfaceColor: "#eef4fb",
    tags: ["soft", "light", "personal"],
  },
  {
    accentColor: "#22d3ee",
    description: "半透明卡片、背景模糊和层叠空间感。",
    guidance: [
      "背景使用可控渐变或暗色图层，卡片透明度和边框要服务可读性。",
      "主要文字放在低噪声区域，避免背景图案穿过正文。",
      "发光和模糊只用于营造空间层次，CTA 保持实色或高对比。",
      "适合 AI、Web3、未来感产品和实验性工具。",
    ],
    id: "glassmorphism",
    name: "玻璃拟态风",
    preview: "/html-design-previews/styles/glassmorphism.svg",
    sources: [localGuideSource, contrastSource, vitalsSource],
    surfaceColor: "#0f172a",
    tags: ["glass", "ai", "depth"],
  },
  {
    accentColor: "#f97316",
    description: "简洁色块、统一插画和低复杂度 UI。",
    guidance: [
      "插画、图标和几何图形使用同一笔触、圆角和色彩系统。",
      "内容区保持清楚边界，明亮配色需要克制使用。",
      "说明型页面优先使用图解、步骤和示例降低理解成本。",
      "适合教育、知识讲解、活动报名和轻产品。",
    ],
    id: "flat-illustration",
    name: "扁平插画风",
    preview: "/html-design-previews/styles/flat-illustration.svg",
    sources: [localGuideSource, scanningSource, contrastSource],
    surfaceColor: "#fff7ed",
    tags: ["illustration", "education", "friendly"],
  },
  {
    accentColor: "#22c55e",
    description: "8-bit、等宽字体、硬切色块和游戏感。",
    guidance: [
      "使用等宽字体、像素边框、硬切色块和低分辨率图标语言。",
      "保留清楚段落宽度和按钮状态，不牺牲可读性。",
      "动效可以极少量使用，静态预览里也要有完整表达。",
      "适合游戏、开发者项目、开源工具和 meme 社区。",
    ],
    id: "pixel-retro",
    name: "像素复古风",
    preview: "/html-design-previews/styles/pixel-retro.svg",
    sources: [localGuideSource, contrastSource, scanningSource],
    surfaceColor: "#111827",
    tags: ["retro", "developer", "game"],
  },
  {
    accentColor: "#8a6f4d",
    description: "米白、低饱和、细线和安静排版。",
    guidance: [
      "使用米色、浅灰、木色和淡黑文字，装饰保持极少。",
      "圆角较小，边框细，留白比卡片装饰更重要。",
      "文字语气克制，图片和内容要有生活质感。",
      "适合个人主页、生活方式、知识内容和手作品牌。",
    ],
    id: "muji-minimal",
    name: "素雅 Muji 风",
    preview: "/html-design-previews/styles/muji-minimal.svg",
    sources: [localGuideSource, typographySource, contrastSource],
    surfaceColor: "#f4efe6",
    tags: ["calm", "editorial", "lifestyle"],
  },
  {
    accentColor: "#dc2626",
    description: "大标题、栏目节奏、图文穿插和编辑感。",
    guidance: [
      "用大字号标题、章节编号、引用块和图片穿插建立阅读节奏。",
      "避免把所有内容都放进卡片，优先使用栏目、分割线和图文比例。",
      "正文宽度控制在舒适阅读区间，重点句可作为 pull quote。",
      "适合知识讲解、报告页、个人品牌和长阅读内容。",
    ],
    id: "editorial-magazine",
    name: "杂志编辑风",
    preview: "/html-design-previews/styles/editorial-magazine.svg",
    sources: [localGuideSource, scanningSource, typographySource],
    surfaceColor: "#fff1f2",
    tags: ["editorial", "content", "reading"],
  },
  {
    accentColor: "#14b8a6",
    description: "深色背景、线框、数据面板和动态科技感。",
    guidance: [
      "使用深色背景、网格线、数据面板和少量荧光强调色。",
      "渐变、发光和线框必须控制数量，避免干扰核心文字。",
      "指标、流程和图表要有明确视觉锚点，CTA 保持高对比。",
      "适合 AI、开发者工具、数据产品和趋势报告。",
    ],
    id: "future-tech",
    name: "未来科技风",
    preview: "/html-design-previews/styles/future-tech.svg",
    sources: [localGuideSource, contrastSource, vitalsSource],
    surfaceColor: "#020617",
    tags: ["dark", "ai", "data"],
  },
] satisfies HtmlDesignOption[];

export const htmlPageTemplates = [
  {
    accentColor: "#2563eb",
    description: "让用户快速理解产品价值并开始试用或咨询。",
    guidance: [
      "首屏必须回答产品解决什么问题、面向谁、为什么现在值得试。",
      "用功能截图、场景、用户证据和价格/CTA 逐层降低决策成本。",
      "避免只强调 AI、技术栈或抽象愿景，要落到用户收益。",
    ],
    id: "product-intro",
    name: "产品介绍页",
    preview: "/html-design-previews/templates/product-intro.svg",
    sections: ["Hero", "核心卖点", "功能展示", "使用场景", "产品截图", "用户评价", "价格/CTA"],
    sources: [localGuideSource, homepageSource, productPageSource],
    surfaceColor: "#eff6ff",
    tags: ["product", "saas", "conversion"],
  },
  {
    accentColor: "#7c3aed",
    description: "面向未上线产品、内测招募和项目预热。",
    guidance: [
      "页面要短，首屏给出一句话承诺、上线节奏和邮箱收集。",
      "只保留 3 个以内亮点和必要信任信号，避免过早写完整产品文档。",
      "表单字段保持极少，提交按钮说明用户会得到什么。",
    ],
    id: "waitlist-teaser",
    name: "等候名单 / 预告页",
    preview: "/html-design-previews/templates/waitlist-teaser.svg",
    sections: ["大标题", "一句话介绍", "亮点", "进度", "邮箱表单", "社交证明"],
    sources: [localGuideSource, formsSource, homepageSource],
    surfaceColor: "#f5f3ff",
    tags: ["waitlist", "launch", "lead"],
  },
  {
    accentColor: "#0f766e",
    description: "聚焦一个新功能、版本更新或单个能力。",
    guidance: [
      "页面只讲一个功能，使用前后对比解释变化。",
      "展示适用人群、操作流程和立即体验入口。",
      "配截图、短流程或演示区，避免泛泛列全产品功能。",
    ],
    id: "feature-launch",
    name: "功能发布页",
    preview: "/html-design-previews/templates/feature-launch.svg",
    sections: ["功能名称", "前后对比", "核心能力", "操作流程", "适用人群", "立即体验"],
    sources: [localGuideSource, homepageSource, scanningSource],
    surfaceColor: "#ecfdf5",
    tags: ["feature", "release", "product"],
  },
  {
    accentColor: "#ea580c",
    description: "解释概念、技术科普、课程内容或学习资料。",
    guidance: [
      "从用户已有问题进入，先解释背景，再拆核心概念。",
      "使用步骤、例子、图示和总结块支持扫读。",
      "延伸阅读放在末尾，正文保持章节清楚和层级明确。",
    ],
    id: "knowledge-explainer",
    name: "知识讲解页",
    preview: "/html-design-previews/templates/knowledge-explainer.svg",
    sections: ["主题介绍", "背景问题", "核心概念", "分步骤解释", "例子", "总结", "延伸阅读"],
    sources: [localGuideSource, scanningSource, responsiveSource],
    surfaceColor: "#fff7ed",
    tags: ["education", "article", "learning"],
  },
  {
    accentColor: "#16a34a",
    description: "教用户完成部署、配置、使用工具等具体任务。",
    guidance: [
      "首屏说明教程目标、准备条件和完成后的检查标准。",
      "步骤导航要固定清楚，每一步包含说明、代码块/截图和常见错误。",
      "代码块可复制，错误处理要比背景故事更优先。",
    ],
    id: "interactive-tutorial",
    name: "交互式教程页",
    preview: "/html-design-previews/templates/interactive-tutorial.svg",
    sections: ["教程目标", "准备条件", "步骤导航", "步骤说明", "代码/截图", "常见错误", "完成检查"],
    sources: [localGuideSource, scanningSource, formsSource],
    surfaceColor: "#f0fdf4",
    tags: ["tutorial", "steps", "developer"],
  },
  {
    accentColor: "#8a6f4d",
    description: "为创始人、开发者、设计师或独立创作者建立可信度。",
    guidance: [
      "首屏呈现姓名、当前身份、代表性方向和联系入口。",
      "项目、文章和技能要服务个人定位，数量少而清楚。",
      "视觉要有记忆点，同时保持个人信息和联系方式易找。",
    ],
    id: "personal-homepage",
    name: "个人主页",
    preview: "/html-design-previews/templates/personal-homepage.svg",
    sections: ["个人简介", "当前身份", "项目", "技能/方向", "文章/作品", "联系方式"],
    sources: [localGuideSource, portfolioSource, typographySource],
    surfaceColor: "#f4efe6",
    tags: ["personal", "profile", "creator"],
  },
  {
    accentColor: "#9333ea",
    description: "展示设计、开发、摄影或案例成果。",
    guidance: [
      "精选 3 到 5 个强项目，每个项目讲清背景、角色、过程和结果。",
      "项目网格负责筛选，详情区负责证明能力。",
      "图片比例、项目标签和成果数据要统一，避免杂乱作品墙。",
    ],
    id: "portfolio",
    name: "作品集页",
    preview: "/html-design-previews/templates/portfolio.svg",
    sections: ["封面介绍", "精选项目网格", "项目详情", "角色贡献", "结果数据", "联系入口"],
    sources: [localGuideSource, portfolioSource, gridSource],
    surfaceColor: "#faf5ff",
    tags: ["portfolio", "case-study", "creative"],
  },
  {
    accentColor: "#334155",
    description: "面向咨询、设计服务、开发外包或营销服务。",
    guidance: [
      "清楚写服务定位、服务内容、合作流程和咨询入口。",
      "案例和客户评价要靠近服务说明，帮助潜在客户建立信任。",
      "报价方式可以写范围或方式，避免让用户找不到下一步。",
    ],
    id: "studio-service",
    name: "服务 / 工作室官网",
    preview: "/html-design-previews/templates/studio-service.svg",
    sections: ["服务定位", "服务内容", "合作流程", "案例", "客户评价", "报价方式", "预约咨询"],
    sources: [localGuideSource, homepageSource, formsSource],
    surfaceColor: "#f8fafc",
    tags: ["service", "studio", "consulting"],
  },
  {
    accentColor: "#db2777",
    description: "面向 workshop、训练营、直播、线下活动或课程报名。",
    guidance: [
      "首屏说明主题、适合人群、时间地点和报名按钮。",
      "课程大纲、讲师、收获和 FAQ 要降低报名犹豫。",
      "价格和席位信息要清楚，避免 CTA 周围出现过多分散链接。",
    ],
    id: "event-course",
    name: "活动 / 课程招募页",
    preview: "/html-design-previews/templates/event-course.svg",
    sections: ["活动主题", "适合人群", "时间地点", "讲师介绍", "课程大纲", "收获", "价格", "报名按钮", "FAQ"],
    sources: [localGuideSource, formsSource, homepageSource],
    surfaceColor: "#fdf2f8",
    tags: ["event", "course", "signup"],
  },
  {
    accentColor: "#0891b2",
    description: "呈现行业报告、趋势分析、调研结果或年度总结。",
    guidance: [
      "先给核心结论和关键数据，再展开章节分析和方法说明。",
      "图表、数字卡片、引用块和下载 CTA 要形成专业信息密度。",
      "报告页需要解释数据来源和口径，避免只有视觉图表。",
    ],
    id: "data-insight",
    name: "数据报告 / 洞察页",
    preview: "/html-design-previews/templates/data-insight.svg",
    sections: ["报告标题", "核心结论", "关键数据", "图表模块", "分章节分析", "方法说明", "下载/分享 CTA"],
    sources: [localGuideSource, scanningSource, vitalsSource],
    surfaceColor: "#ecfeff",
    tags: ["report", "data", "insight"],
  },
] satisfies HtmlPageTemplateOption[];

export function listHtmlDesignStyles() {
  return htmlDesignStyles;
}

export function listHtmlPageTemplates() {
  return htmlPageTemplates;
}

export function getDefaultHtmlDesignStyleId() {
  return htmlDesignStyles[0].id;
}

export function getDefaultHtmlPageTemplateId() {
  return htmlPageTemplates[0].id;
}

export function findHtmlDesignStyle(styleId?: string) {
  const normalizedId = styleId?.trim();

  if (normalizedId) {
    return htmlDesignStyles.find((style) => style.id === normalizedId);
  }

  return htmlDesignStyles[0];
}

export function findHtmlPageTemplate(templateId?: string) {
  const normalizedId = templateId?.trim();

  if (normalizedId) {
    return htmlPageTemplates.find((template) => template.id === normalizedId);
  }

  return htmlPageTemplates[0];
}

function formatSourceList(sources: HtmlDesignSource[]) {
  return sources.map((source) => `${source.title} (${source.url})`).join("; ");
}

export function buildHtmlDesignRuntimeInstruction({
  pageTemplateId,
  styleId,
  targetSkill,
}: RuntimeInstructionOptions) {
  const style = findHtmlDesignStyle(styleId);
  const pageTemplate =
    targetSkill === "html" ? findHtmlPageTemplate(pageTemplateId) : undefined;

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
      `- Style sources: ${formatSourceList(style.sources)}`,
    );
  }

  if (pageTemplate) {
    lines.push(
      `- HTML page template id: ${pageTemplate.id}`,
      `- HTML page template name: ${pageTemplate.name}`,
      `- Template description: ${pageTemplate.description}`,
      `- Required section pattern: ${pageTemplate.sections.join(" / ")}`,
      "- Template rules:",
      ...pageTemplate.guidance.map((rule) => `  - ${rule}`),
      `- Template sources: ${formatSourceList(pageTemplate.sources)}`,
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
    );
  }

  return [...lines, ""];
}
