调研已完成，覆盖 6 个核心子问题、12 条来源证据、5 条已记录发现。以下是结构化总结。

---

# AI Agent 评测：学术界与工业界最新工作与方法论全景

## 一、学术界主流评测基准（按维度分类）

### 1. 代码/软件工程类
| 基准 | 核心能力 | 评测方式 |
|------|---------|---------|
| **SWE-bench**（Princeton/UC Berkeley） | 修复真实 GitHub issue | 运行项目测试套件，通过即得分 |
| SWE-bench Verified / Lite / Multilingual / Multimodal | 同上，不同变体 | 隐藏测试集防泄露 |
| **Terminal-Bench** | 端到端终端操作（编译内核、训练模型等） | 环境状态验证 |
| ScienceAgentBench | 科学数据编程 | 代码正确性 |

*当前 SWE-bench 最高分已突破 78%（Gemini 3.1 Pro、Claude Opus 4.6、GPT 5.4），一年内从 40% 飙升至 80%+，出现 benchmark saturation 现象。*

### 2. Web 导航类
| 基准 | 核心能力 | 特点 |
|------|---------|------|
| **WebArena** | 长程 Web 操作（购物、Reddit、GitLab 等） | 自托管容器化环境 |
| **BrowserGym**（ServiceNow） | 统一 gym 接口 | 整合 MiniWoB/WebArena/WorkArena/VisualWebArena 等 7+ 基准 |
| **VisualWebArena** | 多模态 Web 任务 | 需要截图理解 |
| **AssistantBench** | 开放网络耗时任务 | 真实互联网环境 |
| **WorkArena** | 企业 SaaS 操作 | IT/HR/Ops 企业场景 |

### 3. 通用推理与工具使用
| 基准 | 核心能力 |
|------|---------|
| **GAIA**（Meta/等） | 真实世界多模态推理，需多步工具使用 |
| **AgentBench**（THUDM） | 8 种异构环境（OS、DB、KG、Web、游戏等） |
| **ToolBench** | 大规模工具调用能力评估 |
| **AppWorld** | 交互式应用编程环境 |

### 4. 多 Agent 协作类
| 基准 | 核心能力 |
|------|---------|
| **MultiAgentBench**（ACL 2025） | 合作/竞争场景，里程碑式 KPI，沟通/规划/协调评分 |
| **BattleAgentBench** | 对抗性竞争场景 |
| **SOTOPIA-π** | 社交智能 |
| **MedAgentBoard**（NeurIPS 2025） | 医疗多 Agent vs 单 LLM vs 传统方法对比 |
| **AWS MultiAgent Collab Benchmark** | 旅行/贷款/软件开发 30 场景 |

### 5. 过程/行为评测
- **AgentBoard**：计算逐步进度率，区分部分成功与完全成功
- **VeriLA**：DAG-of-agent 分解，每个子任务输出可解释失败概率
- **MCPEval**：利用 MCP 协议统一工具调用评测

---

## 二、工业界评测实践

### Anthropic
发表 **"Demystifying evals for AI agents"** 工程博客，建立了最系统的 Agent eval 方法论：
- 定义六元概念体系：**task → trial → grader → transcript → outcome → harness**
- 三类 grader 组合使用：**代码型**（确定性测试）、**模型型**（LLM-as-judge）、**人工型**（SME 评审）
- **Capability evals**（低通过率，测能力上限）vs **Regression evals**（高通过率，防回退）
- Claude Code 内部已建立多 eval suite，嵌入 CI/CD

### OpenAI
- 与 UC Berkeley 合作发布 **SWE-bench Verified**
- 建立 **Safety Evaluations Hub**，公开安全评测结果
- 与 Anthropic **交叉评测**对方模型的安全性/对齐性

### Google
- **Agent Factory**：讨论 Agent 评估的实用性工具链
- **Vertex AI**：提供企业级评测基础设施

### MIT
- **2025 AI Agent Index**：对 30+ 商业 Agent 产品进行安全/护栏/沙箱/第三方测试的系统性评估

### Berkeley RDI
- 发布基准安全性审计报告：发现 **SWE-bench、WebArena、GAIA、Terminal-Bench 等每一个主流基准均可被自动化 Agent exploit 获得高分**

---

## 三、核心方法论

### 1. 评测流程设计
```
定义任务 → 设置环境 → 运行 agent loop → 记录完整 transcript → 多维度 grading → 聚合分析
```

### 2. LLM-as-Judge → Agent-as-a-Judge
- 单 LLM-judge → **多 Agent 辩论/委员会机制**
- ChatEval 多 Agent 讨论达到 Kendall Tau 0.57（vs GPT-4 单评委 0.52）
- MAJ-Eval 通过 persona 构造 + 辩论协议，Spearman ρ=0.43-0.47 与人类专家对齐

### 3. 评测指标体系
| 维度 | 指标 |
|------|------|
| 任务完成 | Success Rate、Pass@k、Goal Completion |
| 输出质量 | Factual Correctness、Coherence、Relevance |
| 工具使用 | Tool Call Accuracy、Parameter F1 |
| 规划推理 | Planning Optimality、Trajectory Similarity |
| 效率成本 | Latency、Token Usage、Cost per Task |
| 过程追踪 | Step-wise Progress Rate、Subtask Completion |

### 4. 动态/自适应评测
- **TestAgent**：Benchmark+（灵活策略-标准对）+ Assessment+（多轮探索性探测）
- **JudgeAgent**：自适应面试式评测，知识图谱引导问题生成，难度自动调节
- **ALI-Agent**：自动发现安全漏洞场景

---

## 四、核心挑战

1. **基准可 exploit 性**：Agent 可通过劫持测试框架、读取答案文件等方式获得虚假高分
2. **LLM-as-Judge 不可靠**：偏好泄漏、校准偏差、单点依赖
3. **Benchmark Saturation**：刷榜导致基准失去区分度
4. **过程 vs 结果权衡**：只看最终结果忽略过程可能 reward hacking
5. **企业级挑战**：角色权限、合规要求、长程交互可靠性
6. **可扩展性与成本**：细粒度评测成本高昂

---

## 五、最新趋势与未来方向

1. **评测驱动开发（Eval-Driven Development）**：将评测嵌入 CI/CD，offline→online 持续评估闭环
2. **Agent-as-a-Judge 崛起**：用 Agent 评估 Agent，支持全流程细粒度打分
3. **动态自适应评测**：根据模型表现实时调整难度的交互式评测
4. **领域专业化**：从通用基准转向垂直领域（医疗、法律、研究、社交）
5. **标准化**：MCP 协议推动跨领域统一评测，OpenInference 标准化 instrumentation
6. **安全可信优先**：MIT Agent Index、OpenAgentSafety 等系统性安全评估
7. **持续演进测试集**：隐藏测试集、动态合成、对抗性场景自动生成

---

**关键文献/资源索引**：
- KDD 2025: *Evaluation and Benchmarking of LLM Agents: A Survey*（Mohammadi et al.）— 最全面的分类体系
- Anthropic 工程博客: *Demystifying evals for AI agents* — 工业界最实用的方法论
- Emergent Mind: *LLM Agent Evaluation Frameworks* — 最新综述整理
- MIT: *2025 AI Agent Index* — 商业 Agent 产品安全评估
- Berkeley RDI: *How We Broke Top AI Agent Benchmarks* — 基准安全警示