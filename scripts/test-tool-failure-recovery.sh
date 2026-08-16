#!/usr/bin/env bash
# 验收 Test 5（MASTER-PROMPT §16 / ACCEPTANCE_TESTS.md）：
#   SQL/工具失败 → agent 修复或给出明确错误。
# 触发方式（与 Test 4 同属数据源不可用族，但断言不同）：会话内删掉 CSV 后
# 发起必须动工具的分析请求，观察失败后行为：
#   1) r2 run 仍 RUN_FINISHED（失败不拖垮 run）
#   2) 确有工具级失败（TOOL_CALL_RESULT「工具执行失败: 」前缀契约）
#   3) 恢复或明确错误 二选一（协议契约）：
#      a) RECOVERED —— 首次失败后仍有成功的 TOOL_CALL_RESULT（agent 换路径重试）
#      b) EXPLICIT  —— 最终文本答复明确承认数据不可用/失败
# 用法: scripts/test-tool-failure-recovery.sh [gateway-base-url]
set -u
BASE="${1:-http://127.0.0.1:8090}"
THREAD="tool-recovery-$(date +%s)"
CSV="sales-2026-08.csv"
PASS=0; FAIL=0

run_turn() {
  local run_id="$1" msg="$2" out
  out="/tmp/tr-$THREAD-$run_id.sse"
  timeout 170 curl -sN "$BASE/agent/run" -H 'Content-Type: application/json' \
    -d "{\"threadId\":\"$THREAD\",\"runId\":\"$run_id\",\"messages\":[{\"role\":\"user\",\"content\":\"$msg\"}]}" \
    > "$out"
  python3 - "$out" <<'EOF'
import json, sys
texts=[]; terminal=None
failed_seen=False; recovered=False; toolfail=None
for line in open(sys.argv[1]):
    if not line.startswith('data:'): continue
    try: e=json.loads(line[5:])
    except: continue
    t=e.get('type')
    if t=='TEXT_MESSAGE_CONTENT': texts.append(e['delta'])
    elif t=='TOOL_CALL_RESULT':
        c=e.get('content','')
        if c.startswith('工具执行失败: '):
            failed_seen=True; toolfail=toolfail or c[:120]
        elif failed_seen:
            recovered=True
    elif t=='RUN_FINISHED': terminal='RUN_FINISHED'
    elif t=='RUN_ERROR': terminal='RUN_ERROR: '+e.get('message','')
print(f"TERMINAL={terminal}")
print(f"FAILED={failed_seen}")
print(f"RECOVERED={recovered}")
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

R2=$(run_turn r2 "用 $CSV 算每个区域的销售额占比，并画成图表")
echo "$R2"
check "r2 run 正常收尾(工具失败不拖垮 run)" "TERMINAL=RUN_FINISHED" "$R2"
check "r2 确有工具级失败(工具执行失败前缀契约)" "FAILED=True" "$R2"
if echo "$R2" | grep -q "RECOVERED=True"; then
  echo "PASS: 失败后 agent 换路径重试并成功(RECOVERED)"
  PASS=$((PASS+1))
elif echo "$R2" | grep -q "不存在\|无法\|失败\|没有\|找不到"; then
  echo "PASS: agent 未自愈但给出明确错误答复(EXPLICIT)"
  PASS=$((PASS+1))
else
  echo "FAIL: 失败后既未恢复也未给出明确错误"
  FAIL=$((FAIL+1))
fi

echo "== RESULT: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
