/**
 * 多模态预览 step2: 对话附件区点击 → 预览目标解析（纯函数层，App 级事件委托用）。
 *
 * 不改 fork：fork CopilotChatAttachmentRenderer 的 DOM 带有稳定 testid，
 * 在对话栏容器上做点击委托即可拿到附件身份：
 * - 图片消息附件: <img data-testid="copilot-chat-attachment-renderer-image"> → lightbox
 * - 文档 chip: [data-testid="copilot-chat-attachment-renderer-document"] 的 label 文本
 *   = 文件名 → 按扩展名分流（pdf → iframe blob 预览；csv/md 等 → 256KB 文本预览；
 *   图片扩展名 → lightbox；xlsx 等不可预览 → null 不拦截）
 * - 音频/视频: 原生播放器自带交互，不拦截
 */

import { isImage, isPdf, isPreviewable } from './filePreview'

export type AttachmentPreviewTarget =
  | { kind: 'image'; name: string; url: string }
  | { kind: 'pdf'; name: string; url: string }
  | { kind: 'text'; name: string; url: string }

const IMG_TESTID = 'copilot-chat-attachment-renderer-image'
const DOC_TESTID = 'copilot-chat-attachment-renderer-document'
const DOC_LABEL_TESTID = 'copilot-chat-attachment-renderer-document-label'

/**
 * 从点击目标解析预览意图；不可预览/非附件 → null（调用方保持原行为）。
 * downloadUrl: 文件名 → 会话级下载链（useWorkspaceFiles.downloadUrl）。
 */
export function resolveAttachmentPreview(
  el: EventTarget | null,
  downloadUrl: (name: string) => string,
): AttachmentPreviewTarget | null {
  if (!(el instanceof HTMLElement)) return null

  // 图片附件：src 即下载链，直接 lightbox
  const img = el.closest(`img[data-testid="${IMG_TESTID}"]`) as HTMLImageElement | null
  if (img?.src) {
    return { kind: 'image', name: img.alt || '图片', url: img.src }
  }

  // 文档 chip：label 文本 = 文件名，按扩展名分流
  const chip = el.closest(`[data-testid="${DOC_TESTID}"]`)
  if (chip) {
    const name = chip.querySelector(`[data-testid="${DOC_LABEL_TESTID}"]`)?.textContent?.trim() ?? ''
    if (!name) return null
    const url = downloadUrl(name)
    if (isImage(name)) return { kind: 'image', name, url }
    if (isPdf(name)) return { kind: 'pdf', name, url }
    if (isPreviewable(name)) return { kind: 'text', name, url }
    return null
  }

  return null
}
