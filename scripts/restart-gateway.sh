#!/usr/bin/env bash
# P-P: gateway 重启纪律（固化）—— kill → package → 拷贝 /tmp 副本 → 从副本启动。
#
# 为什么从 /tmp 副本运行:直接 java -jar target/*.jar 时,下次 mvn package 会原地
# 覆盖运行中的 jar,热路径类加载可能 wedge(实测踩过)。副本运行 = 构建与运行解耦,
# 且 /tmp/agui-gateway-run.jar 始终是"正在运行的那个制品",可审计(ls -l 时间戳)。
#
# 用法:
#   scripts/restart-gateway.sh            # kill → package(跳过测试) → 副本启动
#   scripts/restart-gateway.sh --tests    # 先 mvn test 全量,绿了才重启
set -euo pipefail
cd "$(dirname "$0")/.."   # 仓库根:workspace 相对落点 = ./workspace(与现行运行一致)

JAR=target/opencode-agui-gateway-1.0.0.jar
RUN_JAR=/tmp/agui-gateway-run.jar
LOG=/tmp/agui-gateway.log
PORT=8090

if [[ "${1:-}" == "--tests" ]]; then
  echo "== mvn test =="
  mvn -f gateway/pom.xml test
fi

echo "== package =="
mvn -f gateway/pom.xml -q package -DskipTests

GPID=$(ss -tlnp 2>/dev/null | grep ":$PORT " | grep -oP '(?<=pid=)\d+' | head -1 || true)
if [[ -n "${GPID:-}" ]]; then
  echo "== kill old gateway pid=$GPID =="
  kill "$GPID" || true
  for _ in $(seq 1 20); do
    ss -tln 2>/dev/null | grep -q ":$PORT " || break
    sleep 0.5
  done
fi

echo "== copy artifact → $RUN_JAR =="
cp "gateway/$JAR" "$RUN_JAR"

# P0: opencode 密码经环境变量注入(application.yml 不再入库明文)
[[ -f .env.opencode ]] || { echo "!! 缺 .env.opencode(OPENCODE_SERVER_PASSWORD)" >&2; exit 1; }
set -a; . ./.env.opencode; set +a
[[ -n "${OPENCODE_SERVER_PASSWORD:-}" ]] || { echo "!! .env.opencode 缺 OPENCODE_SERVER_PASSWORD" >&2; exit 1; }

echo "== start from $RUN_JAR (cwd=$(pwd)) =="
setsid nohup java -XX:TieredStopAtLevel=1 -Xmx384m -jar "$RUN_JAR" > "$LOG" 2>&1 < /dev/null &

for i in $(seq 1 40); do
  if curl -s -m 2 "http://127.0.0.1:$PORT/actuator/health" | grep -q '"UP"'; then
    echo "== gateway UP on :$PORT (${i}×0.5s) =="
    exit 0
  fi
  sleep 0.5
done
echo "!! gateway failed to become healthy; last log:" >&2
tail -20 "$LOG" >&2
exit 1
