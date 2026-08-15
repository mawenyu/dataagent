import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import App from '../App.vue'

/**
 * 需求4: 空会话欢迎页（品牌 + 建议问题快捷入口）+ 侧边栏可折叠。
 * 真实挂载整个 App（fetch 打桩，线程列表为空）。
 */
describe('App UI (需求4)', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    })))
  })

  it('空会话显示品牌欢迎页与 4 个场景模板卡', async () => {
    const w = mount(App)
    for (let i = 0; i < 10; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 20)) }
    const welcome = w.find('[data-testid="welcome-screen"]')
    expect(welcome.exists()).toBe(true)
    expect(welcome.text()).toContain('DataAgent 数据分析助手')
    const cards = w.findAll('.welcome-card')
    expect(cards).toHaveLength(4)
    expect(cards[0].text()).toContain('销售分析')
    expect(welcome.text()).toContain('周报生成')
    expect(welcome.text()).toContain('数据清洗')
  })

  it('P-D: 点模板卡填充输入框(不直接发送),可编辑后回车发出', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const w = mount(App)
    for (let i = 0; i < 10; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 20)) }

    await w.findAll('.welcome-card')[0].trigger('click')
    await nextTick()
    const textarea = w.find('.welcome-input textarea').element as HTMLTextAreaElement
    expect(textarea.value.length).toBeGreaterThan(10)
    // 未直接发送
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/agent/run'))).toBe(false)

    // 编辑后回车发送
    await w.find('.welcome-input textarea').setValue(`${textarea.value}（补充：只看华东）`)
    await w.find('.welcome-input textarea').trigger('keydown.enter')
    for (let i = 0; i < 8; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 10)) }
    const runCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/agent/run'))
    expect(runCall, '回车应发出编辑后的内容').toBeDefined()
    expect(String((runCall![1] as RequestInit)?.body ?? '')).toContain('只看华东')
  })

  it('顶栏 ☰ 按钮折叠/展开侧边栏', async () => {
    const w = mount(App)
    for (let i = 0; i < 8; i++) await nextTick()
    expect(w.find('[data-testid="thread-sidebar"]').exists()).toBe(true)
    await w.find('.sidebar-toggle').trigger('click')
    expect(w.find('[data-testid="thread-sidebar"]').exists()).toBe(false)
    await w.find('.sidebar-toggle').trigger('click')
    expect(w.find('[data-testid="thread-sidebar"]').exists()).toBe(true)
  })

  it('F1b: 欢迎页拖拽附件 → 即传当前会话 + chip 显示,空文本可发送,附件名随消息进 run 请求', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const w = mount(App)
    for (let i = 0; i < 10; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 20)) }
    expect(w.find('[data-testid="welcome-screen"]').exists()).toBe(true)

    // 拖拽文件到输入区 → 立即上传到当前会话工作目录
    const file = new File(['region,amount\n华东,120'], 'sales.csv', { type: 'text/csv' })
    await w.find('[data-testid="welcome-input"]').trigger('drop', {
      dataTransfer: { files: [file] },
    })
    for (let i = 0; i < 6; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 10)) }

    const uploadCall = fetchMock.mock.calls.find(([url, init]) =>
      String(url).includes('/chat/threads/') && String(url).endsWith('/files') && init?.method === 'POST',
    )
    expect(uploadCall, '选中即应 POST 到会话级 files API').toBeDefined()
    expect(uploadCall![0]).toContain('/agui-api/chat/threads/')

    // chip 显示且可删除
    const chips = w.find('[data-testid="welcome-chips"]')
    expect(chips.exists()).toBe(true)
    expect(chips.text()).toContain('sales.csv')

    // 空文本 + ready 附件 → 发送按钮可用
    const sendBtn = w.find('.welcome-send')
    expect(sendBtn.attributes('disabled')).toBeUndefined()
    await sendBtn.trigger('click')
    for (let i = 0; i < 8; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 10)) }

    // 附件名随消息进 agent run 请求体（gateway 会把用户文本写进 prompt）
    const runCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/agent/run'))
    expect(runCall, '发送后应触发 /agent/run').toBeDefined()
    const body = String((runCall![1] as RequestInit)?.body ?? '')
    expect(body).toContain('sales.csv')
    expect(body).toContain('请分析我上传的数据文件')
  })

  it('P-A: 会话导出 —— 点导出按钮拉历史消息生成 Markdown Blob 下载', async () => {
    const thread = { id: 't-exp', title: '八月销售', sessionId: 's-1', createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-02T00:00:00Z' }
    const messages = [
      { id: 'u1', role: 'user', content: '分析八月销售' },
      {
        id: 'a1', role: 'assistant', content: '总额 120 万',
        toolCalls: [{ id: 'tc1', function: { name: 'bash', arguments: '{"command":"ls"}' } }],
      },
      { id: 'toolres-tc1', role: 'tool', toolCallId: 'tc1', content: 'sales.csv' },
    ]
    const fetchMock = vi.fn(async (input: any) => {
      const url = String(input)
      if (url.endsWith('/chat/threads')) return { ok: true, json: async () => ({ data: [thread] }) }
      if (url.includes('/messages')) return { ok: true, json: async () => ({ data: messages }) }
      return { ok: true, json: async () => ({ data: [] }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const createObjectURL = vi.fn(() => 'blob:mock')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const w = mount(App)
    for (let i = 0; i < 10; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 20)) }

    const exportBtn = w.find('[data-testid="export-t-exp"]')
    expect(exportBtn.exists(), '会话列表项应有导出按钮').toBe(true)
    await exportBtn.trigger('click')
    for (let i = 0; i < 6; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 10)) }

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob.type).toContain('text/markdown')
    const md = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsText(blob)
    })
    expect(md).toContain('# 会话导出：八月销售')
    expect(md).toContain('## 👤 用户')
    expect(md).toContain('分析八月销售')
    expect(md).toContain('**bash**')
    expect(md).toContain('sales.csv')
    expect(clickSpy).toHaveBeenCalledTimes(1)
    // 成功 toast
    expect(w.find('.toast-stack').text()).toContain('导出成功')
    clickSpy.mockRestore()
  })

  it('P-B: run 失败 → 内联错误卡;点重试在原线程重发最后一条用户消息(不重复入列)', async () => {
    // fetch 打桩返回非 SSE 响应 → agent run 必然失败(getReader 缺失)
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const w = mount(App)
    for (let i = 0; i < 10; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 20)) }

    // 欢迎页发送一条消息 → 触发 /agent/run(会失败)
    await w.find('.welcome-input textarea').setValue('分析本月销售')
    await w.find('.welcome-send').trigger('click')
    for (let i = 0; i < 10; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 15)) }
    const runs = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/agent/run'))
    expect(runs().length).toBe(1)

    // 内联错误卡出现在消息流尾部上方
    const card = w.find('[data-testid="run-error-card"]')
    expect(card.exists(), 'run 失败应显示内联错误卡').toBe(true)

    // 点重试 → 同一线程重发最后一条用户消息
    await w.find('[data-testid="run-error-retry"]').trigger('click')
    for (let i = 0; i < 10; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 15)) }
    expect(runs().length, '重试应再次触发 /agent/run').toBe(2)
    const retryBody = String((runs()[1][1] as RequestInit)?.body ?? '')
    expect(retryBody).toContain('分析本月销售')
    // 失败轮被截掉后重发 → 请求体里该用户消息只出现一次
    expect(retryBody.split('分析本月销售').length - 1).toBe(1)
  })
})
