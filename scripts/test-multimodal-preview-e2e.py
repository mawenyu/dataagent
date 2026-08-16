#!/usr/bin/env python3
"""多模态文件预览公网实测：
真实上传 png/pdf/csv → 欢迎页 chip 预览（表格/iframe/lightbox）
→ 对话消息附件区点击预览（lightbox / blob iframe）→ 文件面板 PDF/CSV 预览。

用法: python3 scripts/test-multimodal-preview-e2e.py [base-url]
"""
import os, struct, sys, time, zlib
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://101.34.246.179/agui/'
CHROME = '/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell'
EV = 'docs/evidence'

# ---- 生成真实测试文件 ----
def make_png(path, w=96, h=64):
    """最小合法 PNG：红蓝渐变条纹。"""
    def chunk(typ, data):
        c = struct.pack('>I', len(data)) + typ + data
        return c + struct.pack('>I', zlib.crc32(typ + data) & 0xffffffff)
    raw = b''.join(
        b'\x00' + b''.join(
            bytes([int(255 * x / w), 40, int(255 * y / h)]) for x in range(w)
        ) for y in range(h)
    )
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
           + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))
    open(path, 'wb').write(png)

def make_pdf(path):
    """最小单页 PDF（无 xref，Chrome/pdfium 可重建）。"""
    body = b"""%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 320 140]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 62>>stream
BT /F1 13 Tf 20 80 Td (DataAgent multimodal preview e2e) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF
"""
    open(path, 'wb').write(body)

PNG, PDF, CSV = '/tmp/e2e-chart.png', '/tmp/e2e-report.pdf', '/tmp/e2e-sales.csv'
make_png(PNG)
make_pdf(PDF)
open(CSV, 'w', encoding='utf-8').write('区域,销售额\n华东,388082\n华北,276500\n华南,198233\n')

results = []
def check(name, ok, detail=''):
    results.append((name, ok))
    print(f"{'PASS' if ok else 'FAIL'}: {name}{(' —— ' + detail) if detail else ''}", flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=CHROME)
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    page.goto(BASE, wait_until='domcontentloaded', timeout=60000)
    # 会话状态跨 run 持留在服务端 —— 显式新建会话保证从欢迎页开始
    try:
        page.wait_for_selector('[data-testid="welcome-screen"]', timeout=8000)
    except Exception:
        page.locator('[data-testid="new-thread"]').click()
        page.wait_for_selector('[data-testid="welcome-screen"]', timeout=15000)

    # ---- 1. 欢迎页上传 3 个附件（真实点击 📎 → filechooser 路径） ----
    with page.expect_file_chooser(timeout=10000) as fc:
        page.locator('[data-testid="welcome-attach"]').click()
    fc.value.set_files([PNG, PDF, CSV])
    page.wait_for_selector('.welcome-chip[data-status="ready"]', timeout=30000)
    page.wait_for_function(
        "document.querySelectorAll('.welcome-chip[data-status=\"ready\"]').length >= 3",
        timeout=30000)
    check('欢迎页 3 个附件上传就绪(png/pdf/csv)', True)

    def chip(name):
        return page.locator('.welcome-chip', has_text=name).first.locator('.chip-name')

    # ---- 2. 欢迎页 chip 预览 ----
    chip('e2e-sales.csv').click()
    page.wait_for_selector('[data-testid="file-preview-table"]', timeout=10000)
    txt = page.locator('[data-testid="file-preview-table"]').inner_text()
    check('欢迎页 CSV chip → 表格预览(首行表头+数据)', '销售额' in txt and '388082' in txt)
    page.locator('[data-testid="file-preview-close"]').click()
    page.wait_for_selector('[data-testid="file-preview-modal"]', state='detached', timeout=5000)
    page.wait_for_timeout(400)  # 关闭动画 + 重渲染落定,避免点击判定 flake

    chip('e2e-report.pdf').click()
    page.wait_for_selector('[data-testid="file-preview-pdf"]', timeout=15000)
    src = page.locator('[data-testid="file-preview-pdf"]').get_attribute('src') or ''
    check('欢迎页 PDF chip → iframe 预览(blob URL,绕过 attachment disposition)', src.startswith('blob:'), src[:40])
    page.locator('[data-testid="file-preview-close"]').click()
    page.wait_for_selector('[data-testid="file-preview-modal"]', state='detached', timeout=5000)
    page.wait_for_timeout(400)

    chip('e2e-chart.png').click()
    page.wait_for_selector('[data-testid="image-lightbox"]', timeout=10000)
    lsrc = page.locator('[data-testid="image-lightbox-img"]').get_attribute('src') or ''
    check('欢迎页图片 chip → lightbox(会话下载链)', '/files/e2e-chart.png' in lsrc, lsrc[:80])
    page.screenshot(path='/tmp/mm-lightbox.png')
    page.locator('[data-testid="image-lightbox-close"]').click()
    page.wait_for_selector('[data-testid="image-lightbox"]', state='detached', timeout=5000)

    # ---- 3. 发首条消息进入对话视图（等 run 收尾——运行中输入区禁用,不能挂附件） ----
    ta = page.locator('.welcome-input textarea')
    ta.fill('附件已上传，回复"收到"即可，不用分析。')
    ta.press('Enter')
    page.wait_for_selector('[data-testid="copilot-chat-input-add"]', timeout=30000)
    # run 结束信号: "+" 按钮从 disabled 恢复（其 :disabled 绑定 isRunning）
    page.wait_for_function(
        "!document.querySelector('[data-testid=\"copilot-chat-input-add\"]').disabled",
        timeout=180000)
    page.wait_for_timeout(1500)

    # ---- 4. 主输入区 "+" 添加附件并发送（多模态 parts 随消息渲染） ----
    page.locator('[data-testid="copilot-chat-input-add"]').click()
    page.wait_for_selector('[data-testid="copilot-chat-input-add-menu"]', timeout=5000)
    with page.expect_file_chooser(timeout=10000) as fc:
        page.locator('[data-testid="copilot-chat-input-add-menu"] [role="menuitem"]').first.click()
    fc.value.set_files([PNG, PDF, CSV])
    page.wait_for_function(
        "document.querySelectorAll('[data-testid=\"copilot-chat-attachment-uploading-overlay\"]').length === 0"
        " && document.querySelectorAll('[data-testid=\"copilot-chat-attachment-item\"]').length >= 3",
        timeout=30000)
    check('主输入区附件队列就绪(3 项)', True)

    box = page.locator('textarea:visible').first
    box.fill('这些附件收到了即可，不用分析。')
    box.press('Enter')

    # 消息附件区渲染（用户消息多模态 parts）
    page.wait_for_selector('[data-testid="copilot-chat-attachment-renderer-image"]', timeout=30000)
    check('消息附件区渲染图片附件(inline img)', True)

    # ---- 5. 消息附件区点击预览 ----
    page.locator('[data-testid="copilot-chat-attachment-renderer-image"]').first.click()
    page.wait_for_selector('[data-testid="image-lightbox"]', timeout=10000)
    msrc = page.locator('[data-testid="image-lightbox-img"]').get_attribute('src') or ''
    check('消息图片附件点击 → lightbox', '/files/e2e-chart.png' in msrc, msrc[:80])
    page.screenshot(path='/tmp/mm-msg-lightbox.png')
    page.locator('[data-testid="image-lightbox-close"]').click()
    page.wait_for_selector('[data-testid="image-lightbox"]', state='detached', timeout=5000)

    pdf_chip = page.locator('[data-testid="copilot-chat-attachment-renderer-document"]', has_text='e2e-report.pdf').first
    pdf_chip.wait_for(timeout=15000)
    pdf_chip.click()
    page.wait_for_selector('[data-testid="file-preview-pdf"]', timeout=15000)
    msrc2 = page.locator('[data-testid="file-preview-pdf"]').get_attribute('src') or ''
    check('消息 PDF chip 点击 → iframe blob 预览', msrc2.startswith('blob:'), msrc2[:40])
    page.locator('[data-testid="file-preview-close"]').click()
    page.wait_for_selector('[data-testid="file-preview-modal"]', state='detached', timeout=5000)

    csv_chip = page.locator('[data-testid="copilot-chat-attachment-renderer-document"]', has_text='e2e-sales.csv').first
    csv_chip.click()
    page.wait_for_selector('[data-testid="file-preview-table"]', timeout=15000)
    ctxt = page.locator('[data-testid="file-preview-table"]').inner_text()
    check('消息 CSV chip 点击 → 表格预览', '华东' in ctxt and '388082' in ctxt)
    page.screenshot(path='/tmp/mm-msg-csv.png')
    page.locator('[data-testid="file-preview-close"]').click()
    page.wait_for_selector('[data-testid="file-preview-modal"]', state='detached', timeout=5000)

    # ---- 6. 文件面板 PDF / CSV 预览（锁定会话区——早期竞态 bug 的泄漏文件还留在共享区,同名会撞选择器） ----
    page.locator('[data-testid="rail-files"]').click()
    session_zone = page.locator('[data-testid="zone-session"]')
    session_zone.locator('.file-item[data-file="e2e-report.pdf"] .file-name').wait_for(timeout=15000)
    session_zone.locator('.file-item[data-file="e2e-report.pdf"] .file-name').click()
    page.wait_for_selector('[data-testid="file-preview-pdf"]', timeout=15000)
    fsrc = page.locator('[data-testid="file-preview-pdf"]').get_attribute('src') or ''
    check('文件面板 PDF 点击 → iframe blob 预览', fsrc.startswith('blob:'), fsrc[:40])
    page.screenshot(path='/tmp/mm-panel-pdf.png')
    page.locator('[data-testid="file-preview-close"]').click()
    page.wait_for_selector('[data-testid="file-preview-modal"]', state='detached', timeout=5000)

    session_zone.locator('.file-item[data-file="e2e-chart.png"] .file-name').click()
    page.wait_for_selector('[data-testid="file-preview-image"]', timeout=10000)
    check('文件面板图片点击 → modal 直渲(P32 回归)', True)
    page.locator('[data-testid="file-preview-close"]').click()

    page.close()
    browser.close()

fails = [n for n, ok in results if not ok]
os.makedirs(EV, exist_ok=True)
print(f"== RESULT: {'PASS' if not fails else 'FAIL'} ({len(results)-len(fails)}/{len(results)}) ==")
sys.exit(0 if not fails else 1)
