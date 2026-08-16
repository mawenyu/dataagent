#!/usr/bin/env bash
# 验收 Test 1（MASTER-PROMPT §16 / ACCEPTANCE_TESTS.md）：
#   "分析最近30天销售趋势" 全链路 wire 契约 ——
#   run created(RUN_STARTED) / planning(STEP_STARTED) / data tool executed
#   (TOOL_CALL_START+RESULT) / text streamed(TEXT_MESSAGE_* 多 delta) /
#   A2UI rendered(ACTIVITY_SNAPSHOT a2ui-surface) / RUN_FINISHED 收尾。
# 断言针对协议契约（事件序/结构化结果），不断言具体文案。
# 用法: scripts/test-sales-trend-e2e.sh [gateway-base-url]
set -u
BASE="${1:-http://127.0.0.1:8090}"
THREAD="sales-trend-$(date +%s)"
PASS=0; FAIL=0

OUT="/tmp/st-$THREAD.sse"
echo "== thread: $THREAD =="
timeout 240 curl -sN "$BASE/agent/run" -H 'Content-Type: application/json' \
  -d "{\"threadId\":\"$THREAD\",\"runId\":\"r1\",\"messages\":[{\"role\":\"user\",\"content\":\"分析最近30天销售趋势，告诉我最值得关注的问题\"}]}" \
  > "$OUT"

SUMMARY=$(python3 - "$OUT" <<'EOF'
import json, sys
first=None; last=None
steps=0; tc_start=0; tc_result=0
text_deltas=0; text=None
snapshots=0; chart=False
terminal=None; started=False
for line in open(sys.argv[1]):
    if not line.startswith('data:'): continue
    try: e=json.loads(line[5:])
    except: continue
    t=e.get('type')
    if first is None: first=t
    last=t
    if t=='RUN_STARTED': started=True
    elif t=='STEP_STARTED': steps+=1
    elif t=='TOOL_CALL_START': tc_start+=1
    elif t=='TOOL_CALL_RESULT': tc_result+=1
    elif t=='TEXT_MESSAGE_CONTENT':
        text_deltas+=1
        text=(text or '')+e.get('delta','')
    elif t=='ACTIVITY_SNAPSHOT':
        snapshots+=1
        raw=json.dumps(e, ensure_ascii=False)
        if 'Chart' in raw: chart=True
    elif t=='RUN_FINISHED': terminal='RUN_FINISHED'
    elif t=='RUN_ERROR': terminal='RUN_ERROR: '+e.get('message','')
print(f"FIRST={first}")
print(f"LAST={last}")
print(f"STARTED={started}")
print(f"STEPS={steps}")
print(f"TOOL_START={tc_start}")
print(f"TOOL_RESULT={tc_result}")
print(f"TEXT_DELTAS={text_deltas}")
print(f"SNAPSHOTS={snapshots}")
print(f"CHART={chart}")
print(f"TERMINAL={terminal}")
print(f"TEXT={(text or '')[-300:]}")
EOF
)
echo "$SUMMARY"

check() { # desc expected_substring haystack
  if echo "$3" | grep -q "$2"; then echo "PASS: $1"; PASS=$((PASS+1));
  else echo "FAIL: $1 (expected '$2')"; FAIL=$((FAIL+1)); fi
}

check "run created: RUN_STARTED 为首个事件"        "FIRST=RUN_STARTED"  "$SUMMARY"
check "planning: STEP_STARTED >=1"                 "STEPS=[1-9]"       "$SUMMARY"
check "data tool executed: TOOL_CALL_START >=1"    "TOOL_START=[1-9]"  "$SUMMARY"
check "result returned: TOOL_CALL_RESULT >=1"      "TOOL_RESULT=[1-9]" "$SUMMARY"
check "text streamed: TEXT_MESSAGE_CONTENT 多 delta" "TEXT_DELTAS=[2-9]\|TEXT_DELTAS=[1-9][0-9]" "$SUMMARY"
check "A2UI rendered: ACTIVITY_SNAPSHOT >=1"       "SNAPSHOTS=[1-9]"   "$SUMMARY"
check "chart in surface(软): 含 Chart 组件"         "CHART=True"        "$SUMMARY"
check "RUN_FINISHED 收尾且为末事件"                  "LAST=RUN_FINISHED"  "$SUMMARY"

echo "== RESULT: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
