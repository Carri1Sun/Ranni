# Update 006: Logo 资产与站点品牌

- Commit: `64944b2d100c87c4a2d4174b6eeccfe713310d5e`
- Date: `2026-05-03T18:48:08+08:00`
- Type: `feat`
- Tests: `npm run assets:logo`; `npm run typecheck`; `npm run lint`; `npm run build`

## 变更概述

这一版把根目录 `logo.png` 接入站点品牌，并生成 favicon、PWA manifest 和多尺寸 logo。

## 读到的改动

- 新增根目录 `logo.png`。
- 新增 `scripts/generate-logo-assets.py`，用 Pillow 生成圆角图标资产。
- `package.json` 增加 `npm run assets:logo`。
- `public/` 新增 `favicon.ico`、多尺寸 favicon、apple touch icon、`logo.png`、`logo-192.png`、`logo-512.png`、`site.webmanifest`。
- `index.html` 增加 icon、manifest、theme-color 等元信息。
- 前端启动页、侧边栏品牌位使用生成后的 logo。

## 设计理解

源图只保留一份在根目录，派生尺寸由脚本生成。这比手工维护多份图片更稳定，也方便以后替换品牌图。

## 影响范围

- 浏览器 tab、收藏、移动端添加到主屏等场景都有对应图标。
- UI 中 Ranni 品牌识别更明确。

## 后续注意

修改 `logo.png` 后应运行 `npm run assets:logo` 并检查生成资产是否一起提交。

