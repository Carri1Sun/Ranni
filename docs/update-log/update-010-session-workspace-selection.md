# Update 010: Session 执行目录选择

- Commit: `eec5f88d96dde2d01d1acd39bc351060871ca075`
- Date: `2026-05-04T11:05:52+08:00`
- Type: `feat`
- Tests: `npm run typecheck`; `npm run lint`; `npm run build`

## 变更概述

这一版让每个 session 创建时选择执行目录，agent 工具以该目录为 workspace root 运行。

## 读到的改动

- `SessionRecord` 增加 `workspaceRoot`。
- 没有 session 或新建 session 时打开执行目录选择弹窗。
- 前端保存“已添加的目录”，并展示推荐目录。
- 通过 `/api/workspaces/pick` 调用系统目录选择器：
  - macOS: `osascript choose folder`
  - Windows: PowerShell `FolderBrowserDialog`
  - Linux: `zenity`，失败后尝试 `kdialog`
- 服务端新增 workspace APIs：
  - `GET /api/workspaces/list`
  - `GET /api/workspaces/roots`
  - `POST /api/workspaces/validate`
  - `POST /api/workspaces/pick`
- `/api/chat` 校验 `workspaceRoot` 并传入 `runAgentTurn`。
- `lib/workspace.ts`、`lib/tools.ts`、`lib/research.ts` 改为支持 per-run workspace。
- 文件工具、终端工具、research notebook 都在所选 workspace 下工作。

## 设计理解

Ranni 自己的项目目录不应该天然等于 agent 执行目录。Session 绑定 workspace 后，用户可以让 agent 在任意本机项目中工作，同时工具层通过 `resolveWorkspacePath` 阻止越界访问。

## 影响范围

- 每个 session 有明确文件系统边界。
- 终端 `cwd`、文件读写、搜索、`.ranni`、`research` 都相对所选 workspace。
- 本地 agent 更接近“选择一个项目再开始工作”的产品模型。

## 后续注意

任何新工具只要触碰文件系统，都必须接收并使用 `workspaceRoot`。

