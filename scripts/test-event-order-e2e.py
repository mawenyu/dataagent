#!/usr/bin/env python3
"""端到端乱序校验（真实 opencode2 链路）:
N 轮真实 agent 会话（多工具调用场景），抓 gateway AG-UI 事件流，
按 messageId/toolCallId 归并校验生命周期顺序：
- 每个 id: START 在 CONTENT/ARGS 前，CONTENT/ARGS 在 END 前
- 不允许 END 后出现该 id 的 CONTENT/ARGS
"""
import json
import subprocess
import sys

GATEWAY = 'http://127.0.0.1:8090/agent/run'
ROUNDS = [
    '分析本月销售情况，先用 bash 统计总额，再读文件确认数据行数',
    '用工具分别统计本月各区域和各品类的销售额，两个都要算',
    '看看 workspace 里有什么文件，读 sales CSV 前几行，再用 bash 统计行数',
    '本月销售额最高的区域是哪个？先跑命令汇总再读结果文件确认',
    '按日统计本月销售趋势，先 bash 聚合再说明峰值日期',
]

def run_round(i, prompt):
    out = f'/tmp/e2e-round{i}.sse'
    with open(out, 'w') as f:
        subprocess.run([
            'curl', '-sN', '--max-time', '300', GATEWAY,
            '-H', 'Content-Type: application/json',
            '-d', json.dumps({
                'threadId': f'e2e-order-{i}', 'runId': f'run-{i}',
                'messages': [{'role': 'user', 'content': prompt}],
            }, ensure_ascii=False),
        ], stdout=f, timeout=310)
    return out

def validate(path):
    """返回 (违规列表, 统计信息)。
    状态机 per id: IDLE →(START)→ OPEN →(END)→ IDLE。
    reasoning 块上游会复用同一 reasoningID（每个 step 重新计数）——END 后的
    新 START 视为新生命周期（合法），END 后、新 START 前的 CONTENT 才算违规。"""
    violations = []
    open_ids = set()   # START 已发、END 未发
    counts = {'TEXT': 0, 'TOOL': 0, 'REASONING': 0}
    terminal = None
    for line in open(path):
        if not line.startswith('data:'):
            continue
        try:
            e = json.loads(line[5:])
        except Exception:
            continue
        t = e.get('type', '')
        if t in ('TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END'):
            mid = e.get('messageId', '')
            kind = 'TEXT'
        elif t in ('TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_END'):
            mid = e.get('toolCallId', '')
            kind = 'TOOL'
        elif t in ('REASONING_MESSAGE_START', 'REASONING_MESSAGE_CONTENT', 'REASONING_MESSAGE_END'):
            mid = e.get('messageId', '')
            kind = 'REASONING'
        elif t in ('RUN_FINISHED', 'RUN_ERROR'):
            terminal = t if t == 'RUN_FINISHED' else f"RUN_ERROR:{e.get('message','')[:60]}"
            continue
        else:
            continue
        counts[kind] += 1
        phase = t.rsplit('_', 1)[-1]
        if phase == 'START':
            if mid in open_ids:
                violations.append(f'{kind} {mid}: double START without END')
            open_ids.add(mid)
        elif phase in ('CONTENT', 'ARGS'):
            if mid not in open_ids:
                violations.append(f'{kind} {mid}: {phase} outside START..END (late/orphan delta)')
        elif phase == 'END':
            if mid not in open_ids:
                violations.append(f'{kind} {mid}: END before START')
            open_ids.discard(mid)
    return violations, counts, terminal

fails = 0
for i, prompt in enumerate(ROUNDS):
    path = run_round(i, prompt)
    violations, counts, terminal = validate(path)
    status = 'OK ' if not violations and terminal == 'RUN_FINISHED' else 'FAIL'
    if status == 'FAIL':
        fails += 1
    print(f'[{status}] round {i}: TEXT={counts["TEXT"]} TOOL={counts["TOOL"]} REASONING={counts["REASONING"]} terminal={terminal}')
    for v in violations:
        print(f'       VIOLATION: {v}')

print(f'== {len(ROUNDS) - fails}/{len(ROUNDS)} rounds clean ==')
sys.exit(1 if fails else 0)
