import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import App from '../App.vue'

/**
 * 多模态预览 step2: 对话附件区点击预览 —— App 级事件委托（不改 fork）。
 * 模拟 fork CopilotChatAttachmentRenderer 的真实 DOM(testid 契约)注入 chat-col,
 * 验证: 图片 → lightbox;pdf chip → blob iframe;csv chip → 文本预览 modal;非附件 → 不拦截。
 */

async function settle(n = 10) {
  for (let i = 0; i < n; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 15)) }
}

function imgAttachment(src: string, alt: string): HTMLImageElement {
  const img = document.createElement('img')
  img.setAttribute('data-testid', 'copilot-chat-attachment-renderer-image')
  img.src = src
  img.alt = alt
  return img
}

function docChip(filename: string): HTMLElement {
  const chip = document.createElement('div')
  chip.setAttribute('data-testid', 'copilot-chat-attachment-renderer-document')
  const label = document.createElement('span')
  label.setAttribute('data-testid', 'copilot-chat-attachment-renderer-document-label')
  label.textContent = filename
  chip.appendChild(label)
  return chip
}

describe('App 附件点击预览 (多模态预览 step2)', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
      arrayBuffer: async () => new TextEncoder().encode('a,b\n1,2').buffer,
    })))
  })
  afterEach(() => { document.body.innerHTML = '' })

  it('点消息图片附件 → 图片 lightbox 打开,关闭后消失', async () => {
    const w = mount(App)
    await settle()
    const col = w.find('.chat-col').element
    const img = imgAttachment('http://x/agui-api/chat/threads/t1/files/chart.png', 'chart.png')
    col.appendChild(img)
    img.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle(4)
    const lb = document.body.querySelector('[data-testid="image-lightbox"]')
    expect(lb, '点击图片附件应打开 lightbox').toBeTruthy()
    expect((lb!.querySelector('[data-testid="image-lightbox-img"]') as HTMLImageElement).src)
      .toContain('/files/chart.png')
    // 关闭
    ;(lb!.querySelector('[data-testid="image-lightbox-close"]') as HTMLButtonElement).click()
    await settle(4)
    expect(document.body.querySelector('[data-testid="image-lightbox"]')).toBeNull()
    w.unmount()
  })

  it('点 PDF 文档 chip → blob 化后 iframe 预览(modal)', async () => {
    const createObjectURL = vi.fn(() => 'blob:pdf-e2e')
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }))
    const w = mount(App)
    await settle()
    const col = w.find('.chat-col').element
    const chip = docChip('季度报告.pdf')
    col.appendChild(chip)
    chip.querySelector('span')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle(6)
    const frame = document.body.querySelector('[data-testid="file-preview-pdf"]') as HTMLIFrameElement
    expect(frame, '点击 PDF chip 应打开 iframe 预览').toBeTruthy()
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect((createObjectURL.mock.calls[0][0] as Blob).type).toBe('application/pdf')
    w.unmount()
  })

  it('点 CSV 文档 chip → 256KB 文本预览 modal(表格分支)', async () => {
    const w = mount(App)
    await settle()
    const col = w.find('.chat-col').element
    const chip = docChip('sales.csv')
    col.appendChild(chip)
    chip.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle(6)
    const table = document.body.querySelector('[data-testid="file-preview-table"]')
    expect(table, '点击 CSV chip 应打开表格预览').toBeTruthy()
    w.unmount()
  })

  it('点非附件区域 → 不打开任何预览', async () => {
    const w = mount(App)
    await settle()
    const col = w.find('.chat-col').element
    const div = document.createElement('div')
    col.appendChild(div)
    div.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle(4)
    expect(document.body.querySelector('[data-testid="image-lightbox"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="file-preview-modal"]')).toBeNull()
    w.unmount()
  })

  it('欢迎页附件 chip(ready)点击文件名 → 预览;xlsx 走 toast 提示', async () => {
    const w = mount(App)
    await settle()
    // 通过隐藏 file input 驱动真实添加链路（上传 fetch 已打桩 ok）
    const input = w.find('[data-testid="welcome-file-input"]').element as HTMLInputElement
    const csv = new File(['a,b\n1,2'], 'sales.csv', { type: 'text/csv' })
    const xlsx = new File(['x'], 'book.xlsx', { type: 'application/vnd.ms-excel' })
    Object.defineProperty(input, 'files', { value: [csv, xlsx], configurable: true })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()

    const chips = w.findAll('.welcome-chip')
    expect(chips.length).toBe(2)
    // csv chip → 文本预览 modal
    await chips[0].find('.chip-name').trigger('click')
    await settle(6)
    expect(document.body.querySelector('[data-testid="file-preview-table"]'), 'csv chip 应打开表格预览').toBeTruthy()
    // 关闭后再点 xlsx chip → toast 提示不可预览
    ;(document.body.querySelector('[data-testid="file-preview-close"]') as HTMLButtonElement).click()
    await settle(4)
    await chips[1].find('.chip-name').trigger('click')
    await settle(4)
    expect(document.body.querySelector('[data-testid="file-preview-modal"]'), 'xlsx 不应打开预览').toBeNull()
    expect(w.text()).toContain('暂不支持预览')
    w.unmount()
  })
})
