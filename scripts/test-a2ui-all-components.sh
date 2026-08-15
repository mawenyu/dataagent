#!/usr/bin/env bash
# A2UI 组件全量实测（task4）：分 4 组逐组让 agent 渲染（小组件集 = 小 JSON，
# 实测单 surface 18 组件的大 JSON 模型容易产出不合法 JSON）。
#   布局组: Card/Column/Row/Tabs
#   展示组: Text/Badge/Image?/Divider/Markdown
#   图表组: BarChart/LineChart/PieChart/DataTable/MetricCard（data model {path} 绑定）
#   表单组: TextField/ChoicePicker/CheckBox/DateTimeInput/Slider + ActionButton(apply_filter)
# 断言每组 ACTIVITY_SNAPSHOT 组件齐全 + 文本无 tool_call/DSML 泄漏。
# 用法: scripts/test-a2ui-all-components.sh [gateway-base-url]
set -u
BASE="${1:-http://127.0.0.1:8090}"
THREAD="a2ui-all-$(date +%s)"
PASS=0; FAIL=0

check() { # desc expected haystack
  if echo "$3" | grep -q "$2"; then echo "PASS: $1"; PASS=$((PASS+1));
  else echo "FAIL: $1 (expected '$2')"; FAIL=$((FAIL+1)); fi
}

CATALOG_CTX='{"description":"A2UI catalog (data-agent)","value":"components: layout Column{children}/Row{children}/Card{child}/Tabs{tabs}; display Text{text,variant}/Badge{text,variant}/Image{url}/Divider/Markdown{text}; charts BarChart/LineChart{title,xField,yField,data}/PieChart{title,labelField,valueField,data}/DataTable{title,columns,rows}/MetricCard{title,value}; forms TextField{label,text}/ChoicePicker{label,options,value}/CheckBox{label,value}/DateTimeInput{label,value}/Slider{label,min,max,value}; ActionButton{label,action{event{name,context}}}. One root id=root. Bind data via {path}."}'

run_group() { # group-name prompt expected-components(csv)
  local name="$1" prompt="$2" expect="$3" attempt S
  for attempt in 1 2 3; do
    timeout 280 curl -sN "$BASE/agent/run" -H 'Content-Type: application/json' \
      -d "{\"threadId\":\"$THREAD\",\"runId\":\"$name-$attempt\",\"context\":[$CATALOG_CTX],\"messages\":[{\"role\":\"user\",\"content\":$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$prompt")}]}" \
      > /tmp/a2all-$THREAD-$name.sse
    S=$(python3 - /tmp/a2all-$THREAD-$name.sse <<'EOF'
import json, sys
evs=[json.loads(l[5:]) for l in open(sys.argv[1]) if l.startswith('data:')]
comps=set()
for s in [e for e in evs if e.get('type')=='ACTIVITY_SNAPSHOT']:
    for op in s['content']['a2ui_operations']:
        if 'updateComponents' in op: comps |= {c['component'] for c in op['updateComponents']['components']}
txt=''.join(e.get('delta','') for e in evs if e.get('type')=='TEXT_MESSAGE_CONTENT')
print("COMPONENTS=" + ",".join(sorted(comps)))
print("TERMINAL=" + (evs[-1].get('type') if evs else 'NONE'))
print("LEAK=" + str('tool_call' in txt or 'DSML' in txt))
EOF
)
    echo "[$name attempt $attempt] $S" | tr '\n' ' '; echo
    local all=1
    IFS=',' read -ra req <<< "$expect"
    for c in "${req[@]}"; do echo "$S" | grep -q "$c" || all=0; done
    [ "$all" = 1 ] && break
  done
  IFS=',' read -ra req <<< "$expect"
  for c in "${req[@]}"; do check "[$name] $c 渲染" "$c" "$S"; done
  check "[$name] run 正常结束" "TERMINAL=RUN_FINISHED" "$S"
  check "[$name] 无泄漏" "LEAK=False" "$S"
}

run_group layout "用 render_a2ui 渲染 surface=component-tour-layout：Card 包一个 Column，里面有 Text(h3 标题'组件巡展')、一个 Row（放两个 Badge）、一个 Tabs（两个 tab：说明/备注，各含一段 Text）。用 workspace/sales-2026-08.csv 的真实数字写文案。必须调 render_a2ui，禁止只答文字。" "Card,Column,Row,Tabs,Text,Badge"

run_group display "用 render_a2ui 渲染 surface=component-tour-display：Column 里依次放 Text(h2)、Badge(success 写'数据新鲜')、Divider、Markdown(一段分析结论：含 **加粗**、行内代码 和 - 列表，内容基于 workspace/sales-2026-08.csv 真实数据)、Image(url 用 https://dummyimage.com/300x80/6366f1/fff.png&text=DataAgent)。必须调 render_a2ui，禁止只答文字。" "Text,Badge,Divider,Markdown,Image"

run_group charts "用 render_a2ui 渲染 surface=component-tour-charts（分析 workspace/sales-2026-08.csv 真实数据）：Column 里放 Row(两个 MetricCard: 总销售额/订单数)、BarChart(区域销售额)、LineChart(每日趋势)、PieChart(品类占比)、DataTable(区域明细)。图表数据放 data model 用 {path} 绑定。必须调 render_a2ui，禁止只答文字。" "MetricCard,BarChart,LineChart,PieChart,DataTable"

run_group form "用 render_a2ui 渲染 surface=component-tour-form：Card 包 Column：TextField(品类关键词,绑定 keyword)、ChoicePicker(区域:全部/华北/华东/华南,绑定 region)、CheckBox(含退货,绑定 includeReturns)、DateTimeInput(起始日期,绑定 startDate)、Slider(TopN,min1 max10,绑定 topN)、ActionButton(primary,'应用筛选',action.event.name=apply_filter,context 引用五个绑定)。只渲染表单。必须调 render_a2ui，禁止只答文字。" "Card,TextField,ChoicePicker,CheckBox,DateTimeInput,Slider,ActionButton"

echo "== RESULT: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
