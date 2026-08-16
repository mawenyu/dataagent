import { describe, expect, it, vi } from 'vitest'
import {
  buildThreadJson,
  buildThreadMarkdown,
  downloadJson,
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

describe('P-M: 导出增强(时间/耗时/状态/附件清单/JSON)', () => {
  it('消息带 createdAt 时小节标题含时间', () => {
    const md = buildThreadMarkdown(thread, [
      { id: 'u1', role: 'user', content: '你好', createdAt: '2026-08-15T13:03:31Z' },
    ], exportedAt)
    expect(md).toMatch(/## 👤 用户 · \d{2}:\d{2}:\d{2}/)
  })

  it('工具调用摘要含耗时与结果状态', () => {
    const md = buildThreadMarkdown(thread, [
      {
        id: 'a1', role: 'assistant', content: '',
        toolCalls: [
          { id: 't1', function: { name: 'bash', arguments: '{}' }, durationMs: 464, status: 'completed' },
          { id: 't2', function: { name: 'read', arguments: '{}' }, durationMs: 1500, status: 'error' },
        ],
      },
      { id: 'toolres-t1', role: 'tool', toolCallId: 't1', content: 'ok' },
      { id: 'toolres-t2', role: 'tool', toolCallId: 't2', content: 'boom' },
    ], exportedAt)
    expect(md).toContain('**bash**')
    expect(md).toContain('464ms')
    expect(md).toContain('✓ 完成')
    expect(md).toContain('1.5s')
    expect(md).toContain('✗ 失败')
  })

  it('无耗时/状态字段时不渲染对应片段(向后兼容旧历史)', () => {
    const md = buildThreadMarkdown(thread, [
      { id: 'a1', role: 'assistant', content: '', toolCalls: [{ id: 't1', function: { name: 'bash', arguments: '{}' } }] },
    ], exportedAt)
    expect(md).toContain('**bash**')
    expect(md).not.toContain('✓ 完成')
    expect(md).not.toContain('ms ·')
  })

  it('用户消息附件清单渲染为 📎 行', () => {
    const md = buildThreadMarkdown(thread, [
      { id: 'u1', role: 'user', content: '分析它们', attachments: ['a.csv', 'b.xlsx'] },
    ], exportedAt)
    expect(md).toContain('📎 附件：a.csv、b.xlsx')
  })

  it('buildThreadJson: 结构化会话数据(线程元数据 + 归一消息 + 导出时间)', () => {
    const json = buildThreadJson(thread, [
      { id: 'u1', role: 'user', content: 'hi', createdAt: '2026-08-15T13:00:00Z', attachments: ['a.csv'] },
      {
        id: 'a1', role: 'assistant', content: 'ok',
        toolCalls: [{ id: 't1', function: { name: 'bash', arguments: '{"c":1}' }, durationMs: 100, status: 'completed' }],
      },
      { id: 'toolres-t1', role: 'tool', toolCallId: 't1', content: 'done' },
    ], exportedAt)
    expect(json.thread).toMatchObject({ id: thread.id, title: thread.title })
    expect(json.messageCount).toBe(3)
    expect(json.exportedAt).toBe(exportedAt.toISOString())
    const m0 = json.messages[0]
    expect(m0).toMatchObject({ role: 'user', content: 'hi', createdAt: '2026-08-15T13:00:00Z', attachments: ['a.csv'] })
    const tc = json.messages[1].toolCalls![0]
    expect(tc).toMatchObject({ name: 'bash', durationMs: 100, status: 'completed', result: 'done' })
  })

  it('exportFilename 支持 json 扩展名', () => {
    expect(exportFilename(thread, 'json')).toMatch(/\.json$/)
    expect(exportFilename(thread, 'md')).toMatch(/\.md$/)
  })

  it('downloadJson 生成 application/json Blob 下载', () => {
    const createObjectURL = vi.fn(() => 'blob:json')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    downloadJson('a.json', { hello: 1 })
    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob.type).toContain('application/json')
    expect(clickSpy).toHaveBeenCalledTimes(1)
    clickSpy.mockRestore()
  })
})

describe('A2UI 引用导出（布局分栏配套）', () => {
  const thread = { id: 't-a2ui', title: '看板会话' }
  const exportedAt = new Date('2026-08-17T01:00:00Z')
  const a2uiArgs = JSON.stringify({
    surfaceId: 'dash-1',
    components: [
      { component: 'MetricCard', id: 'm1' },
      { component: 'BarChart', id: 'b1' },
    ],
    data: { revenue: 100, rows: [1, 2, 3] },
  })

  it('MD：render_a2ui 工具调用渲染为 A2UI 看板小节（surfaceId + 组件清单），不倾倒原始 JSON', () => {
    const md = buildThreadMarkdown(thread, [
      { id: 'u1', role: 'user', content: '画看板' },
      { id: 'a1', role: 'assistant', content: '', toolCalls: [{ id: 'tc1', function: { name: 'render_a2ui', arguments: a2uiArgs } }] },
      { id: 'tr1', role: 'tool', toolCallId: 'tc1', content: '已渲染 surface dash-1' },
    ], exportedAt)
    expect(md).toContain('🎨')
    expect(md).toContain('dash-1')
    expect(md).toContain('MetricCard')
    expect(md).toContain('BarChart')
    expect(md).toContain('2 个组件')
    expect(md).not.toContain('"surfaceId"') // 不倒原始 JSON
  })

  it('MD：render_report 同样识别为 A2UI 引用', () => {
    const md = buildThreadMarkdown(thread, [
      { id: 'a1', role: 'assistant', content: '', toolCalls: [{ id: 'tc1', function: { name: 'render_report', arguments: a2uiArgs } }] },
    ], exportedAt)
    expect(md).toContain('🎨 **A2UI 看板** `dash-1`')
    expect(md).not.toContain('"surfaceId"') // 引用形态而非原始 JSON
  })

  it('MD：render_a2ui 参数非法 JSON → 回退普通工具调用渲染，不炸', () => {
    const md = buildThreadMarkdown(thread, [
      { id: 'a1', role: 'assistant', content: '', toolCalls: [{ id: 'tc1', function: { name: 'render_a2ui', arguments: '{bad json' } }] },
    ], exportedAt)
    expect(md).toContain('render_a2ui')
    expect(md).toContain('{bad json')
  })

  it('JSON：a2uiRef 结构化字段（surfaceId/组件类型/数据键数）', () => {
    const json = buildThreadJson(thread, [
      { id: 'a1', role: 'assistant', content: '', toolCalls: [{ id: 'tc1', function: { name: 'render_a2ui', arguments: a2uiArgs } }] },
    ], exportedAt)
    const tc = json.messages[0].toolCalls![0]
    expect(tc.name).toBe('render_a2ui')
    expect(tc.a2uiRef).toEqual({
      surfaceId: 'dash-1',
      componentTypes: ['MetricCard', 'BarChart'],
      componentCount: 2,
      dataKeys: 2,
    })
  })

  it('JSON：非 A2UI 工具调用不带 a2uiRef；非法参数也不带', () => {
    const json = buildThreadJson(thread, [
      { id: 'a1', role: 'assistant', content: '', toolCalls: [
        { id: 't1', function: { name: 'bash', arguments: '{"c":1}' } },
        { id: 't2', function: { name: 'render_a2ui', arguments: '{bad' } },
      ] },
    ], exportedAt)
    expect(json.messages[0].toolCalls![0].a2uiRef).toBeUndefined()
    expect(json.messages[0].toolCalls![1].a2uiRef).toBeUndefined()
  })
})
