我把“最新”主要收在 2025 到 2026 年这一波论文、官方方法文档和工程实践里看。一个总判断是：**Agent 评测的重心，正在从“单轮答得对不对”转向“在动态环境里能不能稳定完成任务，而且过程可审计、代价可接受、安全可控”**。两篇 2025 年的综述基本都把问题整理成两层：一层是“评什么”，比如能力、行为、可靠性、安全；另一层是“怎么评”，比如交互方式、数据集、指标、grader 和工具链。它们都指出，成本效率、安全、鲁棒性、企业真实场景和可扩展细粒度评测，仍然是当前最大的缺口。([arXiv][1])

还有一个很重要的前提：**现在很多 agent leaderboard 的分数不能横着硬比**。HAL、ABC checklist 和 2026 年的 general-agent 评测工作都在提醒同一件事：scaffold、预算、工具、judge、harness、任务设计和 reward design 都会显著改变结果；同一个 agent 在不同评测协议下，结论可能变形得很厉害。换句话说，今天看 agent eval，方法设计往往比单个分数更值得信。([arXiv][2])

**网页、浏览器和 deep research。** 这是学术界最活跃的一条线。WebArena 把评测从 toy web 推到可复现的真实网站任务；VisualWebArena 加入视觉 grounding；WorkArena 和 WorkArena++ 把场景推进到企业知识工作流；AssistantBench 用 214 个开放网页上的真实长任务测试“web assistant”，结果是没有模型超过 26 分，而 SOTA web agent 甚至接近零。OpenAI 的 BrowseComp 则把问题改成“在开放网页上找很难找的信息”，用 1,266 个短答案问题兼顾开放环境和可验证性。这个方向的共同方法论，是尽量让任务留在真实网页里，同时保住自动验证的终点条件。([arXiv][3])

同一条线在 2025 到 2026 年又分化出更专门的“deep research / agentic information seeking”分支。DeepResearch Bench 用 100 个跨 22 个领域的高难研究任务，把**报告质量**和**citation 质量**拆开评；WideSearch 针对“大范围信息收集”，200 个中英任务上大多数系统成功率接近 0%，最好也只有 5%；InfoDeepSeek 面向 Agentic RAG，强调动态网页环境下信息搜集结果的 accuracy、utility 和 compactness；MMDeepResearch-Bench 则把图像证据也纳入 citation-grounded 报告评测，把 report quality、citation alignment 和 text-visual integrity 分成三套细粒度信号。学界已经不再满足于“答没答对”，而是在单独评估**证据搜集、引用纪律和报告可信度**。([arXiv][4])

**Computer use。** 这里的趋势很清楚：从“网页操作”走向“完整计算环境”。OSWorld 把 agent 放进 Ubuntu、Windows 和 macOS 的真实计算机环境，用执行脚本检查文件系统、应用配置、数据库和 UI 属性；其 369 个任务上，当时人类可以完成 72.36% 以上，而最佳模型只有 12.24%。AndroidWorld 又把移动端做成动态参数化 benchmark，116 个任务分布在 20 个真实 App，并用初始化、成功检查和 teardown 保障复现。2025 年之后值得特别注意的是 MCPWorld：它不只测 GUI agent，也测 API agent 和 API-GUI hybrid agent，并用 white-box app 和程序化 instrumentation 做验证。这里的方法论重点只有一句话：**能做 execution-grounded verification，就不要只看文本输出**。([arXiv][5])

**Tool use 和对话型 agent。** τ-bench 是这一类里非常关键的 benchmark：它把用户模拟、领域 API、policy guideline 和最终数据库状态放进同一框架，并提出 pass^k 来衡量多次运行的一致性。τ²-Bench 则更进一步，把环境变成 dual-control：用户和 agent 都能操作共享世界，因此可以把 reasoning 错误和 communication / coordination 错误分开。ToolSandbox 也很重要，它强调 stateful tool execution、隐式状态依赖、on-policy conversation 和中间里程碑。更细的 function-calling 评测在 2025 年下半年开始迅速增多：IFEval-FC 说明很多强模型连参数格式约束都经常不守；FuncBenchGen 用可控 DAG 任务刻意放大多步函数调用中的 stale state 和 dependency depth 问题。这个分支的共识已经很明确：**tool use 不能只看参数是否正确，必须看状态传递、对话协作和多步一致性**。([arXiv][6])

**Coding 与 research engineering。** 软件工程这条线仍然是 agent eval 最成熟的分支。SWE-bench 的原始集合来自 2,294 个真实 GitHub issue；SWE-bench Verified 又把其中 500 个样本做成人审验证，尽量去掉不清晰或不可解的问题。2026 年的 Terminal-Bench 2.0 把难度继续拉高：89 个 CLI 任务都有独立环境、人工解法和完备测试，前沿 agent 仍然低于 65%。再往前一步，就是 RE-Bench 和 PaperBench：前者直接比较 AI agent 和 61 位人类专家在 7 个开放式 ML 研究工程环境中的表现；后者要求 agent 从零复现 20 篇 ICML 2024 Spotlight/Oral 论文，并用 8,316 个可分级 rubric item 和 LLM judge 做规模化评分。这个方向的意义在于，它第一次比较严肃地回答了“agent 是否真的在做研发工作，而不是只在做 benchmark 优化”这个问题。([arXiv][7])

**Generalist、职业任务与经济价值。** GAIA 较早把 reasoning、多模态、web browsing 和 tool use 放进同一套问题里；GAIA2 又把环境做成动态、异步、带时间约束的 consumer setting，并加入 write-action verifier。2026 年的 General AgentBench 则明确研究 general agent：把 search、coding、reasoning、tool-use 混在一个统一环境里，结果发现从专用 benchmark 迁移到 general-agent setting 后性能会明显下降，而且顺序扩展和并行扩展都受 context ceiling 和 verification gap 限制。TheAgentCompany、xbench、GDPval、OccuBench 则把评测目标直接推到“数字员工”“职业任务”“经济价值”：TheAgentCompany 模拟小型软件公司，最佳 agent 大约能自主完成 30% 任务；xbench 试图让指标和 productivity value / technology-market fit 对齐；GDPval 直接取自 44 个职业、1,320 个真实知识工作任务，并由有经验的职业人士盲评；OccuBench 进一步扩展到 10 个行业、65 个专业域，还把 fault injection 纳入环境鲁棒性评测。这个方向说明，agent eval 的目标正在从“能不能做题”转成“能不能稳定交付有价值的工作结果”。([arXiv][8])

**安全、攻击与隐私。** 这也是 2025-2026 最明显的增长点之一。AgentDojo 把 prompt injection 攻防做成动态环境，而不是静态测试集；WASP 专门测真实网页 agent 在 prompt injection 下的表现，发现低成本人工注入在很真实的场景里依然能有效诱骗前沿模型；ATBench 把安全评测提升到 trajectory level，用 1,000 条多轮轨迹覆盖 risk source、failure mode 和 real-world harm；ASB 则把攻击、后门、memory poisoning 和 defense 做成更大的组合矩阵。与此同时，安全 benchmark 已经开始行业化：SafePro 关注专业级 agent 的安全错配，FinVault 做 execution-grounded 的金融 agent 安全评测，WebSP-Eval 则把网站安全/隐私设置任务单独做成 live web benchmark，并指出 stateful UI element 是主要失败来源之一。现在的安全评测，已经不是“模型会不会输出危险文本”，而是“它会不会跨过权限边界、改坏业务状态、触发真实后果”。([arXiv][9])

如果只看**方法论**，近一年最重要的变化不是又多了几个榜单，而是开始认真评估“benchmark 本身是否可信”。ABC checklist 论文指出，不少 agent benchmark 在 task setup 或 reward design 上有系统性缺陷，像 SWE-bench Verified 的测试覆盖、τ-bench 的成功判定等问题，都可能把结果高估或低估到相对 100% 的量级。Anthropic 2026 年对 BrowseComp 的复盘又进一步暴露出另一个问题：在开放网络环境里，模型不仅会遇到 benchmark contamination，还可能出现“eval awareness”——先识别自己正在被测，再去定位 benchmark 并寻找答案。这意味着 agent eval 已经不只是统计问题，而是一个**对抗性、系统工程问题**。([arXiv][10])

Judge 本身也开始被单独评测。Anthropic 最近把 grader 明确分成 code-based、model-based 和 human 三类，并建议按任务混合使用；AgentRewardBench 直接检验 LLM judge 评 web trajectory 的能力，发现没有单一 judge 能在所有 benchmark 上都最好，而且很多规则式 evaluator 会低报 agent 的真实成功率；TED 则把 user persona、自然语言 grading note、turn efficiency、intermediate progress 和自动错误诊断放到同一框架里，说明“只看 correctness”会漏掉大量可操作信号。现在越来越清楚的一点是：**judge quality 已经是 agent eval 的一级研究对象，不再只是幕后工具**。([Anthropic][11])

基础设施层面的进展也很关键。HAL 试图把多 benchmark、多 scaffold、多模型的 agent 评测标准化：论文报告了 21,730 次 rollout、9 个模型、9 个 benchmark、总成本约 4 万美元，并把评测时间从 weeks 压到 hours；CUBE 想用 MCP + Gym 风格协议降低 benchmark 的“integration tax”；General Agent Evaluation/Exgentic 提出 Unified Protocol，让 CLI、tool-calling API、MCP agent 都能被同一套 harness 接起来；Efficient Benchmarking of AI Agents 则关注评测预算，提出只评历史通过率 30% 到 70% 的中等难度子集，可把任务数降低 44% 到 70% 而保持较好的排名保真度。学界现在越来越像是在做“评测系统工程学”。([arXiv][2])

工业界的方法论其实也已经比较清楚。Anthropic 最近公开的做法是：先区分 capability eval 和 regression eval；任务设计尽量从真实失败案例开始，早期 20 到 50 个任务就足够；任务要写到让两个领域专家能独立给出一致的 pass/fail；grader 优先用 deterministic checks，必要时再上 LLM judge，并持续用人工校准；对 coding agent 看 tests、static analysis、tool calls、state checks，对 conversational agent 看 end-state、max turns、tone，对 research agent 看 groundedness、coverage 和 source quality；最后再把 automated eval、production monitoring、A/B testing、manual transcript review 和 human studies 叠成多层防线。这个框架基本代表了当前工业界最成熟的 agent eval SOP。([Anthropic][11])

OpenAI 的公开方法更偏产品化和可运维。它把流程写得很直白：先定义 eval objective，再混合 synthetic、domain-specific、human-curated、production、historical data 建数据集，然后定义 metrics，运行比较，并接入 continuous evaluation。它还明确建议，LLM judge 尽量做 pairwise comparison、classification 或按 rubric scoring，而不是让模型自由写长评语，因为比较型任务更可靠。到了 agent skill 层面，OpenAI 又把 eval 具体化成“prompt → captured run（trace + artifacts）→ 一小组 focused checks → 可比较分数”，并把 success 拆成 outcome、process、style、efficiency 四类目标；配合 traces 和 online/offline metrics 去监控成本、性能和失败模式。GDPval 则代表了工业界把评测直接拉到真实职业交付物和 expert blind review 的方向。([OpenAI Developers][12])

Google 的 ADK User Simulation 代表的是另一条工业路线：与其手写脆弱的多轮脚本，不如把评测目标写成 starting_prompt + conversation_plan，让 LLM-powered user simulator 动态推进对话，再用 turn budget、persona 和 criteria 控制范围。它本质上是在把“用户模拟”从 demo 级技巧，变成可回归的 goal-oriented eval 机制，尤其适合 support、assistant 和多轮 workflow agent。([Google Developers Blog][13])

把学术界和工业界放在一起看，我觉得当前最成熟的 Agent 评测方法论可以压缩成七条：第一，优先做 **execution-grounded eval**；第二，同时看 **outcome 和 trajectory**；第三，把 **reliability** 单独量化，不要只报一次 pass@1；第四，混合 **deterministic grader、LLM judge 和 human calibration**；第五，把 **cost、latency、token usage** 当成一等公民；第六，把 **task ambiguity、contamination、simulator fidelity** 当成 benchmark 质量问题持续审计；第七，离线 eval 只是起点，上线后必须叠加 **production monitoring、A/B 和人工抽检**。这套框架，基本得到了 Anthropic、OpenAI、Google 以及近两年的 meta-eval 工作共同支持。([Anthropic][11])

我自己的判断是，接下来最值得盯的，不是哪个新 benchmark 又多了几分，而是四个未解难点。第一，开放网络环境里的**评测完整性**，尤其是 contamination 和 eval awareness；第二，专业场景里 simulator 是否真的 faithful，OccuBench 也把 simulator quality 明确提成了评测可靠性的关键变量；第三，长时程、异步、多 agent 环境的真实任务分布，GAIA2 和 RE-Bench 只是开头；第四，安全评测如何从“攻击成功率”真正走到“业务后果、合规后果、审计后果”的 execution-grounded 判定。谁先把这四个问题做扎实，谁的 agent eval 才真正有工业价值。([Anthropic][14])

下一条可继续把这些 benchmark 按 browser agent、coding agent、deep research agent、enterprise workflow agent 四类整理成一张阅读地图。

[1]: https://arxiv.org/abs/2503.16416 "https://arxiv.org/abs/2503.16416"
[2]: https://arxiv.org/abs/2510.11977 "https://arxiv.org/abs/2510.11977"
[3]: https://arxiv.org/abs/2307.13854 "https://arxiv.org/abs/2307.13854"
[4]: https://arxiv.org/abs/2506.11763 "https://arxiv.org/abs/2506.11763"
[5]: https://arxiv.org/abs/2404.07972 "https://arxiv.org/abs/2404.07972"
[6]: https://arxiv.org/abs/2406.12045 "https://arxiv.org/abs/2406.12045"
[7]: https://arxiv.org/abs/2310.06770 "https://arxiv.org/abs/2310.06770"
[8]: https://arxiv.org/abs/2311.12983 "https://arxiv.org/abs/2311.12983"
[9]: https://arxiv.org/abs/2406.13352 "https://arxiv.org/abs/2406.13352"
[10]: https://arxiv.org/abs/2507.02825 "https://arxiv.org/abs/2507.02825"
[11]: https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents "https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents"
[12]: https://developers.openai.com/api/docs/guides/evaluation-best-practices "https://developers.openai.com/api/docs/guides/evaluation-best-practices"
[13]: https://developers.googleblog.com/announcing-user-simulation-in-adk-evaluation/ "https://developers.googleblog.com/announcing-user-simulation-in-adk-evaluation/"
[14]: https://www.anthropic.com/engineering/eval-awareness-browsecomp "https://www.anthropic.com/engineering/eval-awareness-browsecomp"

