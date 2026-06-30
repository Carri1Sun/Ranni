#!/usr/bin/env bash
# Ranni 启动脚本
#
# 用法:
#   ./scripts/start.sh           # 等同于 dev
#   ./scripts/start.sh dev       # 开发模式：前端 5173 + 后端 3001 并行热重载
#   ./scripts/start.sh build     # 生产构建
#   ./scripts/start.sh start     # 生产模式：Express 托管前端并提供 API（需先 build）
#
# 脚本会自动:
#   1. 切换到项目根目录
#   2. 检查 node / npm 是否可用
#   3. 未安装依赖时自动 npm install
#   4. 缺少 .env.local 时从 .env.example 复制一份并提醒填写

set -euo pipefail

# 切换到项目根目录（脚本在 scripts/ 下）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

COMMAND="${1:-dev}"

# 带前缀的彩色输出
info()  { printf "\033[1;34m[Ranni]\033[0m %s\n" "$*"; }
warn()  { printf "\033[1;33m[Ranni]\033[0m %s\n" "$*"; }
error() { printf "\033[1;31m[Ranni]\033[0m %s\n" "$*" >&2; }

# 1. 检查 node / npm
command -v node >/dev/null 2>&1 || { error "未检测到 node，请先安装 Node.js"; exit 1; }
command -v npm  >/dev/null 2>&1 || { error "未检测到 npm，请先安装 npm"; exit 1; }

# 2. 检查依赖
if [ ! -d "node_modules" ]; then
  info "未检测到 node_modules，开始安装依赖..."
  npm install
fi

# 3. 检查 .env.local
if [ ! -f ".env.local" ]; then
  if [ -f ".env.example" ]; then
    info "未检测到 .env.local，从 .env.example 复制一份..."
    cp .env.example .env.local
    warn "已创建 .env.local，请填写其中的 API Key 后重新运行本脚本"
    warn "（至少需要 DEEPSEEK_API_KEY，搜索能力需要 TAVILY_API_KEY）"
  fi
fi

# 4. 按模式启动
case "$COMMAND" in
  dev)
    info "以开发模式启动 Ranni"
    info "前端: http://127.0.0.1:5173"
    info "后端: http://127.0.0.1:3001"
    npm run dev
    ;;
  build)
    info "执行生产构建"
    npm run build
    info "构建完成，运行 ./scripts/start.sh start 即可以生产模式启动"
    ;;
  start)
    if [ ! -d "dist" ]; then
      error "未检测到 dist 目录，请先运行: ./scripts/start.sh build"
      exit 1
    fi
    info "以生产模式启动 Ranni（Express 托管前端并提供 API）"
    npm run start
    ;;
  *)
    error "未知命令: $COMMAND"
    cat <<'USAGE'
用法: ./scripts/start.sh [dev|build|start]
  dev    开发模式（默认），前后端并行热重载
  build  生产构建
  start  生产模式启动（需先 build）
USAGE
    exit 1
    ;;
esac
