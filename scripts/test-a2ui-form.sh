#!/usr/bin/env bash
# A2UI 表单 + a2uiAction 回环实测：
#   1) agent 渲染筛选表单 surface（TextField/ChoicePicker/CheckBox + 提交按钮）
#   2) 模拟用户提交（forwardedProps.a2uiAction 带解析后的表单值）→ agent 续跑
#      并用同名 surfaceId 更新 surface
# 用法: scripts/test-a2ui-form.sh [gateway-base-url]
set -u
BASE="${1:-http://127.0.0.1:8090}"
THREAD="a2ui-form-$(date +%s)"
PASS=0; FAIL=0

check() { # desc expected_substring haystack
  if echo "$3" | grep -q "$2"; then echo "PASS: $1"; PASS=$((PASS+1));
  else echo "FAIL: $1 (expected '$2')"; FAIL=$((FAIL+1)); fi
}

CATALOG_CTX='{"description":"A2UI catalog (data-agent)","value":"form components: TextField{label,text(bindable)}, ChoicePicker{label,options,value(bindable)}, CheckBox{label,value(bindable)}, Slider, DateTimeInput, Button/ActionButton{label,action{event{name,context?}}}, MetricCard, DataTable, BarChart, InsightCard, layout Card/Column/Row/Text. One root id=root. Bind inputs via {path}; submit action context references the bound fields."}'

echo "== run 1: render form surface =="
# LLM 非确定性：偶尔只答文字不调 render_a2ui —— 最多试 2 次
for attempt in 1 2; do
  timeout 240 curl -sN "$BASE/agent/run" -H 'Content-Type: application/json' \
    -d "{\"threadId\":\"$THREAD\",\"runId\":\"r1-$attempt\",\"context\":[$CATALOG_CTX],\"messages\":[{\"role\":\"user\",\"content\":\"用 render_a2ui 渲染一个销售筛选表单（surfaceId=sales-filter）：TextField 品类关键词(绑定 keyword)、ChoicePicker 区域(全部/华北/华东/华南, 绑定 region)、CheckBox 含退货(绑定 includeReturns)、primary 提交按钮(action.event.name=apply_filter, context 引用三个绑定)。只渲染表单，不要分析数据。\"}]}" \
    > /tmp/a2f-$THREAD-1.sse

  S1=$(python3 - /tmp/a2f-$THREAD-1.sse <<'EOF'
import json, sys
evs=[json.loads(l[5:]) for l in open(sys.argv[1]) if l.startswith('data:')]
snaps=[e for e in evs if e.get('type')=='ACTIVITY_SNAPSHOT']
comps=[]
for s in snaps:
    for op in s['content']['a2ui_operations']:
        if 'updateComponents' in op: comps += [c['component'] for c in op['updateComponents']['components']]
print("COMPONENTS=" + ",".join(comps))
print("TERMINAL=" + (evs[-1].get('type') if evs else 'NONE'))
EOF
)
  echo "(attempt $attempt) $S1"
  echo "$S1" | grep -q "TextField" && break
done
check "表单 surface 已渲染" "TERMINAL=RUN_FINISHED" "$S1"
check "含 TextField" "TextField" "$S1"
check "含 ChoicePicker" "ChoicePicker" "$S1"
check "含 CheckBox" "CheckBox" "$S1"
check "含提交按钮" "Button" "$S1"

echo "== run 2: user submits the form (a2uiAction) =="
timeout 240 curl -sN "$BASE/agent/run" -H 'Content-Type: application/json' \
  -d "{\"threadId\":\"$THREAD\",\"runId\":\"r2\",\"forwardedProps\":{\"a2uiAction\":{\"version\":\"v0.9\",\"action\":{\"name\":\"apply_filter\",\"surfaceId\":\"sales-filter\",\"sourceComponentId\":\"submit-btn\",\"timestamp\":1,\"context\":{\"keyword\":\"笔记本\",\"region\":\"华北\",\"includeReturns\":false}}}},\"messages\":[{\"role\":\"user\",\"content\":\"（用户提交了筛选表单）\"}]}" \
  > /tmp/a2f-$THREAD-2.sse

S2=$(python3 - /tmp/a2f-$THREAD-2.sse <<'EOF'
import json, sys
evs=[json.loads(l[5:]) for l in open(sys.argv[1]) if l.startswith('data:')]
snaps=[e for e in evs if e.get('type')=='ACTIVITY_SNAPSHOT']
sids=[]
for s in snaps:
    for op in s['content']['a2ui_operations']:
        if 'createSurface' in op: sids.append(op['createSurface']['surfaceId'])
text=''.join(e.get('delta','') for e in evs if e.get('type')=='TEXT_MESSAGE_CONTENT')
print("SURFACES=" + ",".join(sids))
print("TERMINAL=" + (evs[-1].get('type') if evs else 'NONE'))
print("TEXT=" + text[-150:])
EOF
)
echo "$S2"
check "action 续跑正常结束" "TERMINAL=RUN_FINISHED" "$S2"
check "agent 读到筛选条件并回答" "笔记本\|华北" "$S2"
check "同名 surface 就地更新(或新结果 surface)" "sales-filter" "$S2"

echo "== RESULT: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
