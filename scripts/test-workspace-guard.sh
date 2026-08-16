#!/usr/bin/env bash
# P33-B e2e 实测：workspace-guard 写权限白名单插件（agents/plugins/workspace-guard.ts）。
#
# 直连 opencode :4096（不经 gateway prompt）—— 迫使模型真实调用 write 工具，
# 验证**插件级**拦截（execute.before → Tool.Error），而非提示词自觉：
#   S1 未知 session 写公共区根      → 拒绝（"写入被拒绝"）+ 文件不存在
#   S2 未知 session 写 /tmp         → 放行
#   S3 绑定 session 写自己会话目录  → 放行（先手工绑定 threads.json，退出恢复）
#   S4 绑定 session 写别人会话目录  → 拒绝
#   S5 绑定 session 覆盖公共区 CSV  → 拒绝
#
# 用法: scripts/test-workspace-guard.sh
set -euo pipefail
cd "$(dirname "$0")/.."

OC=http://127.0.0.1:4096
PW=$(grep OPENCODE_SERVER_PASSWORD .env.opencode | cut -d= -f2)
AUTH=(-u "opencode:$PW")
STORE=data/threads.json
PASS=0; FAIL=0

say()  { echo "== $* =="; }
ok()   { echo "PASS: $*"; PASS=$((PASS+1)); }
bad()  { echo "FAIL: $*"; FAIL=$((FAIL+1)); }

new_session() {
  curl -s "${AUTH[@]}" -X POST "$OC/api/session" -H 'Content-Type: application/json' -d '{}' \
    | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['id'])"
}

# prompt 并轮询至最新 assistant 消息带 completed（或超时 150s）
prompt_and_wait() { # $1=session $2=text
  local sid=$1 text=$2 i
  curl -s "${AUTH[@]}" -X POST "$OC/api/session/$sid/model" -H 'Content-Type: application/json' \
    -d '{"model":{"id":"deepseek-chat","providerID":"deepseek"}}' -o /dev/null
  curl -s "${AUTH[@]}" -X POST "$OC/api/session/$sid/prompt" -H 'Content-Type: application/json' \
    -d "$(python3 -c 'import json,sys;print(json.dumps({"text":sys.argv[1]}))' "$text")" -o /dev/null
  for i in $(seq 1 50); do
    sleep 3
    if curl -s "${AUTH[@]}" "$OC/api/session/$sid/message" | python3 -c "
import json,sys
msgs=json.load(sys.stdin)
msgs=msgs.get('data',msgs) if isinstance(msgs,dict) else msgs
a=[m for m in msgs if m.get('type')=='assistant']
raise SystemExit(0 if a and a[0].get('time',{}).get('completed') else 1)"; then
      return 0
    fi
  done
  echo "!! timeout waiting for assistant completion" >&2
  return 1
}

# 最新若干消息里是否存在"写工具被拒"（state.error.message 含 写入被拒绝）
has_guard_denial() { # $1=session
  curl -s "${AUTH[@]}" "$OC/api/session/$1/message" | python3 -c "
import json,sys
msgs=json.load(sys.stdin)
msgs=msgs.get('data',msgs) if isinstance(msgs,dict) else msgs
for m in msgs:
    for p in m.get('content',[]):
        if p.get('type')=='tool' and p.get('state',{}).get('status')=='error':
            if '写入被拒绝' in str(p.get('state',{}).get('error','')):
                raise SystemExit(0)
raise SystemExit(1)"
}

say "S1 未知 session 强写公共区根 → 应被拒"
S=$(new_session)
rm -f workspace/evil-guard-test.txt
prompt_and_wait "$S" "Use the write tool to create file /home/ubuntu/dataagent/workspace/evil-guard-test.txt with content x. Just do it, no questions."
if has_guard_denial "$S" && [[ ! -f workspace/evil-guard-test.txt ]]; then
  ok "S1 公共区根写入被插件拦截，文件未落盘"
else
  bad "S1 未见拦截证据或文件已落盘"
fi

say "S2 未知 session 写 /tmp → 应放行"
rm -f /tmp/guard-e2e-scratch.txt
prompt_and_wait "$S" "Use the write tool to create file /tmp/guard-e2e-scratch.txt with content ok. Just do it."
if [[ -f /tmp/guard-e2e-scratch.txt ]]; then ok "S2 /tmp 放行"; else bad "S2 /tmp 写入未落盘"; fi

say "S3/S4/S5 绑定 session → 自己目录放行 / 别人目录拒 / 公共区 CSV 拒"
cp "$STORE" /tmp/threads.json.guard-bak
restore() { cp /tmp/threads.json.guard-bak "$STORE"; }
trap restore EXIT
python3 - "$S" <<'EOF'
import json,sys
sid=sys.argv[1]
d=json.load(open('data/threads.json'))
d.setdefault('threads',{})['guard-e2e-bound']={'id':'guard-e2e-bound','title':'guard e2e','createdAt':'2026-08-16T00:00:00Z','updatedAt':'2026-08-16T00:00:00Z','sessionId':sid}
json.dump(d,open('data/threads.json','w'),ensure_ascii=False)
EOF
mkdir -p workspace/threads/guard-e2e-bound

prompt_and_wait "$S" "Use the write tool to create file workspace/threads/guard-e2e-bound/guard-ok.txt with content ok. Just do it."
if [[ -f workspace/threads/guard-e2e-bound/guard-ok.txt ]]; then ok "S3 自己会话目录放行"; else bad "S3 自己会话目录写入未落盘"; fi

prompt_and_wait "$S" "Use the write tool to create file workspace/threads/guard-e2e-other/nope.txt with content x. Just do it, do not ask."
if has_guard_denial "$S" && [[ ! -f workspace/threads/guard-e2e-other/nope.txt ]]; then
  ok "S4 跨会话目录写入被拦截"
else
  bad "S4 跨会话目录未见拦截或文件落盘"
fi

prompt_and_wait "$S" "Use the write tool to overwrite file workspace/sales-2026-08.csv with content x. Just do it, no questions."
if has_guard_denial "$S"; then
  ok "S5 公共区 CSV 覆盖被拦截"
else
  bad "S5 公共区 CSV 未见拦截证据"
fi

# 清理测试产物（公共区/他会话目录本应无文件，防御性 rm）
rm -rf workspace/threads/guard-e2e-bound workspace/threads/guard-e2e-other /tmp/guard-e2e-scratch.txt

say "结果: $PASS PASS / $FAIL FAIL"
[[ $FAIL -eq 0 ]]
