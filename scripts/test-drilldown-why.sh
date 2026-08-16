#!/usr/bin/env bash
# 验收 Test 3（MASTER-PROMPT §16 / ACCEPTANCE_TESTS.md）：
#   drill down「为什么？」—— R1 建立分析上下文（含一个明确结论），
#   R2 用「为什么？」继续下钻，依赖上下文理解指代并给出因果解释。
# 协议级断言：
#   1) 两轮均 RUN_FINISHED（drill down 不打断会话）
#   2) R2 contextSize > R1（上下文累积，指代解析发生在同 thread）
#   3) R2 答复为实质性因果解释（软断言：长度 >=50 字且含因果连接词）
# 用法: scripts/test-drilldown-why.sh [gateway-base-url]
set -u
BASE="${1:-http://127.0.0.1:8090}"
THREAD="drilldown-$(date +%s)"
PASS=0; FAIL=0

run_turn() {
  local run_id="$1" msg="$2" out
  out="/tmp/dd-$THREAD-$run_id.sse"
  timeout 170 curl -sN "$BASE/agent/run" -H 'Content-Type: application/json' \
    -d "{\"threadId\":\"$THREAD\",\"runId\":\"$run_id\",\"messages\":[{\"role\":\"user\",\"content\":\"$msg\"}]}" \
    > "$out"
  python3 - "$out" <<'EOF'
import json, sys
texts=[]; terminal=None; ntools=0; ctx=None
for line in open(sys.argv[1]):
    if not line.startswith('data:'): continue
    try: e=json.loads(line[5:])
    except: continue
    t=e.get('type')
    if t=='TEXT_MESSAGE_CONTENT': texts.append(e['delta'])
    elif t=='TOOL_CALL_START': ntools+=1
    elif t=='RUN_FINISHED': terminal='RUN_FINISHED'
    elif t=='RUN_ERROR': terminal='RUN_ERROR: '+e.get('message','')
    elif t=='CUSTOM' and e.get('name')=='context_usage': ctx=e['value']['contextSize']
text=''.join(texts)
print(f"TERMINAL={terminal}")
print(f"TOOLS={ntools}")
print(f"CTX={ctx if ctx is not None else '-'}")
print(f"TEXTLEN={len(text)}")
print(f"TEXT={text[-300:]}")
EOF
}

check() { # desc expected_substring haystack
  if echo "$3" | grep -q "$2"; then echo "PASS: $1"; PASS=$((PASS+1));
  else echo "FAIL: $1 (expected '$2')"; FAIL=$((FAIL+1)); fi
}

echo "== thread: $THREAD =="
R1=$(run_turn r1 "分析 sales-2026-08.csv：哪个区域销售额最低？直接给结论")
echo "$R1"
check "r1 正常结束" "TERMINAL=RUN_FINISHED" "$R1"

R2=$(run_turn r2 "为什么？")
echo "$R2"
check "r2 正常结束(drill down 不断流)" "TERMINAL=RUN_FINISHED" "$R2"
check "r2 给出因果解释(软: 因果连接词)" "因为\|原因\|由于\|主要\|主因\|导致\|缺失\|依赖\|源于" "$R2"

CTX1=$(echo "$R1" | sed -n 's/^CTX=//p')
CTX2=$(echo "$R2" | sed -n 's/^CTX=//p')
if [ "$CTX1" != "-" ] && [ "$CTX2" != "-" ] && [ "$CTX2" -gt "$CTX1" ]; then
  echo "PASS: r2 contextSize($CTX2) > r1($CTX1) —— 指代解析在同 thread 上下文"
  PASS=$((PASS+1))
else
  echo "FAIL: 上下文未累积 (r1 CTX=$CTX1, r2 CTX=$CTX2)"
  FAIL=$((FAIL+1))
fi

LEN2=$(echo "$R2" | sed -n 's/^TEXTLEN=//p')
if [ "${LEN2:-0}" -ge 50 ]; then
  echo "PASS: r2 答复为实质性解释(长度 $LEN2 >= 50)"
  PASS=$((PASS+1))
else
  echo "FAIL: r2 答复过短(长度 ${LEN2:-0})，不像 drill down 解释"
  FAIL=$((FAIL+1))
fi

echo "== RESULT: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
