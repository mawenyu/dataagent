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
    await nextTick()
    await w.find('[data-testid="export-md-t-exp"]').trigger('click')
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

    // P-M: JSON 格式选项 → application/json Blob,内容为结构化会话数据
    await w.find('[data-testid="export-t-exp"]').trigger('click')
    await nextTick()
    await w.find('[data-testid="export-json-t-exp"]').trigger('click')
    for (let i = 0; i < 6; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 10)) }
    expect(createObjectURL).toHaveBeenCalledTimes(2)
    const jsonBlob = createObjectURL.mock.calls[1][0] as Blob
    expect(jsonBlob.type).toContain('application/json')
    const jsonText = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsText(jsonBlob)
    })
    const parsed = JSON.parse(jsonText)
    expect(parsed.thread.id).toBe('t-exp')
    expect(parsed.messageCount).toBe(3)
    expect(parsed.messages[1].toolCalls[0]).toMatchObject({ name: 'bash', result: 'sales.csv' })
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

  it('P-E: 点模板卡填充并高亮该卡;一键清空按钮清空输入并移除高亮', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }))
    vi.stubGlobal('fetch', fetchMock)
    const w = mount(App)
    for (let i = 0; i < 10; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 20)) }

    // 填充前无清空按钮
    expect(w.find('[data-testid="welcome-clear"]').exists()).toBe(false)

    const first = w.findAll('.welcome-card')[0]
    await first.trigger('click')
    await nextTick()
    expect(first.classes(), '点击后卡片应高亮').toContain('card-active')

    // 一键清空
    const clearBtn = w.find('[data-testid="welcome-clear"]')
    expect(clearBtn.exists(), '填充后应出现清空按钮').toBe(true)
    await clearBtn.trigger('click')
    await nextTick()
    expect((w.find('.welcome-input textarea').element as HTMLTextAreaElement).value).toBe('')
    expect(w.findAll('.welcome-card')[0].classes()).not.toContain('card-active')
    expect(w.find('[data-testid="welcome-clear"]').exists()).toBe(false)
  })

  it('P-E: 手动编辑输入后卡片高亮移除', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }))
    vi.stubGlobal('fetch', fetchMock)
    const w = mount(App)
    for (let i = 0; i < 10; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 20)) }

    await w.findAll('.welcome-card')[1].trigger('click')
    await nextTick()
    expect(w.findAll('.welcome-card')[1].classes()).toContain('card-active')
    await w.find('.welcome-input textarea').setValue('改成我自己的问题')
    await nextTick()
    expect(w.findAll('.welcome-card')[1].classes()).not.toContain('card-active')
  })

  it('P-E: Enter 发送 / Shift+Enter 换行不发送', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }))
    vi.stubGlobal('fetch', fetchMock)
    const w = mount(App)
    for (let i = 0; i < 10; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 20)) }
    const runs = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/agent/run'))

    const ta = w.find('.welcome-input textarea')
    await ta.setValue('第一行\n第二行')
    await ta.trigger('keydown.enter', { shiftKey: true })
    for (let i = 0; i < 6; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 10)) }
    expect(runs().length, 'Shift+Enter 不应发送').toBe(0)

    await ta.trigger('keydown.enter')
    for (let i = 0; i < 8; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 10)) }
    expect(runs().length, 'Enter 应发送').toBe(1)
    expect(String((runs()[0][1] as RequestInit)?.body ?? '')).toContain('第一行')
  })

  it('P-E: 输入框自适应高度 —— 内容矮时跟随,超过 3 行封顶并出现滚动', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }))
    vi.stubGlobal('fetch', fetchMock)
    const w = mount(App)
    for (let i = 0; i < 10; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 20)) }
    const ta = w.find('.welcome-input textarea').element as HTMLTextAreaElement

    // jsdom 无布局,模拟 scrollHeight
    Object.defineProperty(ta, 'scrollHeight', { value: 44, configurable: true })
    await w.find('.welcome-input textarea').setValue('一行')
    expect(ta.style.height).toBe('44px')
    expect(ta.style.overflowY).toBe('hidden')

    Object.defineProperty(ta, 'scrollHeight', { value: 200, configurable: true })
    await w.find('.welcome-input textarea').setValue('一\n二\n三\n四\n五')
    const h = parseInt(ta.style.height, 10)
    expect(h, '超过 3 行应封顶').toBeLessThanOrEqual(90)
    expect(h).toBeGreaterThan(44)
    expect(ta.style.overflowY).toBe('auto')
  })

  it('P-I: 断网顶栏显示离线徽章,恢复后消失', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }))
    vi.stubGlobal('fetch', fetchMock)
    const w = mount(App)
    for (let i = 0; i < 8; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 10)) }
    expect(w.find('[data-testid="offline-badge"]').exists()).toBe(false)

    window.dispatchEvent(new Event('offline'))
    await nextTick()
    expect(w.find('[data-testid="offline-badge"]').exists()).toBe(true)
    expect(w.find('[data-testid="offline-badge"]').text()).toContain('离线')

    window.dispatchEvent(new Event('online'))
    await nextTick()
    expect(w.find('[data-testid="offline-badge"]').exists()).toBe(false)
  })

  it('P-I: 离线期间 run 中断 → 网络恢复后自动续跑(自动重发最后一条用户消息)', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }))
    vi.stubGlobal('fetch', fetchMock)
    const w = mount(App)
    for (let i = 0; i < 10; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 15)) }

    // 先断网,再发消息(run 必然失败,且失败发生在离线态)
    window.dispatchEvent(new Event('offline'))
    await nextTick()
    await w.find('.welcome-input textarea').setValue('分析离线销售')
    await w.find('.welcome-send').trigger('click')
    for (let i = 0; i < 10; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 15)) }
    const runs = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/agent/run'))
    expect(runs().length).toBe(1)
    expect(w.find('[data-testid="run-error-card"]').exists()).toBe(true)

    // 网络恢复 → 自动续跑
    window.dispatchEvent(new Event('online'))
    for (let i = 0; i < 10; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 15)) }
    expect(runs().length, '恢复在线后应自动重发').toBe(2)
    expect(String((runs()[1][1] as RequestInit)?.body ?? '')).toContain('分析离线销售')
    expect(w.find('.toast-stack').text()).toContain('网络已恢复')
    expect(w.find('[data-testid="offline-badge"]').exists()).toBe(false)
  })

  it('P-I: 在线时的普通失败不触发自动续跑(仅手动重试)', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }))
    vi.stubGlobal('fetch', fetchMock)
    const w = mount(App)
    for (let i = 0; i < 10; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 15)) }

    await w.find('.welcome-input textarea').setValue('普通问题')
    await w.find('.welcome-send').trigger('click')
    for (let i = 0; i < 10; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 15)) }
    const runs = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/agent/run'))
    expect(runs().length).toBe(1)
    expect(w.find('[data-testid="run-error-card"]').exists()).toBe(true)

    // 在线→离线→在线一轮,不应自动重发(失败时是在线的)
    window.dispatchEvent(new Event('offline'))
    await nextTick()
    window.dispatchEvent(new Event('online'))
    for (let i = 0; i < 8; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 10)) }
    expect(runs().length).toBe(1)
  })
})

describe('App P-O（全局快捷键）', () => {
  it('Ctrl+K 聚焦会话搜索框(自动展开侧边栏+切到会话 Tab)', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }))
    vi.stubGlobal('fetch', fetchMock)
    const w = mount(App, { attachTo: document.body })
    for (let i = 0; i < 10; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 15)) }

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true }))
    for (let i = 0; i < 4; i++) await nextTick()
    const search = w.find('[data-testid="thread-search"]')
    expect(search.exists()).toBe(true)
    expect(document.activeElement).toBe(search.element)
    w.unmount()
  })

  it('Ctrl+N 新建会话(调 POST /chat/threads)', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }))
    vi.stubGlobal('fetch', fetchMock)
    const w = mount(App, { attachTo: document.body })
    for (let i = 0; i < 10; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 15)) }

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, cancelable: true }))
    for (let i = 0; i < 6; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 10)) }
    expect(
      fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/chat/threads') && init?.method === 'POST'),
      'Ctrl+N 应新建会话',
    ).toBe(true)
    w.unmount()
  })
})

describe('App P-Q（会话分叉）', () => {
  it('顶栏分支入口 → 弹窗选消息 → POST branch → 切换新会话 + toast', async () => {
    const fetchMock = vi.fn(async (input: any, init?: any) => {
      const url = String(input)
      if (url.includes('/branch')) {
        return { ok: true, json: async () => ({ data: { id: JSON.parse(init.body).newThreadId, title: '⑂ 新会话', sessionId: null, branchedFrom: { threadId: 'x', messageId: 'u1' } } }) }
      }
      return { ok: true, json: async () => ({ data: [] }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const w = mount(App, { attachTo: document.body })
    for (let i = 0; i < 10; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 15)) }

    // 无消息时入口禁用
    expect((w.find('[data-testid="branch-open"]').element as HTMLButtonElement).disabled).toBe(true)

    // 发一条消息(run 会失败,但用户消息留在 clone 里)
    await w.find('.welcome-input textarea').setValue('分析本月销售')
    await w.find('.welcome-send').trigger('click')
    for (let i = 0; i < 10; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 15)) }

    const openBtn = w.find('[data-testid="branch-open"]').element as HTMLButtonElement
    expect(openBtn.disabled).toBe(false)
    await w.find('[data-testid="branch-open"]').trigger('click')
    await nextTick()

    const dlg = document.body.querySelector('[data-testid="branch-dialog"]')
    expect(dlg, '分支弹窗应打开').toBeTruthy()
    expect(dlg!.textContent).toContain('分析本月销售')

    const item = dlg!.querySelector('.br-item') as HTMLButtonElement
    const msgId = item.getAttribute('data-testid')!.replace('branch-at-', '')
    item.click()
    for (let i = 0; i < 8; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 10)) }

    const branchCall = fetchMock.mock.calls.find(([url, init]) => String(url).includes('/branch') && init?.method === 'POST')
    expect(branchCall, '应调 branch API').toBeDefined()
    const body = JSON.parse(String(branchCall![1].body))
    expect(body.messageId).toBe(msgId)
    expect(body.newThreadId).toBeTruthy()
    expect(w.find('.toast-stack').text()).toContain('已创建分支')
    // 弹窗关闭
    expect(document.body.querySelector('[data-testid="branch-dialog"]')).toBeNull()
    w.unmount()
  })
})

describe('App P-R（切换会话骨架屏）', () => {
  it('切换会话时消息区显示 shimmer 骨架,历史加载完成后消失', async () => {
    const t1 = { id: 't-1', title: '会话一', sessionId: null, createdAt: '', updatedAt: '2026-08-15T01:00:00Z' }
    const t2 = { id: 't-2', title: '会话二', sessionId: null, createdAt: '', updatedAt: '2026-08-15T02:00:00Z' }
    let releaseMessages!: () => void
    const fetchMock = vi.fn(async (input: any) => {
      const url = String(input)
      // t1 排最前 → init 落在 t1(其 messages 秒回);t2 的 messages 挂起模拟加载中
      if (url.endsWith('/chat/threads')) return { ok: true, json: async () => ({ data: [t1, t2] }) }
      if (url.includes('/t-2/messages')) {
        await new Promise<void>((r) => { releaseMessages = r })
        return { ok: true, json: async () => ({ data: [{ id: 'u1', role: 'user', content: '历史消息' }] }) }
      }
      return { ok: true, json: async () => ({ data: [] }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const w = mount(App, { attachTo: document.body })
    for (let i = 0; i < 10; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 15)) }

    // 切到 t-2(消息请求被挂起)
    await w.find('[data-thread-id="t-2"]').trigger('click')
    for (let i = 0; i < 4; i++) await nextTick()
    expect(w.find('[data-testid="thread-skeleton"]').exists(), '加载中应显示骨架').toBe(true)

    releaseMessages()
    for (let i = 0; i < 8; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 10)) }
    expect(w.find('[data-testid="thread-skeleton"]').exists(), '加载完成后骨架消失').toBe(false)
    w.unmount()
  })
})
