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
})
