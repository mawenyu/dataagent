#!/usr/bin/env bash
# build-opencode.sh — 从 mawenyu/opencode fork 的 dataagent-v2 分支构建定制 opencode2，
# 并把本目录(agents/)下的 plugins/tools/skills/commands 部署到指定项目。
#
# 用法:
#   ./build-opencode.sh [--target DIR] [--skip-build]
#
#   --target DIR   扩展部署目标项目目录（默认当前目录），会写入 DIR/.opencode/
#   --skip-build   跳过源码构建，仅部署扩展
set -euo pipefail

FORK_REPO="${FORK_REPO:-https://github.com/mawenyu/opencode.git}"
FORK_BRANCH="${FORK_BRANCH:-dataagent-v2}"
WORK_DIR="${WORK_DIR:-$HOME/.cache/opencode-dataagent-build}"
TARGET_DIR="."
SKIP_BUILD=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET_DIR="$2"; shift 2;;
    --skip-build) SKIP_BUILD=1; shift;;
    *) echo "unknown arg: $1" >&2; exit 1;;
  esac
done

AGENTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> agents dir:  $AGENTS_DIR"
echo "==> target dir:  $TARGET_DIR"

# ---------- 1. 构建定制 opencode2 ----------
if [[ $SKIP_BUILD -eq 0 ]]; then
  if [[ ! -d "$WORK_DIR/.git" ]]; then
    echo "==> cloning fork $FORK_REPO ($FORK_BRANCH)"
    git clone --depth 50 --branch "$FORK_BRANCH" "$FORK_REPO" "$WORK_DIR"
  else
    echo "==> updating fork in $WORK_DIR"
    git -C "$WORK_DIR" fetch origin "$FORK_BRANCH" --depth 50
    git -C "$WORK_DIR" reset --hard "origin/$FORK_BRANCH"
  fi

  cd "$WORK_DIR"
  # opencode v2 用 bun 构建
  if ! command -v bun >/dev/null 2>&1; then
    echo "!! bun 未安装。安装: curl -fsSL https://bun.sh/install | bash" >&2
    exit 1
  fi
  echo "==> bun install"
  bun install
  echo "==> building opencode (packages/opencode)"
  (cd packages/opencode && bun run build) || bun run build
  echo "==> build done. 产物见 $WORK_DIR/packages/opencode/dist"
else
  echo "==> skip build"
fi

# ---------- 2. 部署扩展到 target 项目 ----------
# plugins/ 含 a2ui-tools.ts（render_a2ui/request_user_confirm/render_report/
# render_slides/update_canvas 共 5 个工具注册,codemode:false —— 否则 provider
# 按名调用得 Unknown tool）。上游样例已移到 upstream-examples/(不部署)。
echo "==> deploying extensions to $TARGET_DIR/.opencode"
mkdir -p "$TARGET_DIR/.opencode"
for d in plugins tool skills command agent; do
  if [[ -d "$AGENTS_DIR/$d" ]]; then
    mkdir -p "$TARGET_DIR/.opencode/$d"
    cp -rv "$AGENTS_DIR/$d/." "$TARGET_DIR/.opencode/$d/"
  fi
done
if [[ ! -f "$TARGET_DIR/.opencode/opencode.jsonc" && -f "$AGENTS_DIR/opencode.jsonc.example" ]]; then
  cp -v "$AGENTS_DIR/opencode.jsonc.example" "$TARGET_DIR/.opencode/opencode.jsonc"
fi

echo "==> all done."
echo "    启动: cd $TARGET_DIR && bun run --conditions=browser <fork>/packages/cli/src/index.ts serve --port 4096 --hostname 127.0.0.1"
echo "    （日常三件套直接 scripts/up.sh；无 opencode2 安装命令，bun 源码运行）"
