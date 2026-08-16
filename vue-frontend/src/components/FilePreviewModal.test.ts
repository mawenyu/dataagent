import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import FilePreviewModal from './FilePreviewModal.vue'

/** P-C: 文件预览 modal —— csv 表格 / json 美化 / md 渲染 / ESC·遮罩关闭。 */

function modal() {
  return document.body.querySelector('[data-testid="file-preview-modal"]')
}

describe('FilePreviewModal (P-C)', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('csv 渲染为表格: 首行表头,引号字段正确解析', async () => {
    const w = mount(FilePreviewModal, {
      props: { name: 'sales.csv', content: '区域,销售额\n"华,东",388082\n华北,100' },
      attachTo: document.body,
    })
    await nextTick()
    const table = modal()!.querySelector('[data-testid="file-preview-table"] table')!
    const ths = [...table.querySelectorAll('th')].map((e) => e.textContent)
    expect(ths).toEqual(['区域', '销售额'])
    const firstRow = [...table.querySelectorAll('tbody tr')[0].querySelectorAll('td')].map((e) => e.textContent)
    expect(firstRow).toEqual(['华,东', '388082'])
    w.unmount()
  })

  it('json 美化缩进展示', async () => {
    const w = mount(FilePreviewModal, {
      props: { name: 'conf.json', content: '{"a":1,"b":[2,3]}' },
      attachTo: document.body,
    })
    await nextTick()
    expect(modal()!.querySelector('[data-testid="file-preview-json"]')!.textContent).toContain('"a": 1')
    w.unmount()
  })

  it('md 渲染标题/加粗,且 XSS 被转义', async () => {
    const w = mount(FilePreviewModal, {
      props: { name: 'r.md', content: '# 报告\n**重点** <script>alert(1)</script>' },
      attachTo: document.body,
    })
    await nextTick()
    const md = modal()!.querySelector('[data-testid="file-preview-md"]')!
    expect(md.querySelector('h1')!.textContent).toBe('报告')
    expect(md.querySelector('strong')!.textContent).toBe('重点')
    expect(md.innerHTML).not.toContain('<script>')
    w.unmount()
  })

  it('txt 原文等宽展示 + truncated 提示', async () => {
    const w = mount(FilePreviewModal, {
      props: { name: 'a.txt', content: 'hello', truncated: true },
      attachTo: document.body,
    })
    await nextTick()
    expect(modal()!.querySelector('[data-testid="file-preview-text"]')!.textContent).toBe('hello')
    expect(modal()!.textContent).toContain('256KB')
    w.unmount()
  })

  it('ESC / 遮罩点击 / × 按钮均关闭', async () => {
    const w = mount(FilePreviewModal, {
      props: { name: 'a.txt', content: 'x' },
      attachTo: document.body,
    })
    await nextTick()
    ;(document.body.querySelector('[data-testid="file-preview-overlay"]') as HTMLElement)
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(w.emitted('close')).toHaveLength(1)

    ;(document.body.querySelector('[data-testid="file-preview-overlay"]') as HTMLElement).click()
    await nextTick()
    expect(w.emitted('close')).toHaveLength(2)

    ;(modal()!.querySelector('[data-testid="file-preview-close"]') as HTMLButtonElement).click()
    await nextTick()
    expect(w.emitted('close')).toHaveLength(3)
    w.unmount()
  })
})

describe('FilePreviewModal 大文件 (P-N)', () => {
  it('oversize: 显示下载提示与下载链接,不渲染内容区', async () => {
    const w = mount(FilePreviewModal, {
      props: { name: 'big.csv', oversize: true, sizeLabel: '2.0 MB', downloadUrl: '/agui-api/files/big.csv' },
      attachTo: document.body,
    })
    await nextTick()
    const dlg = modal()!
    expect(dlg.querySelector('[data-testid="file-preview-oversize"]')).toBeTruthy()
    expect(dlg.textContent).toContain('2.0 MB')
    expect((dlg.querySelector('[data-testid="file-preview-download"]') as HTMLAnchorElement).href).toContain('/agui-api/files/big.csv')
    expect(dlg.querySelector('[data-testid="file-preview-table"]')).toBeNull()
    w.unmount()
  })
})

describe('FilePreviewModal P32（图片预览）', () => {
  it('imageUrl 分支: <img> 直渲,不渲染表格/原文区', async () => {
    const w = mount(FilePreviewModal, {
      props: { name: 'chart.png', imageUrl: '/agui-api/files/chart.png' },
      attachTo: document.body,
    })
    await nextTick()
    const dlg = modal()!
    const img = dlg.querySelector('[data-testid="file-preview-image"]') as HTMLImageElement
    expect(img, '图片预览应有 <img>').toBeTruthy()
    expect(img.src).toContain('/agui-api/files/chart.png')
    expect(img.alt).toBe('chart.png')
    expect(dlg.querySelector('[data-testid="file-preview-table"]')).toBeNull()
    expect(dlg.querySelector('[data-testid="file-preview-text"]')).toBeNull()
    expect(dlg.querySelector('[data-testid="file-preview-oversize"]')).toBeNull()
    w.unmount()
  })

  it('图片分支仍可 ESC 关闭', async () => {
    const w = mount(FilePreviewModal, {
      props: { name: 'chart.png', imageUrl: '/x/chart.png' },
      attachTo: document.body,
    })
    await nextTick()
    const overlay = document.body.querySelector('[data-testid="file-preview-overlay"]') as HTMLElement
    overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(w.emitted('close')).toBeTruthy()
    w.unmount()
  })
})

describe('FilePreviewModal P-O（可达性）', () => {
  it('role/aria-modal/aria-label 齐全;Tab 圈定', async () => {
    const w = mount(FilePreviewModal, {
      props: { name: 'a.txt', content: 'x' },
      attachTo: document.body,
    })
    await nextTick()
    const dlg = modal()!
    expect(dlg.getAttribute('role')).toBe('dialog')
    expect(dlg.getAttribute('aria-modal')).toBe('true')
    expect(dlg.getAttribute('aria-label')).toContain('a.txt')
    // 只有一个可聚焦元素(×): Tab 回卷到它自己
    const overlay = document.body.querySelector('[data-testid="file-preview-overlay"]') as HTMLElement
    const closeBtn = dlg.querySelector('[data-testid="file-preview-close"]') as HTMLElement
    closeBtn.focus()
    overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(closeBtn)
    w.unmount()
  })
})
