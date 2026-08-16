#!/usr/bin/env python3
"""模板库公网实测：
侧栏模板面板 → 内置场景卡填入欢迎页输入框 → 编辑 → 真实发送;
保存当前输入为自定义模板(localStorage) → reload 持久化 → 填入 → 删除。

用法: python3 scripts/test-template-library-e2e.py [base-url]
"""
import sys, time
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://101.34.246.179/agui/'
CHROME = '/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell'

results = []
def check(name, ok, detail=''):
    results.append((name, ok))
    print(f"{'PASS' if ok else 'FAIL'}: {name}{(' —— ' + detail) if detail else ''}", flush=True)

def ensure_panel_open(page):
    """面板 expanded 是组件内 ref,跨会话切换保持 —— 只在折叠时才点 toggle。"""
    if page.locator('[data-testid="template-sidebar-panel"]').count() == 0:
        page.locator('[data-testid="template-sidebar-toggle"]').click()
        page.wait_for_selector('[data-testid="template-sidebar-panel"]', timeout=5000)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=CHROME)
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    page.goto(BASE, wait_until='domcontentloaded', timeout=60000)
    page.wait_for_selector('[data-testid="welcome-screen"]', timeout=30000)
    page.wait_for_timeout(800)

    # ---- A. 面板渲染: 展开后内置场景卡组(含模板库三场景) ----
    toggle = page.locator('[data-testid="template-sidebar-toggle"]')
    check('A0 侧栏模板面板存在', toggle.count() == 1)
    toggle.click()
    page.wait_for_selector('[data-testid="template-sidebar-panel"]', timeout=5000)
    cards = page.locator('[data-testid="template-fill-item"]')
    titles = [cards.nth(i).inner_text() for i in range(cards.count())]
    check('A1 内置场景卡组 ≥7(含环比对比/异常检测/用户画像)',
          cards.count() >= 7 and all(any(t in x for x in titles) for t in ['环比对比', '异常检测', '用户画像']),
          f'共 {cards.count()} 张')

    # ---- B. 点内置卡 → 填入 → 编辑 → 真实发送 ----
    page.locator('[data-testid="template-fill-item"]', has_text='环比对比').first.click()
    page.wait_for_timeout(400)
    ta = page.locator('.welcome-input-row textarea')
    v1 = ta.input_value()
    check('B1 点击「环比对比」填入欢迎页输入框', '环比' in v1, v1[:40])
    ta.fill(v1 + '\n（e2e 追加编辑）')
    page.wait_for_timeout(300)
    check('B2 填入后可编辑', '（e2e 追加编辑）' in ta.input_value())
    page.locator('.welcome-send').click()
    page.wait_for_timeout(1500)
    body_txt = page.locator('.chat-col').inner_text()
    check('B3 编辑后真实发送,user 消息出现在对话流', '环比' in body_txt and 'e2e 追加编辑' in body_txt)

    # ---- C. 新会话 → 输入草稿 → 保存为自定义模板(表单预填草稿) ----
    page.locator('[data-testid="thread-new"], button:has-text("新建")').first.click()
    page.wait_for_selector('[data-testid="welcome-screen"]', timeout=15000)
    page.wait_for_timeout(500)
    page.locator('.welcome-input-row textarea').fill('统计各品类退货率并排序')
    page.wait_for_timeout(400)
    ensure_panel_open(page)
    page.locator('[data-testid="template-save-open"]').click()
    pre = page.locator('[data-testid="template-save-prompt"]').input_value()
    check('C1 保存表单预填当前输入草稿', pre == '统计各品类退货率并排序', pre[:30])
    page.locator('[data-testid="template-save-title"]').fill('退货率排名')
    page.locator('[data-testid="template-save-submit"]').click()
    page.wait_for_timeout(500)
    mine = page.locator('[data-testid="template-mine-item"]')
    check('C2 保存后「我的模板」出现', mine.count() == 1 and '退货率排名' in mine.first.inner_text())
    stored = page.evaluate("localStorage.getItem('dataagent.user-templates.v1') || ''")
    check('C3 localStorage 持久化', '退货率排名' in stored)

    # ---- D. reload → 自定义模板仍在 → 点击填入 ----
    page.reload(wait_until='domcontentloaded')
    page.wait_for_selector('[data-testid="template-sidebar-toggle"]', timeout=30000)
    page.wait_for_timeout(800)
    ensure_panel_open(page)
    mine2 = page.locator('[data-testid="template-mine-item"]')
    check('D1 reload 后自定义模板持久化恢复', mine2.count() == 1 and '退货率排名' in mine2.first.inner_text())
    mine2.first.click()
    page.wait_for_timeout(400)
    v2 = page.locator('.welcome-input-row textarea').input_value()
    check('D2 点击「我的模板」填入输入框', v2 == '统计各品类退货率并排序', v2[:30])

    # ---- E. 删除 → 列表清空 → reload 仍空 ----
    page.locator('[data-testid="template-delete"]').first.click()
    page.wait_for_timeout(400)
    check('E1 删除后我的模板清空(空态提示)', page.locator('[data-testid="template-mine-empty"]').count() == 1)
    page.reload(wait_until='domcontentloaded')
    page.wait_for_selector('[data-testid="template-sidebar-toggle"]', timeout=30000)
    page.wait_for_timeout(800)
    ensure_panel_open(page)
    check('E2 reload 后删除生效(localStorage 同步)', page.locator('[data-testid="template-mine-item"]').count() == 0)

    browser.close()

passed = sum(1 for _, ok in results if ok)
print(f"\n== RESULT: {passed} passed, {len(results) - passed} failed ==")
sys.exit(0 if passed == len(results) else 1)
