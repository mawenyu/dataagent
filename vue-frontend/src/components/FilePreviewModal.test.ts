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
