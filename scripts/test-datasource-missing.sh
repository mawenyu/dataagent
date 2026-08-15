#!/usr/bin/env bash
# 验收 Test 4（ACCEPTANCE_TESTS.md）：数据源不可用 → 友好错误 UI 的 wire 侧契约。
# 场景：会话内删掉 sales CSV 后提问 → 期望
#   1) 工具级失败以 TOOL_CALL_RESULT 下发且 content 以「工具执行失败: 」开头
#      （前端工具卡据此渲染 ✗失败态 —— fork use-default-render-tool.ts F3 补全）
#   2) run 仍 RUN_FINISHED 正常收尾（工具失败 ≠ run 崩溃）
#   3) agent 最终答复承认文件不可用（软断言，打印原文供人工核对）
# 用法: scripts/test-datasource-missing.sh [gateway-base-url]
set -u
BASE="${1:-http://127.0.0.1:8090}"
THREAD="ds-missing-$(date +%s)"
CSV="sales-2026-08.csv"
PASS=0; FAIL=0

run_turn() {
  local run_id="$1" msg="$2" out
  out="/tmp/dm-$THREAD-$run_id.sse"
  timeout 170 curl -sN "$BASE/agent/run" -H 'Content-Type: application/json' \
    -d "{\"threadId\":\"$THREAD\",\"runId\":\"$run_id\",\"messages\":[{\"role\":\"user\",\"content\":\"$msg\"}]}" \
    > "$out"
  python3 - "$out" <<'EOF'
import json, sys
texts=[]; terminal=None; toolfail=None
for line in open(sys.argv[1]):
    if not line.startswith('data:'): continue
    try: e=json.loads(line[5:])
    except: continue
    t=e.get('type')
    if t=='TEXT_MESSAGE_CONTENT': texts.append(e['delta'])
    elif t=='TOOL_CALL_RESULT' and e.get('content','').startswith('工具执行失败: '):
        toolfail=e['content'][:120]
    elif t=='RUN_FINISHED': terminal='RUN_FINISHED'
    elif t=='RUN_ERROR': terminal='RUN_ERROR: '+e.get('message','')
print(f"TERMINAL={terminal}")
print(f"TOOLFAIL={toolfail or '-'}")
print(f"TEXT={''.join(texts)[-300:]}")
EOF
}

check() { # desc expected_substring haystack
  if echo "$3" | grep -q "$2"; then echo "PASS: $1"; PASS=$((PASS+1));
  else echo "FAIL: $1 (expected '$2')"; FAIL=$((FAIL+1)); fi
}

echo "== thread: $THREAD =="
R1=$(run_turn r1 "workspace 里有哪些数据文件？")
echo "$R1"; check "r1 建会话+播种正常结束" "TERMINAL=RUN_FINISHED" "$R1"

# 删掉该会话工作目录里的 CSV（会话级文件 API，不影响其他会话的 seed）
DEL=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/chat/threads/$THREAD/files/$CSV")
if [ "$DEL" = "204" ]; then echo "PASS: 删除会话内 $CSV → 204"; PASS=$((PASS+1));
else echo "FAIL: 删除会话内 $CSV → $DEL (expected 204)"; FAIL=$((FAIL+1)); fi

R2=$(run_turn r2 "分析 $CSV 里销售额最高的区域")
echo "$R2"
check "r2 run 正常收尾(工具失败不拖垮 run)" "TERMINAL=RUN_FINISHED" "$R2"
check "r2 工具级失败按契约下发(工具执行失败前缀)" "TOOLFAIL=工具执行失败: " "$R2"
check "r2 答复承认数据源不可用(软)" "$CSV\|不存在\|无法" "$R2"

echo "== RESULT: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
