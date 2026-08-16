#!/usr/bin/env bash
# deploy-frontend.sh — 构建产物部署到 /var/www/blog/agui（nginx data-agent block 伺服）。
#
# 用法:
#   scripts/deploy-frontend.sh [DIST_DIR]     # 默认 vue-frontend/dist
#
# 注意:
# - 只同步 dist 内容；a2ui-gallery.html / dataagent/ 等非 dist 产物保留
# - assets/ 按 hash 文件名累积旧 bundle，本脚本清理早于本次部署批次的陈旧文件
#   （cp 不保留 mtime，同批文件 mtime ≈ 部署时刻；index.html 为批次锚点）
set -euo pipefail

DIST="${1:-vue-frontend/dist}"
TARGET="/var/www/blog/agui"

[[ -f "$DIST/index.html" ]] || { echo "!! $DIST/index.html 不存在 —— 先 npm run build" >&2; exit 1; }

# 批次锚点必须先于 cp 创建：cp 同批文件 mtime 不分先后，拿 index.html 当锚点
# 会把同批 assets 误判为陈旧（实测首轮误删全部 206 个，站点白屏）
MARKER=$(mktemp)
trap 'rm -f "$MARKER"' EXIT

echo "==> deploy $DIST → $TARGET"
cp -r "$DIST/." "$TARGET/"

# 清理陈旧 hashed assets：只删 mtime 早于部署起始时刻的文件（上一批次的残留）
if [[ -d "$TARGET/assets" ]]; then
  pruned=$(find "$TARGET/assets" -type f ! -newer "$MARKER" -print -delete | wc -l)
  echo "==> pruned stale assets: $pruned"
fi

echo "==> done. 公网: http://101.34.246.179/agui/"
