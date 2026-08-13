#!/usr/bin/env bash
# 需求7-1 实测脚本：同一 threadId 连续 5 轮对话，验证不中断且上下文正确。
# 用法: scripts/test-multi-turn.sh [gateway-base-url]
# 证据输出: 每轮的 AG-UI 事件汇总 + 第 5 轮必须记得第 1 轮埋的暗号。
set -u
BASE="${1:-http://127.0.0.1:8090}"
THREAD="multi-turn-$(date +%s)"
PASS=0; FAIL=0

run_turn() {
  local run_id="$1" msg="$2" out
  out="/tmp/mt-$THREAD-$run_id.sse"
  timeout 170 curl -sN "$BASE/opencode/ag-ui" -H 'Content-Type: application/json' \
    -d "{\"threadId\":\"$THREAD\",\"runId\":\"$run_id\",\"messages\":[{\"role\":\"user\",\"content\":\"$msg\"}]}" \
    > "$out"
  python3 - "$out" <<'EOF'
import json, sys
texts=[]; terminal=None; ntools=0; usage=None
for line in open(sys.argv[1]):
    if not line.startswith('data:'): continue
    try: e=json.loads(line[5:])
    except: continue
    t=e.get('type')
    if t=='TEXT_MESSAGE_CONTENT': texts.append(e['delta'])
    elif t=='TOOL_CALL_START': ntools+=1
    elif t=='RUN_FINISHED': terminal='RUN_FINISHED'
    elif t=='RUN_ERROR': terminal='RUN_ERROR: '+e.get('message','')
    elif t=='CUSTOM' and e.get('name')=='context_usage': usage=e['value']
text=''.join(texts)
print(f"TERMINAL={terminal}")
print(f"TOOLS={ntools}")
print(f"CTX={usage['contextSize'] if usage else '-'}")
print(f"TEXT={text[-300:]}")
EOF
}

check() { # desc expected_substring haystack
  if echo "$3" | grep -q "$2"; then echo "PASS: $1"; PASS=$((PASS+1));
  else echo "FAIL: $1 (expected '$2')"; FAIL=$((FAIL+1)); fi
}

echo "== thread: $THREAD =="
R1=$(run_turn r1 "记住暗号：蓝鲸42。然后告诉我 workspace 里有哪些数据文件")
echo "$R1"; check "turn1 正常结束" "TERMINAL=RUN_FINISHED" "$R1"

R2=$(run_turn r2 "sales-2026-08.csv 里销售额最高的区域是哪里？")
echo "$R2"; check "turn2 正常结束" "TERMINAL=RUN_FINISHED" "$R2"; check "turn2 用了工具" "TOOLS=[1-9]" "$R2"

R3=$(run_turn r3 "哪个品类销售额最高？")
echo "$R3"; check "turn3 正常结束" "TERMINAL=RUN_FINISHED" "$R3"

R4=$(run_turn r4 "把前两个结论合在一起给我一句话总结")
echo "$R4"; check "turn4 正常结束" "TERMINAL=RUN_FINISHED" "$R4"

R5=$(run_turn r5 "我们最开始约定的暗号是什么？")
echo "$R5"; check "turn5 正常结束" "TERMINAL=RUN_FINISHED" "$R5"; check "turn5 记得暗号(上下文正确)" "蓝鲸42" "$R5"

echo "== RESULT: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
