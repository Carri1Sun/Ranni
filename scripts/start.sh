#!/usr/bin/env bash
# 启动 Ranni demo：前端 5173，后端 3001。

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

info()  { printf "\033[1;34m[Ranni]\033[0m %s\n" "$*"; }
error() { printf "\033[1;31m[Ranni]\033[0m %s\n" "$*" >&2; }

if [ "$#" -ne 0 ]; then
  error "启动脚本不接受参数，直接运行 ./scripts/start.sh 即可。"
  exit 1
fi

command -v node >/dev/null 2>&1 || {
  error "未检测到 Node.js，请先安装 Node.js。"
  exit 1
}

if [ ! -f ".env.local" ]; then
  error "未找到 .env.local，项目未启动。"
  error "请先根据 .env.example 创建并配置 .env.local。"
  exit 1
fi

if [ ! -x "node_modules/.bin/concurrently" ] ||
   [ ! -x "node_modules/.bin/tsx" ] ||
   [ ! -x "node_modules/.bin/vite" ]; then
  command -v pnpm >/dev/null 2>&1 || {
    error "项目依赖尚未安装，并且未检测到 pnpm。"
    exit 1
  }

  info "正在安装项目依赖……"
  pnpm install
fi

endpoint_available() {
  local url="$1"
  command -v curl >/dev/null 2>&1 && curl -fsS --max-time 1 "$url" >/dev/null 2>&1
}

port_owner() {
  local port="$1"

  if ! command -v lsof >/dev/null 2>&1; then
    return
  fi

  lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | paste -sd, -
}

if endpoint_available "http://127.0.0.1:5173/" &&
   endpoint_available "http://127.0.0.1:3001/health"; then
  info "Ranni 已经在运行。"
  info "前端: http://127.0.0.1:5173"
  info "后端: http://127.0.0.1:3001"
  exit 0
fi

for port in 5173 3001; do
  owner="$(port_owner "$port" || true)"
  if [ -n "$owner" ]; then
    error "端口 $port 已被其他进程占用（PID: $owner）。"
    error "请停止该进程后重新运行启动脚本。"
    exit 1
  fi
done

info "正在启动 Ranni……"
info "前端: http://127.0.0.1:5173"
info "后端: http://127.0.0.1:3001"

exec ./node_modules/.bin/concurrently -k \
  "./node_modules/.bin/tsx watch src/server/index.ts" \
  "./node_modules/.bin/vite"
