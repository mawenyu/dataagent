import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import App from '../App.vue'
import { useUserTemplates } from '../composables/promptTemplates'

/**
 * 模板库 step3: App 集成 —— 侧栏模板面板 → 主输入框填入通道（零 fork 改动）。
 * 链路: 面板 fill → App.mainInputText → CopilotChat inputValue prop → fork 内部 watch 同步,
 * 欢迎页 textarea 与主输入框同源(槽 modelValue 即 resolvedInputValue)。
 */

async function settle(n = 10) {
  for (let i = 0; i < n; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 15)) }
}

describe('App 模板库集成 (侧栏模板面板 → 输入框填入)', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
      arrayBuffer: async () => new TextEncoder().encode('a,b\n1,2').buffer,
    })))
    // 用户模板是模块级单例 —— 用 API 清空而不是 resetModules
    const api = useUserTemplates()
    for (const t of [...api.templates.value]) api.remove(t.id)
  })
  afterEach(() => { document.body.innerHTML = '' })

  it('展开侧栏模板面板,点击「环比对比」→ 欢迎页输入框填入模板文本', async () => {
    const w = mount(App)
    await settle()
    expect(w.find('[data-testid="template-sidebar"]').exists(), '侧栏应有模板面板').toBe(true)
    await w.find('[data-testid="template-sidebar-toggle"]').trigger('click')
    const card = w.findAll('[data-testid="template-fill-item"]').find((x) => x.text().includes('环比对比'))!
    await card.trigger('click')
    await settle(4)
    const ta = w.find('.welcome-input-row textarea').element as HTMLTextAreaElement
    expect(ta.value, '欢迎页输入框应填入模板').toContain('环比')
    w.unmount()
  })

  it('输入框已有草稿时,模板保存表单预填草稿;保存后出现在「我的模板」并持久化', async () => {
    const w = mount(App)
    await settle()
    // 在欢迎页输入草稿(经 fork input-change 回流 mainInputText)
    const ta = w.find('.welcome-input-row textarea')
    await ta.setValue('分析复购率并分层')
    await settle(4)
    // 打开保存表单 → prompt 预填草稿
    await w.find('[data-testid="template-sidebar-toggle"]').trigger('click')
    await w.find('[data-testid="template-save-open"]').trigger('click')
    expect((w.find('[data-testid="template-save-prompt"]').element as HTMLTextAreaElement).value)
      .toBe('分析复购率并分层')
    await w.find('[data-testid="template-save-title"]').setValue('复购分层')
    await w.find('[data-testid="template-save-submit"]').trigger('click')
    await settle(4)
    // 我的模板出现 + localStorage 持久化
    expect(w.findAll('[data-testid="template-mine-item"]').map((x) => x.text()).join()).toContain('复购分层')
    const raw = JSON.parse(localStorage.getItem('dataagent.user-templates.v1') ?? '[]')
    expect(raw).toHaveLength(1)
    expect(raw[0].title).toBe('复购分层')
    w.unmount()
  })

  it('点击「我的模板」→ 填入输入框;删除后列表与 localStorage 同步清空', async () => {
    useUserTemplates().save({ title: '我的月报', prompt: '汇总本月数据并对比上月' })
    const w = mount(App)
    await settle()
    await w.find('[data-testid="template-sidebar-toggle"]').trigger('click')
    const item = w.find('[data-testid="template-mine-item"]')
    await item.trigger('click')
    await settle(4)
    expect((w.find('.welcome-input-row textarea').element as HTMLTextAreaElement).value)
      .toBe('汇总本月数据并对比上月')
    await w.find('[data-testid="template-delete"]').trigger('click')
    await settle(4)
    expect(w.find('[data-testid="template-mine-item"]').exists()).toBe(false)
    expect(JSON.parse(localStorage.getItem('dataagent.user-templates.v1') ?? '[]')).toHaveLength(0)
    w.unmount()
  })
})
