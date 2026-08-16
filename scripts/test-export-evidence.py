#!/usr/bin/env python3
"""P27-backlog-a 会话导出现有功能实测留证：真实 gateway 历史 API → 前端 Blob 下载。
产物落 docs/evidence/2026-08-16-thread-export-*."""
import json, sys, urllib.request
from playwright.sync_api import sync_playwright

BASE = "http://localhost/agui/"
EV = "docs/evidence"

# 找一条有消息的会话（gateway 真实 API）
threads = json.load(urllib.request.urlopen("http://localhost:8090/chat/threads"))
items = threads.get("data") or threads.get("threads") or threads
tid = None
for t in items if isinstance(items, list) else items.get("items", []):
    msgs = json.load(urllib.request.urlopen(f"http://localhost:8090/chat/threads/{t['id']}/messages"))
    arr = msgs.get("messages") or msgs.get("data") or []
    if isinstance(arr, list) and len(arr) >= 2:
        tid, title = t["id"], t.get("title", "")
        print(f"target thread: {tid} ({title}) messages={len(arr)}")
        break
if not tid:
    sys.exit("no thread with messages found")

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1280, "height": 800})
    page.goto(BASE, wait_until="networkidle")
    page.wait_for_selector(f'[data-testid="export-{tid}"]', state="attached", timeout=15000)
    row = page.locator(f'[data-thread-id="{tid}"]')
    row.scroll_into_view_if_needed()
    row.hover()  # 先 hover 会话行 → icon-btn pointer-events 解锁
    page.locator(f'[data-testid="export-{tid}"]').click()
    page.wait_for_selector(f'[data-testid="export-menu-{tid}"]', timeout=5000)
    page.screenshot(path=f"{EV}/2026-08-16-thread-export-menu.png")

    with page.expect_download(timeout=10000) as dl:
        page.locator(f'[data-testid="export-md-{tid}"]').click()
    d = dl.value
    d.save_as(f"{EV}/2026-08-16-thread-export.md")
    print("md download:", d.suggested_filename)

    row.hover()  # 下载后 hover 态丢失，重新解锁 pointer-events
    page.locator(f'[data-testid="export-{tid}"]').click()
    page.wait_for_selector(f'[data-testid="export-menu-{tid}"]', timeout=5000)
    with page.expect_download(timeout=10000) as dl:
        page.locator(f'[data-testid="export-json-{tid}"]').click()
    d = dl.value
    d.save_as(f"{EV}/2026-08-16-thread-export.json")
    print("json download:", d.suggested_filename)
    b.close()
print("EVIDENCE OK")
