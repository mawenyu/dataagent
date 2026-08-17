#!/usr/bin/env python3
"""公网冷加载 LCP 基线/复测：每次全新 browser context(无缓存) 采 LCP + JS 传输量,跑 N 次取中位。

用法: python3 scripts/test-cold-load-lcp.py [base-url] [runs]
输出: 每次 LCP/ms、JS 字节数(响应体 transferSize 合计)、DOMContentLoaded;末尾中位数汇总。
"""
import statistics, sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://101.34.246.179/agui/'
RUNS = int(sys.argv[2]) if len(sys.argv) > 2 else 5
CHROME = '/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell'

LCP_JS = """
new Promise((resolve) => {
  let lcp = 0;
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) lcp = e.startTime;
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  setTimeout(() => resolve(lcp), 4000);
})
"""

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=CHROME)
    lcps, jss, dcls = [], [], []
    for i in range(RUNS):
        ctx = browser.new_context(viewport={'width': 1440, 'height': 900})  # 全新 context = 冷缓存
        page = ctx.new_page()
        counter = {'js_bytes': 0}
        def on_response(resp):
            try:
                if resp.request.resource_type == 'script':
                    body = resp.body()
                    counter['js_bytes'] += len(body)
            except Exception:
                pass
        page.on('response', on_response)
        page.goto(BASE, wait_until='domcontentloaded', timeout=60000)
        page.wait_for_selector('[data-testid="welcome-screen"]', timeout=30000)
        lcp = page.evaluate(LCP_JS)
        timing = page.evaluate("performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd")
        js_bytes = counter['js_bytes']
        lcps.append(lcp); jss.append(js_bytes); dcls.append(timing)
        print(f"run{i+1}: LCP={lcp:.0f}ms  JS={js_bytes/1024:.0f}KB  DCL={timing:.0f}ms", flush=True)
        ctx.close()
    browser.close()

print(f"\n== MEDIAN: LCP={statistics.median(lcps):.0f}ms  JS={statistics.median(jss)/1024:.0f}KB  DCL={statistics.median(dcls):.0f}ms  (n={RUNS}) ==")
