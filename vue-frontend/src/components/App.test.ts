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

  it('空会话显示品牌欢迎页与 3 个建议问题', async () => {
    const w = mount(App)
    for (let i = 0; i < 10; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 20)) }
    const welcome = w.find('[data-testid="welcome-screen"]')
    expect(welcome.exists()).toBe(true)
    expect(welcome.text()).toContain('DataAgent 数据分析助手')
    const cards = w.findAll('.welcome-card')
    expect(cards).toHaveLength(3)
    expect(cards[0].text()).toContain('本月销售分析')
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
})
