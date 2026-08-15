import { describe, expect, it, vi } from 'vitest'
import {
  buildThreadMarkdown,
  downloadMarkdown,
  exportFilename,
  type ExportableMessage,
} from './exportThread'

/**
 * P-A: 会话导出为 Markdown。
 * 数据源 = gateway /chat/threads/{id}/messages(AG-UI 形态:
 * user/assistant/reasoning 为 content 字符串; assistant 可带 toolCalls
 * [{id,function:{name,arguments(JSON 串)}}]; 工具结果为 role:tool +
 * toolCallId + content)。消息无逐条时间戳 —— 时间信息取会话元数据 +
 * 导出时间。
 */

const thread = {
  id: 'thread-abc123def',
  title: '本月销售分析',
  createdAt: '2026-08-15T02:00:00Z',
  updatedAt: '2026-08-15T03:00:00Z',
}
const exportedAt = new Date('2026-08-15T13:05:33Z')

describe('buildThreadMarkdown (P-A)', () => {
  it('头部含标题/会话ID/导出时间/消息数', () => {
    const md = buildThreadMarkdown(thread, [], exportedAt)
    expect(md).toContain('# 会话导出：本月销售分析')
    expect(md).toContain('thread-abc123def')
    expect(md).toContain('导出时间')
    expect(md).toContain('消息数: 0')
  })

  it('用户/助手消息按角色渲染,内容为原文', () => {
    const messages: ExportableMessage[] = [
      { id: 'u1', role: 'user', content: '分析本月销售' },
      { id: 'a1', role: 'assistant', content: '本月总销售额为 120 万。' },
    ]
    const md = buildThreadMarkdown(thread, messages, exportedAt)
    expect(md).toContain('## 👤 用户')
    expect(md).toContain('分析本月销售')
    expect(md).toContain('## 🤖 助手')
    expect(md).toContain('本月总销售额为 120 万。')
    expect(md).toContain('消息数: 2')
  })

  it('多模态用户消息(parts 数组)取文本并附附件名', () => {
    const messages: ExportableMessage[] = [
      {
        id: 'u1',
        role: 'user',
        content: [
          { type: 'text', text: '看这个文件' },
          { type: 'document', metadata: { filename: 'sales.csv' } },
        ] as unknown as string,
      },
    ]
    const md = buildThreadMarkdown(thread, messages, exportedAt)
    expect(md).toContain('看这个文件')
    expect(md).toContain('sales.csv')
  })

  it('工具调用按 toolCallId 配对结果,渲染为摘要列表', () => {
    const messages: ExportableMessage[] = [
      { id: 'u1', role: 'user', content: '查数据' },
      {
        id: 'a1',
        role: 'assistant',
        content: '好的',
        toolCalls: [
          { id: 'tc1', function: { name: 'bash', arguments: '{"command":"ls"}' } },
        ],
      },
      { id: 'toolres-tc1', role: 'tool', toolCallId: 'tc1', content: 'sales.csv' },
    ]
    const md = buildThreadMarkdown(thread, messages, exportedAt)
    expect(md).toContain('工具调用')
    expect(md).toContain('**bash**')
    expect(md).toContain('`{"command":"ls"}`')
    expect(md).toContain('sales.csv')
    // 工具消息被配对消费后不重复出现独立小节
    expect(md.match(/sales\.csv/g)!.length).toBe(1)
  })

  it('超长工具结果截断并标注原长度', () => {
    const long = 'x'.repeat(800)
    const messages: ExportableMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tc1', function: { name: 'read', arguments: '{}' } }],
      },
      { id: 'toolres-tc1', role: 'tool', toolCallId: 'tc1', content: long },
    ]
    const md = buildThreadMarkdown(thread, messages, exportedAt)
    expect(md).not.toContain(long)
    expect(md).toContain('截断')
    expect(md).toContain('800')
  })

  it('无结果的工具调用标注"无结果";孤儿 tool 消息渲染为独立工具输出', () => {
    const messages: ExportableMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tcX', function: { name: 'bash', arguments: '{}' } }],
      },
      { id: 'orphan', role: 'tool', toolCallId: 'tc-other', content: 'orphan-out' },
    ]
    const md = buildThreadMarkdown(thread, messages, exportedAt)
    expect(md).toContain('无结果')
    expect(md).toContain('工具输出')
    expect(md).toContain('orphan-out')
  })

  it('reasoning 渲染为思考过程引用块', () => {
    const messages: ExportableMessage[] = [
      { id: 'r1', role: 'reasoning', content: '先拆分指标再汇总' },
    ]
    const md = buildThreadMarkdown(thread, messages, exportedAt)
    expect(md).toContain('🧠 思考过程')
    expect(md).toContain('> 先拆分指标再汇总')
  })

  it('空 content 的助手消息(纯工具调用)不渲染空正文段', () => {
    const messages: ExportableMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tc1', function: { name: 'bash', arguments: '{}' } }],
      },
    ]
    const md = buildThreadMarkdown(thread, messages, exportedAt)
    expect(md).toContain('## 🤖 助手')
    expect(md).toContain('**bash**')
  })
})

describe('exportFilename', () => {
  it('标题净化(非法字符替换) + id 前缀 + .md', () => {
    const name = exportFilename({ id: 'thread-abc123def', title: '销售/分析:八月?' })
    expect(name).toMatch(/\.md$/)
    expect(name).not.toMatch(/[/:?]/)
    expect(name).toContain('thread-a')
    expect(name).toContain('销售')
  })

  it('空标题回退为 id', () => {
    expect(exportFilename({ id: 'thread-xyz', title: '' })).toContain('thread-x')
  })
})

describe('downloadMarkdown', () => {
  it('生成 text/markdown Blob 并触发下载', () => {
    const url = 'blob:mock'
    const createObjectURL = vi.fn(() => url)
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    downloadMarkdown('a.md', '# hello')
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob.type).toContain('text/markdown')
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith(url)
    clickSpy.mockRestore()
  })
})
