import { describe, expect, it, vi } from 'vitest'
import { buildAttachmentsConfig } from './chatAttachments'

/**
 * task6-B: ChatGPT 式上传（spec: docs/spec/workspace-isolation.md）。
 * buildAttachmentsConfig 生成 fork CopilotChat 的 attachments 配置：
 * onUpload 把文件传到当前会话工作目录，返回 url source + filename metadata
 * （gateway 从 metadata.filename 把附件名写进 agent prompt）。
 */
describe('buildAttachmentsConfig (task6 ChatGPT 式上传)', () => {
  it('onUpload 上传到会话工作目录并返回 url source + filename metadata', async () => {
    const upload = vi.fn().mockResolvedValue(undefined)
    const config = buildAttachmentsConfig({
      upload,
      downloadUrl: (name) => `/agui-api/chat/threads/thread-1/files/${name}`,
      onFailed: () => {},
    })

    const file = new File(['a,b\n1,2'], 'sales.csv', { type: 'text/csv' })
    const result = await config.onUpload!(file)

    expect(upload).toHaveBeenCalledWith(file)
    expect(result.type).toBe('url')
    expect(result.value).toBe('/agui-api/chat/threads/thread-1/files/sales.csv')
    expect(result.mimeType).toBe('text/csv')
    expect(result.metadata?.filename).toBe('sales.csv')
  })

  it('上限与 accept 与 gateway 一致（5MB）', () => {
    const config = buildAttachmentsConfig({ upload: async () => {}, downloadUrl: (n) => n, onFailed: () => {} })
    expect(config.enabled).toBe(true)
    expect(config.maxSize).toBe(5 * 1024 * 1024)
    expect(config.accept).toContain('.csv')
  })

  it('上传异常冒泡（fork 会转 onUploadFailed）；onFailed 转发错误', async () => {
    const onFailed = vi.fn()
    const config = buildAttachmentsConfig({ upload: async () => {}, downloadUrl: (n) => n, onFailed })
    config.onUploadFailed!({ reason: 'file-too-large', file: new File(['x'], 'big.csv'), message: 'too large' })
    expect(onFailed).toHaveBeenCalledOnce()
    expect(onFailed.mock.calls[0][0].message).toBe('too large')

    const bad = buildAttachmentsConfig({
      upload: async () => { throw new Error('HTTP 413') },
      downloadUrl: (n) => n,
      onFailed: () => {},
    })
    await expect(bad.onUpload!(new File(['x'], 'a.csv'))).rejects.toThrow('HTTP 413')
  })
})
