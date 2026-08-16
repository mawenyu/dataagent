#!/usr/bin/env python3
"""会话导出真实化验收：含 render_a2ui 的真实会话 → UI 一键导出 MD+JSON →
断言 A2UI 引用小节（MD 🎨 A2UI 看板 / JSON a2uiRef 结构化字段）。
产物落 docs/evidence/2026-08-17-thread-export-a2ui.{md,json}"""
import json, sys, urllib.request
from playwright.sync_api import sync_playwright

BASE = "http://localhost/agui/"
GW = "http://localhost:8090"
EV = "docs/evidence"
CHROME = '/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell'

# 找一条含 render_a2ui 工具调用的真实会话
threads = json.load(urllib.request.urlopen(f"{GW}/chat/threads"))
items = threads.get("data") or threads.get("threads") or threads
tid = title = None
for t in items if isinstance(items, list) else items.get("items", []):
    msgs = json.load(urllib.request.urlopen(f"{GW}/chat/threads/{t['id']}/messages"))
    arr = msgs.get("messages") or msgs.get("data") or []
    if not isinstance(arr, list):
        continue
    has_a2ui = any(
        any((tc.get("function") or {}).get("name") in ("render_a2ui", "render_report")
            for tc in (m.get("toolCalls") or []))
        for m in arr if isinstance(m, dict)
    )
    if has_a2ui:
        tid, title = t["id"], t.get("title", "")
        print(f"target thread: {tid} ({title}) messages={len(arr)}")
        break
if not tid:
    sys.exit("no thread with render_a2ui found")

results = []
def check(name, ok, detail=""):
    results.append((name, ok))
    print(f"{'PASS' if ok else 'FAIL'}: {name}{(' —— ' + detail) if detail else ''}")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME)
    page = b.new_page(viewport={"width": 1280, "height": 800})
    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_selector(f'[data-testid="export-{tid}"]', state="attached", timeout=20000)
    row = page.locator(f'[data-thread-id="{tid}"]')

    row.hover()
    page.locator(f'[data-testid="export-{tid}"]').click()
    page.wait_for_selector(f'[data-testid="export-menu-{tid}"]', timeout=5000)
    with page.expect_download(timeout=10000) as dl:
        page.locator(f'[data-testid="export-md-{tid}"]').click()
    md_path = f"{EV}/2026-08-17-thread-export-a2ui.md"
    dl.value.save_as(md_path)

    row.hover()
    page.locator(f'[data-testid="export-{tid}"]').click()
    page.wait_for_selector(f'[data-testid="export-menu-{tid}"]', timeout=5000)
    with page.expect_download(timeout=10000) as dl:
        page.locator(f'[data-testid="export-json-{tid}"]').click()
    json_path = f"{EV}/2026-08-17-thread-export-a2ui.json"
    dl.value.save_as(json_path)
    b.close()

md = open(md_path, encoding="utf-8").read()
check("MD 含 A2UI 看板引用小节", "🎨 **A2UI 看板**" in md)
check("MD 引用含 surfaceId", "`" in md and "个组件" in md)
check("MD 不倒原始 a2ui 参数 JSON", '"surfaceId"' not in md)
check("MD 保留工具调用配对结果", "结果：" in md)

data = json.load(open(json_path, encoding="utf-8"))
refs = [
    tc.get("a2uiRef")
    for m in data.get("messages", [])
    for tc in (m.get("toolCalls") or [])
    if tc.get("a2uiRef")
]
check("JSON 含 a2uiRef 结构化字段", len(refs) >= 1, f"refs={len(refs)}")
if refs:
    r = refs[0]
    check("a2uiRef 字段完整", all(k in r for k in ("surfaceId", "componentTypes", "componentCount", "dataKeys")),
          json.dumps(r, ensure_ascii=False)[:120])

fails = [n for n, ok in results if not ok]
print(f"== RESULT: {'PASS' if not fails else 'FAIL'} ({len(results)-len(fails)}/{len(results)}) ==")
sys.exit(0 if not fails else 1)
