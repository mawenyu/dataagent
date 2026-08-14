#!/usr/bin/env bash
# Frontend-tool（AG-UI client-side tools）端到端实测：
#   1) RunAgentInput.tools 带 showNotification schema → agent 应以 TOOL_CALL_* 调起前端工具并结束 run
#   2) 浏览器执行后回发 role=tool 结果消息 → gateway 构造续跑 prompt → agent 基于结果自然回答
# 用法: scripts/test-frontend-tool.sh [gateway-base-url]
set -u
BASE="${1:-http://127.0.0.1:8090}"
THREAD="ft-$(date +%s)"
PASS=0; FAIL=0

check() { # desc expected_substring haystack
  if echo "$3" | grep -q "$2"; then echo "PASS: $1"; PASS=$((PASS+1));
  else echo "FAIL: $1 (expected '$2')"; FAIL=$((FAIL+1)); fi
}

TOOL_SCHEMA='{"name":"showNotification","description":"Show a notification toast in the user web UI","parameters":{"type":"object","properties":{"title":{"type":"string"},"message":{"type":"string"},"type":{"type":"string","enum":["info","success","warning","error"]}},"required":["title","message"]}}'

echo "== turn 1: agent calls the frontend tool =="
timeout 170 curl -sN "$BASE/agent/run" -H 'Content-Type: application/json' \
  -d "{\"threadId\":\"$THREAD\",\"runId\":\"r1\",\"tools\":[$TOOL_SCHEMA],\"messages\":[{\"role\":\"user\",\"content\":\"请调用 showNotification 前端工具通知我：标题=部署完成，内容=v2 上线成功，类型=success。不要自己回答，直接调用工具。\"}]}" \
  > /tmp/ft-$THREAD-1.sse

S1=$(python3 - /tmp/ft-$THREAD-1.sse <<'EOF'
import json, sys
evs=[json.loads(l[5:]) for l in open(sys.argv[1]) if l.startswith('data:')]
tc=[e for e in evs if e.get('type')=='TOOL_CALL_START']
args=''.join(e.get('delta','') for e in evs if e.get('type')=='TOOL_CALL_ARGS')
terminal=evs[-1].get('type') if evs else 'NONE'
callid=tc[0]['toolCallId'] if tc else ''
print(f"TOOL={tc[0].get('toolCallName') if tc else '-'}")
print(f"CALLID={callid}")
print(f"ARGS={args}")
print(f"TERMINAL={terminal}")
EOF
)
echo "$S1"
check "agent 调起 showNotification" "TOOL=showNotification" "$S1"
check "参数含标题" "部署完成" "$S1"
check "run 正常结束(等浏览器执行)" "TERMINAL=RUN_FINISHED" "$S1"
CALLID=$(echo "$S1" | sed -n 's/^CALLID=//p')

echo "== turn 2: browser sends role=tool result, agent continues =="
timeout 170 curl -sN "$BASE/agent/run" -H 'Content-Type: application/json' \
  -d "{\"threadId\":\"$THREAD\",\"runId\":\"r2\",\"tools\":[$TOOL_SCHEMA],\"messages\":[{\"role\":\"user\",\"content\":\"请调用 showNotification 前端工具通知我：标题=部署完成，内容=v2 上线成功，类型=success。\"},{\"role\":\"assistant\",\"toolCalls\":[{\"id\":\"$CALLID\",\"type\":\"function\",\"function\":{\"name\":\"showNotification\",\"arguments\":\"{\\\"title\\\":\\\"部署完成\\\",\\\"message\\\":\\\"v2 上线成功\\\",\\\"type\\\":\\\"success\\\"}\"}}]},{\"role\":\"tool\",\"toolCallId\":\"$CALLID\",\"content\":\"Notification displayed to the user (title=部署完成).\"}]}" \
  > /tmp/ft-$THREAD-2.sse

S2=$(python3 - /tmp/ft-$THREAD-2.sse <<'EOF'
import json, sys
evs=[json.loads(l[5:]) for l in open(sys.argv[1]) if l.startswith('data:')]
text=''.join(e.get('delta','') for e in evs if e.get('type')=='TEXT_MESSAGE_CONTENT')
terminal=evs[-1].get('type') if evs else 'NONE'
print(f"TERMINAL={terminal}")
print(f"TEXT={text[-200:]}")
EOF
)
echo "$S2"
check "续跑正常结束" "TERMINAL=RUN_FINISHED" "$S2"
check "agent 基于工具结果回答" "TEXT=.\+" "$S2"

echo "== RESULT: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
