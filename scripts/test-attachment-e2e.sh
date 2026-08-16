#!/usr/bin/env bash
# P-J 实测脚本：多模态附件上传全链路（真实 gateway + opencode LLM,无 mock）
#   1) 建会话 → 上传 CSV 到会话工作目录
#   2) 多模态消息(text + document part 带 metadata.filename)发起 run
#   3) 断言:RUN_FINISHED + agent 用工具读了文件 + 回答含 CSV 里的独特数值
#   4) 超限上传(>50MB)必须 413 + 结构化错误体(非静默)
# 用法: scripts/test-attachment-e2e.sh [gateway-base-url]
set -u
BASE="${1:-http://127.0.0.1:8090}"
TS=$(date +%s)
THREAD="pj-attach-$TS"
FNAME="pj-sales-$TS.csv"
MAGIC="920417"   # 独特数值,断言 agent 真的读到了文件内容
PASS=0; FAIL=0

check() { # desc expected_substring haystack
  if echo "$3" | grep -q "$2"; then echo "PASS: $1"; PASS=$((PASS+1));
  else echo "FAIL: $1 (expected '$2')"; FAIL=$((FAIL+1)); fi
}

echo "== thread: $THREAD / file: $FNAME =="

# 1) 建会话 + 上传附件(会话级 API)
curl -s -m 10 -X POST "$BASE/chat/threads" -H 'Content-Type: application/json' \
  -d "{\"id\":\"$THREAD\"}" > /dev/null
printf 'region,amount\n华东,%s\n华北,100\n' "$MAGIC" > "/tmp/$FNAME"
UP=$(curl -s -m 30 -F "file=@/tmp/$FNAME" "$BASE/chat/threads/$THREAD/files")
echo "upload: $UP"
check "附件上传成功" "\"name\":\"$FNAME\"" "$UP"

LS=$(curl -s -m 10 "$BASE/chat/threads/$THREAD/files")
check "文件在会话工作目录可见" "$FNAME" "$LS"

# 2) 多模态 run:text part + document part(metadata.filename,与前端 consumeAttachments 同构)
OUT="/tmp/pj-attach-$TS.sse"
timeout 170 curl -sN "$BASE/agent/run" -H 'Content-Type: application/json' -d @- > "$OUT" << EOF
{"threadId":"$THREAD","runId":"r1","messages":[{"role":"user","content":[
  {"type":"text","text":"分析我上传的 $FNAME,告诉我销售额最高的区域和具体数值"},
  {"type":"document","source":{"type":"url","value":"$BASE/chat/threads/$THREAD/files/$FNAME"},"metadata":{"filename":"$FNAME"}}
]}]}
EOF

R=$(python3 - "$OUT" << 'EOF'
import json, sys
texts=[]; terminal=None; ntools=0; tool_files=set()
for line in open(sys.argv[1]):
    if not line.startswith('data:'): continue
    try: e=json.loads(line[5:])
    except: continue
    t=e.get('type')
    if t=='TEXT_MESSAGE_CONTENT': texts.append(e.get('delta',''))
    elif t=='TOOL_CALL_START': ntools+=1
    elif t=='TOOL_CALL_ARGS':
        tool_files.add(e.get('delta',''))
    elif t=='RUN_FINISHED': terminal='RUN_FINISHED'
    elif t=='RUN_ERROR': terminal='RUN_ERROR: '+e.get('message','')
print(f"TERMINAL={terminal}")
print(f"TOOLS={ntools}")
print(f"TEXT={''.join(texts)[-400:]}")
EOF
)
echo "$R"
check "run 正常结束" "TERMINAL=RUN_FINISHED" "$R"
check "agent 用了工具(读文件)" "TOOLS=[1-9]" "$R"
# agent 可能把数值格式化为千分位(920,417) —— 去逗号后匹配
RNORM=$(echo "$R" | tr -d ',')
check "回答含 CSV 独特数值 $MAGIC(agent 真读到了内容)" "$MAGIC" "$RNORM"
check "回答提到最高区域 华东" "华东" "$R"

# 3) 超限上传 → 413 + 结构化错误(非静默失败的服务端对应面)
dd if=/dev/zero of=/tmp/pj-big.csv bs=1M count=51 2>/dev/null
BIG=$(curl -s -m 60 -o /tmp/pj-big-resp.json -w "%{http_code}" -F "file=@/tmp/pj-big.csv" "$BASE/chat/threads/$THREAD/files")
BIGBODY=$(cat /tmp/pj-big-resp.json)
echo "oversize: HTTP $BIG $BIGBODY"
check "超限返回 413" "^413$" "$BIG"
check "413 带结构化错误体" "error" "$BIGBODY"

# 清理(会话级联删除会带走工作目录)
curl -s -m 10 -o /dev/null -X DELETE "$BASE/chat/threads/$THREAD"
rm -f "/tmp/$FNAME" /tmp/pj-big.csv /tmp/pj-big-resp.json "$OUT"

echo "== RESULT: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
