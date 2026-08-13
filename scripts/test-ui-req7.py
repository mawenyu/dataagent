#!/usr/bin/env python3
"""需求7 浏览器实测（截图证据）:
打开真实部署的 DataAgent 页面，发送"分析本月销售情况"，等待运行结束，
验证并截图: 思考过程(reasoning)可见、工具调用可见、context 用量徽章、完整回答。
"""
import json
import sys
import time

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://101.34.246.179/agui/'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/home/ubuntu/opencode-agui-app/docs/screenshots'

results = []


def check(name, ok, detail=''):
    results.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL') + f': {name} {detail}')


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell')
    page = browser.new_page(viewport={'width': 1440, 'height': 960})
    console_logs = []
    page.on('console', lambda m: console_logs.append(f'{m.type}: {m.text[:200]}'))
    page.on('pageerror', lambda e: console_logs.append(f'PAGEERROR: {str(e)[:300]}'))
    page.goto(BASE, wait_until='networkidle')
    page.screenshot(path=f'{OUT}/req7-00-welcome.png')

    # 找到输入框并发送；用 SSE 响应流结束作为 run 完成的权威信号
    box = page.locator('textarea').first
    box.fill('分析本月销售情况，并用图表看板展示')
    with page.expect_response(
            lambda r: '/agui-api/' in r.url and r.request.method == 'POST',
            timeout=15000) as resp_info:
        box.press('Enter')
    resp = resp_info.value

    # 等待运行期间状态
    reasoning_seen = False
    tool_seen = False
    deadline = time.time() + 160
    finished = False
    while time.time() < deadline:
        time.sleep(1)
        if page.locator('text=/Thinking|Thought for|思考/').count() > 0:
            reasoning_seen = True
        if page.locator('[data-testid="copilot-tool-render"], [data-tool-name]').count() > 0:
            tool_seen = True
        try:
            resp.finished()
            finished = True
            break
        except Exception:
            pass
    time.sleep(2)  # 等 DOM 绘制
    # 结束后再补一轮检查（reasoning 折叠标题可能在 run 结束后才渲染）
    if page.locator('text=/Thinking|Thought for|思考/').count() > 0:
        reasoning_seen = True
    if page.locator('[data-testid="copilot-tool-render"], [data-tool-name]').count() > 0:
        tool_seen = True

    page.screenshot(path=f'{OUT}/req7-01-running.png', full_page=False)
    print(f'SSE stream finished: {finished}')

    check('reasoning 思考过程可见', reasoning_seen)
    check('工具调用可见', tool_seen)

    # context 徽章
    badge = page.locator('.context-badge')
    check('context 用量徽章显示', badge.count() > 0, badge.inner_text() if badge.count() else '')

    # 页面含最终回答且没有卡死标志
    page.mouse.wheel(0, 100000)  # 滚到底部再截图
    time.sleep(1)
    body = page.inner_text('body')
    check('最终回答非空', len(body) > 200)
    # A2UI surface 渲染检查：聊天区应出现 catalog 组件渲染出的真实内容
    chat_html = page.locator('.chat-card').evaluate('el => el.innerHTML') if page.locator('.chat-card').count() else ''
    has_surface = any(k in chat_html for k in ('MetricCard', 'BarChart', 'metric-card', 'bar-chart', 'a2ui'))
    check('A2UI surface 渲染出内容', has_surface, f'chat html {len(chat_html)} chars')
    page.screenshot(path=f'{OUT}/req7-02-final.png')

    errors = [l for l in console_logs if l.startswith(('PAGEERROR', 'error'))]
    print('--- console errors ---')
    for e in errors[:10]:
        print(e)

    browser.close()

failed = [r for r in results if not r[1]]
print(f"== {len(results) - len(failed)} passed, {len(failed)} failed ==")
sys.exit(1 if failed else 0)
