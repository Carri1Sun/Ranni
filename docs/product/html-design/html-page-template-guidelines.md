---
author: codex
version: v1
date: 2026-07-08
---

# HTML 网页类型模板指导

本文档定义 `html` skill 的 10 个网页类型模板。模板负责页面目标和信息结构，设计风格负责视觉语言。agent 生成静态网页时应先确认用户目标，再按选中的网页类型覆盖核心 section。

## 文件规范

HTML 页面 pattern 内容资产位于 `skills/html-design/patterns/*/`。每个目录对应一个页面 pattern，目录名建议使用数字前缀保留默认排序，例如 `01-product-intro/`。

frontmatter 必须包含：

- `id`：稳定标识，用于 API、工具参数和预览文件名。
- `name`：前端展示名称。
- `description`：前端展示短说明。
- `accentColor`、`surfaceColor`：6 位十六进制颜色。
- `preview`：浏览器可访问的预览图路径。
- `tags`：JSON 兼容的 flow 字符串数组。
- `sections`：页面必须覆盖的核心 section 顺序。
- `sources`：机器参考来源，指向同目录本地参考资料，例如 `["reference.md#来源"]`，catalog 不解析该字段，也不传给 agent。

`guide.md` 正文只写 agent guidance，推荐使用 Markdown 列表。`lib/html-design/catalog.ts` 会把列表项转为 `guidance: string[]`。加载失败时该目录会被跳过；全部目录不可用时返回空列表。

`skills/html-design/reference-materials/base-html-design-guide.md` 是 HTML 创作的产品级基础 guide，`html` 和 `html-to-pptx` skill 激活时会由 runtime instruction registry 注入。单个 pattern 的 `guide.md` 只记录本地参考资料路径，不反向引用本地 guide。

每个页面 pattern 可以在同目录放置 `reference.md`。参考资料使用本地化来源笔记、设计思路、来源链接、结构建议和常见失误；默认 prompt 只提供本地路径，并提示 agent 在需要更细致的设计思路了解时阅读参考资料。参考资料已承载来源思路，运行时不需要访问外部 URL。

## 调研来源

- 本地运行资料：`skills/html-design/reference-materials/base-html-design-guide.md`
- Nielsen Norman Group Homepage Design Principles：<https://www.nngroup.com/articles/homepage-design-principles/>
- Nielsen Norman Group How People Read Online：<https://www.nngroup.com/articles/how-people-read-online/>
- Nielsen Norman Group Forms topic：<https://www.nngroup.com/topic/forms/>
- Nielsen Norman Group UX Design Portfolios：<https://www.nngroup.com/articles/ux-design-portfolios/>
- Baymard Product Page UX Best Practices：<https://baymard.com/blog/current-state-ecommerce-product-page-ux>
- web.dev Responsive web design basics：<https://web.dev/articles/responsive-web-design-basics>
- web.dev Web Vitals：<https://web.dev/articles/vitals>

## 产品介绍页

- 适合：SaaS、AI 工具、App、插件、小产品。
- 页面目标：让用户快速理解产品价值并开始试用、购买或咨询。
- 必备结构：Hero、核心卖点、功能展示、使用场景、产品截图、用户评价、价格/CTA。
- 执行要点：首屏说明产品解决的问题、目标用户、主要收益；后续用截图、证据和场景降低决策成本。
- QA 注意：CTA 清楚可见，移动端首屏不被装饰或截图挤压。
- 来源：本地产品输入、NN/g 首页价值主张、Baymard 产品页 UX。

## 等候名单 / 预告页

- 适合：产品未上线、内测招募、项目预热。
- 页面目标：让用户理解期待点并留下联系方式。
- 必备结构：大标题、一句话介绍、亮点 3 个、上线时间/进度、邮箱收集表单、社交证明。
- 执行要点：页面短而聚焦，表单字段尽量少，提交按钮说明用户将获得的权益。
- QA 注意：表单有 label，错误提示和隐私说明清楚。
- 来源：本地产品输入、NN/g Forms、NN/g 首页设计原则。

## 功能发布页

- 适合：新功能上线、版本更新、单个能力介绍。
- 页面目标：解释一个功能带来的变化，并推动用户立即体验。
- 必备结构：功能名称、使用前后对比、核心能力、操作流程、适用人群、立即体验按钮。
- 执行要点：只聚焦一个功能；用前后对比、流程截图或演示模块解释价值。
- QA 注意：不要把整套产品功能都塞进页面；移动端流程步骤要线性清楚。
- 来源：本地产品输入、NN/g 首页价值主张、NN/g 扫读研究。

## 知识讲解页

- 适合：解释概念、技术科普、课程内容、学习资料。
- 页面目标：让用户看懂一个主题并知道下一步阅读方向。
- 必备结构：主题介绍、背景问题、核心概念、分步骤解释、例子、总结、延伸阅读。
- 执行要点：先从用户问题进入，再拆概念；使用示例、图示和小结支持扫读。
- QA 注意：标题层级连续；正文宽度适中；长段落拆成列表或图解。
- 来源：本地产品输入、NN/g How People Read Online、web.dev Responsive Design。

## 交互式教程页

- 适合：部署网站、配置工具、完成某个操作任务。
- 页面目标：让用户按步骤完成任务并知道是否成功。
- 必备结构：教程目标、准备条件、步骤导航、每一步说明、代码块/截图、常见错误、完成检查。
- 执行要点：步骤顺序清楚，代码块可复制，错误处理要具体。
- QA 注意：移动端代码块不造成水平溢出；完成检查放在末尾。
- 来源：本地产品输入、NN/g 扫读研究、web.dev Responsive Design。

## 个人主页

- 适合：创始人、开发者、设计师、独立创作者。
- 页面目标：建立个人可信度和可联系路径。
- 必备结构：个人简介、当前身份、做过的项目、技能/方向、文章/作品、联系方式。
- 执行要点：首屏呈现姓名、身份、代表性方向；项目和文章服务个人定位。
- QA 注意：联系方式易找；图片有 alt；不要让个人故事淹没行动入口。
- 来源：本地产品输入、NN/g Portfolio、Apple Typography。

## 作品集页

- 适合：设计作品、开发项目、摄影、案例展示。
- 页面目标：让访客快速判断能力和代表作品。
- 必备结构：封面介绍、精选项目网格、单个项目详情、角色贡献、结果数据、联系入口。
- 执行要点：精选 3 到 5 个项目，每个项目讲清背景、角色、过程和结果。
- QA 注意：项目卡片有一致比例；详情区包含角色和影响；避免只有图片墙。
- 来源：本地产品输入、NN/g Portfolio、Material Responsive Grid。

## 服务 / 工作室官网

- 适合：咨询、设计服务、开发外包、营销服务。
- 页面目标：让潜在客户理解服务并预约咨询。
- 必备结构：服务定位、服务内容、合作流程、案例、客户评价、报价方式、预约咨询。
- 执行要点：服务说明、案例和评价要相互支撑；报价方式或咨询路径要清楚。
- QA 注意：预约表单字段少；CTA 重复出现但不分散。
- 来源：本地产品输入、NN/g 首页设计原则、NN/g Forms。

## 活动 / 课程招募页

- 适合：Workshop、训练营、直播、线下活动、课程报名。
- 页面目标：降低报名犹豫并完成报名。
- 必备结构：活动主题、适合人群、时间地点、讲师介绍、课程大纲、收获、价格、报名按钮、FAQ。
- 执行要点：首屏包含主题、时间地点、适合人群和报名 CTA；FAQ 处理顾虑。
- QA 注意：价格和席位信息清楚；报名按钮文案具体。
- 来源：本地产品输入、NN/g Forms、NN/g 首页设计原则。

## 数据报告 / 洞察页

- 适合：行业报告、趋势分析、调研结果、年度总结。
- 页面目标：让读者快速获得结论，并能深入查看数据和方法。
- 必备结构：报告标题、核心结论、关键数据、图表模块、分章节分析、方法说明、下载/分享 CTA。
- 执行要点：先给结论和关键数据，再展示图表和分析；必须说明数据来源或口径。
- QA 注意：图表有文本解释；数字卡片可扫读；下载 CTA 清楚。
- 来源：本地产品输入、NN/g 扫读研究、web.dev Web Vitals。
