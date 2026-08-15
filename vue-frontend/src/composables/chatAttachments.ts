/**
 * task6-B: ChatGPT 式上传（spec: docs/spec/workspace-isolation.md）。
 *
 * 生成 fork CopilotChat 的 attachments 配置：输入框"+"菜单出现 Add file
 * 入口 + 拖拽上传；选中即上传到**当前会话**的工作目录（onUpload 由调用方
 * 绑定到会话级 /chat/threads/{id}/files API），发送时附件作为 multimodal
 * content part 随消息发出（metadata.filename → gateway 写进 agent prompt）。
 *
 * 类型与 @copilotkit/shared 的 AttachmentsConfig 对齐（此处结构化声明，
 * 避免深路径 import）。
 */

export interface AttachmentUploadErrorLike {
  reason: 'file-too-large' | 'invalid-type' | 'upload-failed'
  file: File
  message: string
}

export interface AttachmentsConfigLike {
  enabled: boolean
  accept?: string
  maxSize?: number
  onUpload?: (file: File) => Promise<{
    type: 'url'
    value: string
    mimeType?: string
    metadata?: Record<string, unknown>
  }>
  onUploadFailed?: (error: AttachmentUploadErrorLike) => void
}

/** 数据分析场景常见类型；与 gateway 文件名白名单（扩展名部分）兼容。 */
export const ATTACH_ACCEPT = '.csv,.json,.txt,.md,.tsv,.log,.xlsx,.png,.jpg,.jpeg,.webp'

/** 与 gateway agui.files.max-upload-size 一致（2026-08-15 同步 5MB → 50MB）。 */
export const ATTACH_MAX_SIZE = 50 * 1024 * 1024

export function buildAttachmentsConfig(deps: {
  /** 上传到当前会话工作目录（抛错 = 上传失败，fork 会移除该附件并回调 onUploadFailed）。 */
  upload: (file: File) => Promise<void>
  /** 会话级下载 URL（作为附件 source 回传给 agent/gateway）。 */
  downloadUrl: (name: string) => string
  /** 失败提示（toast 等）。 */
  onFailed: (error: AttachmentUploadErrorLike) => void
}): AttachmentsConfigLike {
  return {
    enabled: true,
    accept: ATTACH_ACCEPT,
    maxSize: ATTACH_MAX_SIZE,
    onUpload: async (file: File) => {
      await deps.upload(file)
      return {
        type: 'url' as const,
        value: deps.downloadUrl(file.name),
        mimeType: file.type || 'application/octet-stream',
        metadata: { filename: file.name },
      }
    },
    onUploadFailed: (error) => deps.onFailed(error),
  }
}
