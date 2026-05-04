# Update 007: README 刷新

- Commit: `cf109dbe328c590c1954f2c3eda71c34507236a9`
- Date: `2026-05-03T20:48:56+08:00`
- Type: `docs`
- Tests: not run, docs only

## 变更概述

这一版重写 README，使其匹配 Web 运行时、三栏布局、provider 配置和本地工具能力。

## 读到的改动

- README 从旧状态更新为“本地优先 AI Agent 网页工作台”。
- 记录前端 `React + Vite`、后端 `Node.js + Express` 的运行方式。
- 补充功能概览、技术结构、环境变量、本地开发、构建、Logo 资产、后端 API、运行产物和设计文档。
- 明确当前版本不依赖 Electron。

## 设计理解

README 是项目入口文档，应回答“这是什么、怎么跑、有哪些能力、关键目录在哪里”。这次刷新让 README 从旧实现说明升级成面向当前产品状态的开发文档。

## 影响范围

- 新读者可以通过 README 启动项目。
- 后续功能改动需要继续同步 README，避免文档再次落后。

## 后续注意

README 不应承载所有架构细节。深入设计应放入 `docs/`，README 负责索引和快速启动。

