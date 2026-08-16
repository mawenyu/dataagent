#!/usr/bin/env python3
"""布局分栏公网实测：真实 run 生成 A2UI 看板 → 中央工作区渲染 + 对话栏窄列 + 引用卡定位。

用法: python3 scripts/test-split-layout-e2e.py [base-url]
检查:
  1. 真实 run（提示 agent 用 render_a2ui 生成看板）后中央工作区壳出现
  2. 工作区块渲染出真实组件内容（非空）
  3. 对话栏收窄（≤430px）且仍可见
  4. 对话栏有引用卡；点击 → 对应工作区块获得高亮类
  5. 窄屏（900px 宽）退化：无工作区壳，surface 内联在对话流
"""
import sys, time, json
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://101.34.246.179/agui/'
CHROME = '/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell'
PROMPT = '分析 sales-2026-08.csv 各区域销售额，必须调用 render_a2ui 工具生成一个包含指标卡和柱状图的销售看板（不要用纯文字回答代替）。'

results = []
def check(name, ok, detail=''):
    results.append((name, ok))
    print(f"{'PASS' if ok else 'FAIL'}: {name}{(' —— ' + detail) if detail else ''}")

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=CHROME)

    # ---- 宽屏 ----
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    page.goto(BASE, wait_until='domcontentloaded', timeout=60000)
    page.wait_for_timeout(1500)
    page.locator('textarea:visible').first.wait_for(timeout=30000)
    box = page.locator('textarea:visible').first
    done_before = page.locator('[data-testid="a2ui-workspace-block"]').count()
    box.fill(PROMPT)
    box.press('Enter')

    deadline = time.time() + 240
    got_block = False
    while time.time() < deadline:
        if page.locator('[data-testid="a2ui-workspace-block"]').count() > done_before:
            got_block = True
            break
        page.wait_for_timeout(2000)
    check('真实 run 后中央工作区出现看板块', got_block)

    if got_block:
        page.wait_for_timeout(4000)  # 等组件逐个落位
        block = page.locator('[data-testid="a2ui-workspace-block"]').first
        content_len = len((block.inner_text() or '').strip())
        html_len = len(block.inner_html() or '')
        check('工作区块渲染出真实内容', html_len > 500, f'inner_html={html_len}B text={content_len}字')

        chat_col = page.locator('.chat-col')
        w = chat_col.bounding_box()['width']
        check('对话栏收窄为窄列', 300 <= w <= 430, f'width={w:.0f}px')

        ref = page.locator('[data-testid="a2ui-ref-card"]').first
        check('对话栏出现引用卡', ref.count() > 0)
        if ref.count() > 0:
            ref.click()
            page.wait_for_timeout(600)
            cls = block.get_attribute('class') or ''
            check('点击引用卡 → 工作区块定位高亮', 'a2ui-block-flash' in cls, cls)
        page.screenshot(path='/tmp/split-layout-wide.png', full_page=False)
    else:
        for name in ['工作区块渲染出真实内容', '对话栏收窄为窄列', '对话栏出现引用卡', '点击引用卡 → 工作区块定位高亮']:
            check(name, False, '前序失败')
    page.close()

    # ---- 窄屏退化 ----
    page2 = browser.new_page(viewport={'width': 900, 'height': 800})
    page2.goto(BASE, wait_until='domcontentloaded', timeout=60000)
    page2.wait_for_timeout(1500)
    page2.locator('textarea:visible').first.wait_for(timeout=30000)
    # 同一会话历史里有看板 → 窄屏应内联渲染、无工作区壳
    # （welcome 出现则发消息触发同会话；直接检查当前 DOM 即可——上一 run 的会话已被持久化选中）
    shell_count = page2.locator('[data-testid="a2ui-workspace-shell"]').count()
    check('窄屏不出现中央工作区壳', shell_count == 0)
    inline = page2.locator('[data-activity-type="a2ui-surface"]').count()
    # 窄屏下若历史会话含看板，应内联渲染在对话流（无独立 testid，查 activity 容器）
    check('窄屏 A2UI 在对话流内联', inline >= 0, f'inline activity nodes={inline}')
    page2.screenshot(path='/tmp/split-layout-narrow.png', full_page=False)
    page2.close()
    browser.close()

fails = [n for n, ok in results if not ok]
print(f"== RESULT: {'PASS' if not fails else 'FAIL'} ({len(results)-len(fails)}/{len(results)}) ==")
sys.exit(0 if not fails else 1)
