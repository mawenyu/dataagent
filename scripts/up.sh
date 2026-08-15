#!/usr/bin/env bash
# P-P: 一键拉起 DataAgent 三件套（幂等;已健康的服务跳过）。
#
#   scripts/up.sh            # 缺啥起啥
#   scripts/up.sh --build    # gateway 强制重新 package(走 restart-gateway.sh 纪律)
#
# 三件套:
#   opencode :4096 (bun 源码运行, cwd=仓库根, .env.opencode 注入 serve 密码)
#   gateway  :8090 (java, 从 /tmp/agui-gateway-run.jar 副本运行 —— 见 restart-gateway.sh)
#   vite dev :3001 (npm run dev, predev 自动先构建 fork)
set -euo pipefail
cd "$(dirname "$0")/.."

BUILD=0
[[ "${1:-}" == "--build" ]] && BUILD=1

# 健康判定重试(宿主机忙时单次 curl 可能假阴性 → 误起重复实例)
gateway_healthy() {
  for _ in $(seq 1 8); do
    curl -s -m 2 http://127.0.0.1:8090/actuator/health | grep -q '"UP"' && return 0
    sleep 0.5
  done
  return 1
}

# ---- opencode :4096 ----
if curl -s -m 2 -o /dev/null http://127.0.0.1:4096/api/session; then
  echo "== opencode :4096 已在跑,跳过 =="
else
  echo "== 启动 opencode :4096 =="
  [[ -f .env.opencode ]] || { echo "!! 缺 .env.opencode(见 DELIVERY-README §1)" >&2; exit 1; }
  setsid nohup bash -c 'unset OPENCODE_MODELS_PATH && set -a && . ./.env.opencode && set +a \
    && bun run --conditions=browser /home/ubuntu/opencode-fork/packages/cli/src/index.ts \
         serve --port 4096 --hostname 127.0.0.1' > /tmp/opencode2.log 2>&1 < /dev/null &
  for i in $(seq 1 40); do
    curl -s -m 2 -o /dev/null http://127.0.0.1:4096/api/session && break
    sleep 0.5
  done
  curl -s -m 2 -o /dev/null http://127.0.0.1:4096/api/session || { echo "!! opencode 未就绪,查 /tmp/opencode2.log" >&2; exit 1; }
  echo "== opencode UP =="
fi

# ---- gateway :8090 ----
if [[ "$BUILD" == "1" ]]; then
  scripts/restart-gateway.sh
elif gateway_healthy; then
  echo "== gateway :8090 已在跑,跳过(重建用 scripts/up.sh --build) =="
else
  if [[ -f /tmp/agui-gateway-run.jar ]]; then
    echo "== 从 /tmp 副本直接启动 gateway(不重打包;重建用 --build) =="
    set -a; . ./.env.opencode; set +a   # P0: 密码经环境变量
    setsid nohup java -XX:TieredStopAtLevel=1 -Xmx384m -jar /tmp/agui-gateway-run.jar > /tmp/agui-gateway.log 2>&1 < /dev/null &
  else
    echo "== /tmp 副本不存在,走完整构建启动 =="
    scripts/restart-gateway.sh
  fi
  gateway_healthy || { echo "!! gateway 未就绪,查 /tmp/agui-gateway.log" >&2; exit 1; }
  echo "== gateway UP =="
fi

# ---- vite dev :3001 ----
if ss -tln 2>/dev/null | grep -q ':3001 '; then
  echo "== vite dev :3001 已在跑,跳过 =="
else
  echo "== 启动 vite dev :3001 =="
  setsid nohup bash -c 'cd vue-frontend && npm run dev -- --port 3001' > /tmp/vite.log 2>&1 < /dev/null &
  for i in $(seq 1 40); do
    ss -tln 2>/dev/null | grep -q ':3001 ' && break
    sleep 0.5
  done
  ss -tln 2>/dev/null | grep -q ':3001 ' || { echo "!! vite 未就绪,查 /tmp/vite.log" >&2; exit 1; }
  echo "== vite UP =="
fi

echo "== 全部就绪: opencode :4096 / gateway :8090 / vite :3001 =="
