# Update 005: Ignore 本地 Research 输出

- Commit: `db6e622a0050270dd77b01ef9e3010759d7caf1a`
- Date: `2026-05-03T18:34:22+08:00`
- Type: `chore`
- Tests: not run, ignore-only change

## 变更概述

这一版把 `research/` 加入 `.gitignore`。

## 读到的改动

- `.gitignore` 增加 `research/`。
- 本地 research notebook、临时报告、运行产物不会被误提交。

## 设计理解

`research/` 是运行期产物，不是项目源代码。把它忽略可以让 agent 运行产生的草稿、临时证据和探索记录留在本机，不污染版本库。

## 影响范围

- Git 工作区更干净。
- 想保留为正式资料的研究成果，需要主动移动到 `docs/` 或其他受版本控制的目录。

## 后续注意

运行期目录应默认忽略；只有经过整理、具备长期价值的内容才进入 `docs/`。

