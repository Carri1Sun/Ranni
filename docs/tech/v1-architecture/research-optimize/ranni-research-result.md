---
author: codex
version: v1
date: 2026-05-12
---

# 🔬 AI Agent 评测：2024–2025 学术与工业界全景调研

> 来源覆盖 arXiv、OpenAI、Anthropic、Google DeepMind、UC Berkeley RDI、Stanford HAI 等一手渠道，覆盖 15+ 评测基准、3 大工业界评测体系、评测方法论前沿及 5 大核心挑战。

---

## 一、背景：Agent 评测为什么成为焦点？

AI Agent 不同于传统 LLM——它需要**规划、决策、调用工具、在多步迭代中修改环境状态**。2024 年以来，Claude Code、OpenAI Codex/Deep Research、Google Gemini 等 Agent 产品快速成熟，但如何科学、可复现地衡量其能力，已成瓶颈。

Stanford AI Index 2025 的数据极具代表性：SWE-bench 从 2023 年的 **4.4%** 飙升至 2024 年的 **71.7%**，一年内提升近 17 倍。基准的快速饱和迫使社区不断推出更复杂、更贴近真实任务的评测手段。

---

## 二、学术界主流 Agent 评测基准全景

### 2.1 代码 / 软件工程

| 基准 | 发布 | 规模 | 最新顶尖成绩 | 链接 |
|------|------|------|-------------|------|
| **SWE-bench** | ICLR 2024 | 2,294 实例 | — | [arXiv](https://arxiv.org/abs/2310.06770) |
| **SWE-bench Verified** | OpenAI 2024 | 500 实例（人工验证） | Gemini 3 Flash **75.8%** | [Blog](https://openai.com/index/introducing-swe-bench-verified/) |
| **Terminal-Bench 2.0** | ICLR 2025 | 89 终端任务 | 顶尖模型 **<65%** | [tbench.ai](https://www.tbench.ai/) |

评测方式：Agent 需生成补丁，然后在 Docker 容器中运行测试——fail-to-pass 必须通过，pass-to-pass 必须保持。

### 2.2 Web 交互

| 基准 | 发布 | 规模 | 特点 |
|------|------|------|------|
| **WebArena** | NeurIPS 2024 Oral | 812 任务 | 仿真网站导航与信息检索 |
| **VisualWebArena** | ACL 2024 | 910 任务 | 多模态视觉 Web 任务 |
| **WebVoyager** | 2024 | 真实互联网 | 端到端多模态 Web Agent |

链接：[WebArena](https://webarena.dev/) · [VisualWebArena GitHub](https://github.com/web-arena-x/visualwebarena) · [WebVoyager](https://arxiv.org/abs/2401.13919)

### 2.3 通用 AI 助手与综合评测

- **GAIA**（ICLR 2024，Meta/HuggingFace/AutoGPT）：466 道需要多步推理+Web 浏览+工具调用的复杂问题，对人类简单、对 AI 极难。[arXiv](https://arxiv.org/abs/2311.12983) · [Leaderboard](https://hal.cs.princeton.edu/gaia)
- **AgentBench**（ICLR 2024，清华 THUDM）：8 个不同环境（Web、数据库、操作系统等）统一评测 29 个 LLM。核心结论：**长期推理、决策和指令遵循能力**是主要短板。[arXiv](https://arxiv.org/abs/2308.03688)

### 2.4 桌面 GUI 操作

- **OSWorld**（NeurIPS 2024）：在真实 Ubuntu/Windows/macOS 虚拟机中完成 369 个跨应用办公任务。最优 LLM/VLM Agent 表现显著不足。[arXiv](https://arxiv.org/abs/2404.07972)

### 2.5 工具 / 函数调用

- **BFCL v3 → v4**（ICML 2025，UC Berkeley）：从单轮函数调用扩展到多轮 Agentic 场景，2,000+ 测试。[Proceedings](https://proceedings.mlr.press/v267/patil25a.html) · [Leaderboard](https://gorilla.cs.berkeley.edu/leaderboard.html)

### 2.6 移动端

- **AndroidWorld**（ICLR 2025）：116 个动态生成的真实 Android 任务，20 款 App。最佳 Agent 仅完成 30.6%。[OpenReview](https://openreview.net/forum?id=il5yUQsrjC)
- **MobileWorld**（2025）：应对 AndroidWorld 饱和（>90%），引入 MCP 协议场景。[arXiv](https://arxiv.org/abs/2512.19432)

### 2.7 深度搜索

- **BrowseComp**（OpenAI 2025）：1,266 道需要持久搜索的难题，GPT-5.5 Pro **90.1%**。[Blog](https://openai.com/index/browsecomp/)

### 2.8 真实工作场景 / 经济价值

- **TheAgentCompany**（CMU，NeurIPS 2024）：模拟软件公司的完整数字化工作流。Gemini 2.5 Pro 仅完成 **30.3%**。[arXiv](https://arxiv.org/abs/2412.14161)
- **τ-bench**（ICLR 2025，Sierra AI）：零售/航空客服场景，引入 `pass^k` 衡量可靠性。[arXiv](https://arxiv.org/abs/2406.12045)
- **SWE-Lancer**（OpenAI 2025）：1,400+ Upwork 真实外包任务，$100 万+ 报酬。[Blog](https://openai.com/index/swe-lancer)
- **GDPval**（OpenAI 2025）：44 个职业的真实经济价值任务。[Blog](https://openai.com/index/gdpval/)

### 2.9 ML 工程与科研

- **MLE-bench**（ICLR 2025，OpenAI）：75 个 Kaggle 竞赛，o1-preview 在 16.9% 竞赛中达人类铜牌。[GitHub](https://github.com/openai/mle-bench)
- **PaperBench**（OpenAI 2025）：Claude 3.5 Sonnet 论文复制得分仅 21.0%。
- **MLR-Bench**（NeurIPS 2025）：201 个 ML 研究任务，80% 实验存在编造或无效问题。

### 2.10 多智能体

- **MultiAgentBench**（ACL 2025，UIUC）：4 种协作/竞争场景，里程碑驱动的 KPI 框架。[arXiv](https://arxiv.org/abs/2503.01935)

---

## 三、评测方法论前沿：从「看结果」到「看过程」

### 3.1 三层 Grader 框架（Anthropic）

来自 Anthropic 的 *Demystifying Evals for AI Agents*（[原文](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)）：

| Grader 类型 | 方法 | 优势 | 劣势 |
|------------|------|------|------|
| **Code-based** | 测试套件、静态分析、字符串匹配 | 快速、廉价、客观、可复现 | 缺乏细微判断力 |
| **Model-based** | Rubric 评分、成对比较、多裁判共识 | 灵活、捕捉细微差异 | 非确定性、需人工校准 |
| **Human** | SME 评审、众包判断 | 黄金标准 | 昂贵、慢 |

核心策略：**Capability Eval**（低通过率，有坡可爬）与 **Regression Eval**（近 100% 通过率，防退化）双轨并行。

### 3.2 ⭐ Agent-as-a-Judge：2025 年最大突破

来自 ICML 2025 的 *Agent-as-a-Judge*（[arXiv 2410.10934](https://arxiv.org/abs/2410.10934)）：

> 用 **Agent 系统**来评估 Agent 系统——LLM-as-a-Judge 的有机扩展。

| 指标 | LLM-as-a-Judge | **Agent-as-a-Judge** |
|------|:---:|:---:|
| 与人类评估一致性 | ~70% | **~90%** |
| 评估时间 | 86 小时 | **~2 小时**（↓97%） |
| 评估成本 | $1,297 | **$31**（↓97%） |

配合发布 **DevAI** 基准：55 个真实 AI 开发任务，365 个分层需求。

### 3.3 多智能体辩论裁判

NeurIPS 2025（[链接](https://neurips.cc/virtual/2025/poster/117644)）：多个 Judge Agent 协作推理+迭代优化+自适应稳定性检测，辩论放大正确性，优于简单多数投票。

### 3.4 评测粒度三级体系

来自 *A Survey on Evaluation of LLM-based Agents*（[arXiv 2503.16416](https://arxiv.org/abs/2503.16416)）：

| 粒度 | 说明 | 代表工具 |
|------|------|---------|
| **最终响应** | 仅评估最终输出 | LangSmith, Patronus AI |
| **步级评估** | 评估每个工具调用、路由决策 | Arize Phoenix, Galileo |
| **轨迹评估** | 分析完整执行路径的连贯性和效率 | Google Vertex AI, LangSmith, AgentEvals |

---

## 四、工业界三大体系的 Agent 评测对比

### 4.1 OpenAI：从代码到 GDP 的完整评测量表

构建了从学术基准 → 应用评估 → 经济价值的完整链路：
SWE-bench Verified → MLE-bench（ML 工程）→ **BrowseComp**（深度搜索）→ **SWE-Lancer**（$100 万+市场定价）→ **PaperBench**（科研复制）→ **GDPval**（44 个职业的经济贡献评估）。

[OpenAI Evals Hub](https://evals.openai.com/)

### 4.2 Anthropic：评测工程方法论引领者

- 发布 **τ-bench**：衡量 Agent-用户-工具三维交互的可靠性
- 提出 **MCP**（Model Context Protocol）评测体系，推动工具交互标准化
- 工程博文 *Demystifying Evals* 成为工业界 Agent 评测的「方法论手册」
- Claude Code 内部评测从简洁性、文件编辑到过度工程化行为的递进式覆盖

### 4.3 Google DeepMind：事实性与搜索 Agent 评测

- **FACTS 套件**（2025）：首个从参数知识、搜索、多模态、Grounding 四维度评估 LLM 事实性的基准。→ [Blog](https://deepmind.google/research/evals/)
- **DeepSearchQA**：搜索 Agent 深度研究能力评测
- **AndroidWorld**：移动 Agent 评测（已发布）
- **SimpleQA Verified**：事实性知识评测

[Google DeepMind Evals](https://deepmind.google/research/evals/)

---

## 五、五大核心挑战与趋势

### 5.1 基准可利用性危机 ⚠️

这是 2026 年 4 月领域最震撼的发现。**UC Berkeley RDI** 团队系统审计了 8 个主流 Agent 基准，发现**全部可被 exploit 获近满分，而无需解决任何实际任务**（[Berkeley RDI Blog](https://rdi.berkeley.edu/blog/trustworthy-benchmarks-cont/)）：

| 基准 | Exploit 方式 | 得分 |
|------|-------------|:---:|
| SWE-bench Verified | 10 行 `conftest.py` 强制 pytest 全通过 | **100%** |
| Terminal-Bench | 包装 `curl` 二进制注入假测试输出 | **100%** |
| WebArena | `file://` URL 直接读取本地答案文件 | **~100%** |
| FieldWorkArena | 核心验证函数**完全忽略**答案内容 | **100%** |
| GAIA | 公开答案可直接加载 | **~98%** |
| OSWorld | 下载公开金奖文件 | **73%** |

**根本原因：** Agent 代码与评测器运行在同一个 Docker 容器内，缺乏隔离。

### 5.2 基准快速饱和

GAIA、SWE-bench Verified 的顶级模型已达 75-80%+，Leaderboard 告诉你的更多是「谁跑得快」而非「谁更有能力」。社区转向 **Live Benchmarks**（如 BFCL 的持续迭代、SWE-bench 的 Verified → Pro 演化、MobileWorld 替代 AndroidWorld）。

### 5.3 成本效率评估严重缺失

当前评测几乎只关注任务完成率，忽略 **token 消耗、API 费用、推理时间**。未来需要将成本效率作为核心指标集成到评测框架中。

### 5.4 安全性评估不足

- Agent-SafetyBench（清华 CoAI）：覆盖多种新颖安全场景
- AgentHarm：衡量 LLM Agent 的有害性
- AgentAuditor（NeurIPS 2025）：首个达到人类水平精度的 Agent 安全评测框架
- 但整体而言，**安全性评测远落后于能力评测**

### 5.5 LLM 能力 vs. Agent Harness 的混淆

多数基准混淆了两个评估目标：(1) 底层 LLM 的内在能力；(2) Agent Harness（Scaffold）的设计。Harbor、Exgentic 等新工具开始标准化地将这两个因素解耦。

---

## 六、核心趋势总结

1. **从简化环境到真实任务：** TheAgentCompany、SWE-Lancer、GDPval 将评测推进到真实经济价值层面
2. **Live Benchmarks：** BFCL 持续迭代、SWE-bench 演化、MobileWorld 替代饱和的 AndroidWorld——评测必须「活」起来
3. **从端到端到轨迹级：** 细粒度的逐步评估正在取代粗粒度的二值成功/失败指标
4. **Agent-as-a-Judge 成为核心方法论：** 90% 人类一致性 + 97% 成本降低——可扩展的自动化评测终于可行
5. **成本与安全是下个前沿：** 当前评测在这两个维度上几乎空白，是 2026 年最关键的研究方向
6. **可信评测的信任危机：** UC Berkeley 的发现表明，整个评测基础设施需要从隔离性、安全性和鲁棒性上重建

---

**主要参考文献：**
- A Survey on Evaluation of LLM-based Agents [arXiv 2503.16416](https://arxiv.org/abs/2503.16416)
- Agent-as-a-Judge [arXiv 2410.10934](https://arxiv.org/abs/2410.10934)
- Demystifying Evals for AI Agents [Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- How We Broke Top AI Agent Benchmarks [UC Berkeley RDI](https://rdi.berkeley.edu/blog/trustworthy-benchmarks-cont/)
- Stanford AI Index Report 2025 [Stanford HAI](https://hai.stanford.edu/ai-index/2025-ai-index-report/technical-performance)
- OpenAI Evals Hub [openai.com](https://evals.openai.com/)
- Google DeepMind Evals [deepmind.google](https://deepmind.google/research/evals/)
