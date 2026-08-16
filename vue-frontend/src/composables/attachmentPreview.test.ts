import { describe, expect, it } from 'vitest'
import { resolveAttachmentPreview } from './attachmentPreview'

/**
 * 多模态预览 step2: 对话附件区点击 → 预览目标解析（纯函数层）。
 * fork CopilotChatAttachmentRenderer 的 DOM 契约：
 * - 图片: <img data-testid="copilot-chat-attachment-renderer-image" src=下载URL alt=文件名>
 * - 文档: [data-testid="copilot-chat-attachment-renderer-document"] 内含
 *         [data-testid="copilot-chat-attachment-renderer-document-label"] 文本=文件名
 */

const downloadUrl = (name: string) => `/agui-api/chat/threads/t1/files/${encodeURIComponent(name)}`

function imgEl(src: string, alt: string): HTMLImageElement {
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

describe('resolveAttachmentPreview (多模态预览)', () => {
  it('点消息图片附件 → image 目标(直接用 img.src,大图 lightbox)', () => {
    const img = imgEl('http://x/agui-api/chat/threads/t1/files/chart.png', 'chart.png')
    expect(resolveAttachmentPreview(img, downloadUrl)).toEqual({
      kind: 'image',
      name: 'chart.png',
      url: 'http://x/agui-api/chat/threads/t1/files/chart.png',
    })
  })

  it('点 PDF 文档 chip → pdf 目标(url=会话下载链,打开时 blob 化)', () => {
    const chip = docChip('季度报告.pdf')
    // 点 label 子元素也应解析到 chip
    expect(resolveAttachmentPreview(chip.firstElementChild, downloadUrl)).toEqual({
      kind: 'pdf',
      name: '季度报告.pdf',
      url: '/agui-api/chat/threads/t1/files/%E5%AD%A3%E5%BA%A6%E6%8A%A5%E5%91%8A.pdf',
    })
  })

  it('点 CSV/MD 文档 chip → text 目标(走 256KB 截断文本预览)', () => {
    expect(resolveAttachmentPreview(docChip('sales.csv'), downloadUrl)).toEqual({
      kind: 'text', name: 'sales.csv', url: '/agui-api/chat/threads/t1/files/sales.csv',
    })
    expect(resolveAttachmentPreview(docChip('notes.md'), downloadUrl)).toEqual({
      kind: 'text', name: 'notes.md', url: '/agui-api/chat/threads/t1/files/notes.md',
    })
  })

  it('文档 chip 是图片扩展名 → image 目标(下载链 lightbox)', () => {
    expect(resolveAttachmentPreview(docChip('plot.webp'), downloadUrl)).toEqual({
      kind: 'image', name: 'plot.webp', url: '/agui-api/chat/threads/t1/files/plot.webp',
    })
  })

  it('不可预览类型(xlsx) / 非附件元素 → null(保持原有点击行为)', () => {
    expect(resolveAttachmentPreview(docChip('book.xlsx'), downloadUrl)).toBeNull()
    const div = document.createElement('div')
    expect(resolveAttachmentPreview(div, downloadUrl)).toBeNull()
    expect(resolveAttachmentPreview(null, downloadUrl)).toBeNull()
  })

  it('音频/视频附件不拦截(原生播放器已有交互)', () => {
    const audio = document.createElement('audio')
    audio.setAttribute('data-testid', 'copilot-chat-attachment-renderer-audio')
    expect(resolveAttachmentPreview(audio, downloadUrl)).toBeNull()
  })
})
