#!/usr/bin/env bash
# 验收 Test 2（MASTER-PROMPT §16 / ACCEPTANCE_TESTS.md）：
#   上下文追问 —— R1 建立数据分析上下文，R2 "哪个区域表现最差？" 不显式
#   给文件名/前文，依赖同 thread 上下文作答。
# 协议级断言：
#   1) 两轮均 RUN_FINISHED
#   2) R1 用了数据工具（真实分析，非编造）
#   3) R2 的 contextSize > R1 的 contextSize（同 thread 上下文累积的 wire 证据）
#   4) R2 答复落在区域维度（软断言：含「区域」或具体区域名）
# 用法: scripts/test-context-followup.sh [gateway-base-url]
set -u
BASE="${1:-http://127.0.0.1:8090}"
THREAD="ctx-followup-$(date +%s)"
PASS=0; FAIL=0

run_turn() {
  local run_id="$1" msg="$2" out
  out="/tmp/cf-$THREAD-$run_id.sse"
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
print(f"TERMINAL={terminal}")
print(f"TOOLS={ntools}")
print(f"CTX={ctx if ctx is not None else '-'}")
print(f"TEXT={''.join(texts)[-300:]}")
EOF
}

check() { # desc expected_substring haystack
  if echo "$3" | grep -q "$2"; then echo "PASS: $1"; PASS=$((PASS+1));
  else echo "FAIL: $1 (expected '$2')"; FAIL=$((FAIL+1)); fi
}

echo "== thread: $THREAD =="
R1=$(run_turn r1 "sales-2026-08.csv 里销售额最高的区域是哪里？")
echo "$R1"
check "r1 正常结束" "TERMINAL=RUN_FINISHED" "$R1"
check "r1 用了数据工具" "TOOLS=[1-9]" "$R1"

R2=$(run_turn r2 "哪个区域表现最差？")
echo "$R2"
check "r2 正常结束" "TERMINAL=RUN_FINISHED" "$R2"
check "r2 答复落在区域维度(软)" "区域\|华东\|华北\|华南\|西南\|西北\|东北\|华中" "$R2"

CTX1=$(echo "$R1" | sed -n 's/^CTX=//p')
CTX2=$(echo "$R2" | sed -n 's/^CTX=//p')
if [ "$CTX1" != "-" ] && [ "$CTX2" != "-" ] && [ "$CTX2" -gt "$CTX1" ]; then
  echo "PASS: r2 contextSize($CTX2) > r1($CTX1) —— 同 thread 上下文累积"
  PASS=$((PASS+1))
else
  echo "FAIL: 上下文未累积 (r1 CTX=$CTX1, r2 CTX=$CTX2)"
  FAIL=$((FAIL+1))
fi

echo "== RESULT: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
