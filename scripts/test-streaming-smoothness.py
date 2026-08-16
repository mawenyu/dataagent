#!/usr/bin/env python3
"""收尾2 实测 v2：长 reasoning 流式期间主线程响应性 —— evaluate 探针延迟法。

原理：headless 下 rAF/longtask 计量不可信（实测 profiler 显示 idle 但
longtask TBT 虚高）。改用更直接的 UX 指标 —— 流式期间每 1s 发一个
零工作 evaluate 探针，主线程若被长任务阻塞，探针往返延迟会等比放大。
Python 侧计时含 IPC（基线 <100ms）；>1s 即真实卡顿。

用法: python3 scripts/test-streaming-smoothness.py [base-url]
"""
import sys, time
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://101.34.246.179/agui/'
CHROME = '/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell'
PROMPT = '请先进行深入细致的逐步思考（多想几个角度），再分析 sales-2026-08.csv：每个区域的销售额、占比，并给出经营建议。'

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME)
        page = browser.new_page()
        page.goto(BASE, wait_until='networkidle', timeout=30000)
        page.wait_for_timeout(2000)

        # 基线探针延迟（空闲页）
        base = []
        for _ in range(3):
            t = time.perf_counter()
            page.evaluate('1')
            base.append((time.perf_counter() - t) * 1000)
        baseline = sum(base) / len(base)

        box = page.locator('textarea:visible').first
        # 历史会话可能残留已完成的 "Thought for" —— 先记基数，要求新增
        done_before = page.locator('text=/Thought for/').count()
        box.fill(PROMPT)
        box.press('Enter')

        probes = []
        done = False
        for _ in range(150):
            t = time.perf_counter()
            page.evaluate('1')
            probes.append((time.perf_counter() - t) * 1000)
            if page.locator('text=/Thought for/').count() > done_before:
                done = True
                break
            page.wait_for_timeout(1000)
        browser.close()

    # 丢掉完成判定后的最后一个探针（可能落在收尾渲染外）
    stream = probes[:-1] if done else probes
    worst = max(stream) if stream else 0
    p95 = sorted(stream)[int(len(stream) * 0.95)] if stream else 0
    print(f"基线探针: {baseline:.0f}ms | 流式探针 {len(stream)} 个 | "
          f"p95={p95:.0f}ms worst={worst:.0f}ms | 完成={done}")

    ok = True
    def check(name, cond):
        nonlocal ok
        print(('PASS' if cond else 'FAIL') + f': {name}')
        ok = ok and cond

    check('run 完成(Thought for 出现)', done)
    check(f'流式窗口有效(探针 {len(stream)} >= 3)', len(stream) >= 3)
    check(f'流式期间探针 p95({p95:.0f}ms) < 500ms（主线程基本不堵）', p95 < 500)
    check(f'最差探针({worst:.0f}ms) < 2000ms（无秒级冻结）', worst < 2000)
    print('== RESULT: ' + ('PASS' if ok else 'FAIL') + ' ==')
    sys.exit(0 if ok else 1)

main()
