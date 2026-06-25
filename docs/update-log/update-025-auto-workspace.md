# Update 025: 免选目录自动工作区

## Summary

- 新增「不选择目录直接开始」入口：Ranni 会在本地自动创建一个独立工作目录，作为该 session 的执行边界。
- 默认根目录是 `~/Documents/Ranni-Workspace`，每个 session 目录命名为 `ranni-session-<sessionId>`。
- 可通过环境变量 `RANNI_DEFAULT_WORKSPACE` 覆盖自动工作区的根目录。

## Details

- `src/server/app.ts` 新增 `resolveDefaultWorkspaceBase()`：优先使用 `RANNI_DEFAULT_WORKSPACE`，否则在存在 `~/Documents` 时使用 `~/Documents/Ranni-Workspace`，否则退回 `~/Ranni-Workspace`，避免在没有 Documents 目录的环境里凭空创建文件夹。
- 新增 `createAutoSessionWorkspace(sessionId)`：在根目录下 `mkdir -p` 创建 `ranni-session-<sessionId>`，并对 sessionId 做防御性文件名清洗。
- 新增 `POST /api/workspaces/auto-create`，校验 sessionId、创建目录并返回 `base` 与 `path`；`GET /api/workspaces/roots` 额外返回 `defaultWorkspaceBase`，供前端展示提示。
- `components/agent-console.tsx` 中 `createSession` 支持显式传入 `id`，并抽出 `startSessionWithWorkspace` 复用确定/自动两条创建路径；目录选择弹窗和空状态都新增「自动开始」入口。

## Notes

- 这是本地 Web + Node 后端实现，不是 Electron。自动创建的目录受当前运行后端的系统用户权限限制。
- 自动目录与手动选择的目录一样作为 agent 执行边界：文件、终端、research 输出和 `.ranni` 任务记忆都落在该目录内。
- macOS 上建议放在 `~/Documents`，用户可直接在访达中找到 `Ranni-Workspace`。
