import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import TemplateSidebarPanel from './TemplateSidebarPanel.vue'
import { useUserTemplates } from '../composables/promptTemplates'

/**
 * 模板库 step3: 侧栏模板面板。
 * 内置场景卡组（含环比对比/异常检测/用户画像）点击填入；我的模板组
 * （localStorage 持久化，可删）；保存当前输入为模板（自绘表单，禁原生弹窗）。
 */

async function settle(n = 4) {
  for (let i = 0; i < n; i++) await nextTick()
}

describe('TemplateSidebarPanel（模板库）', () => {
  beforeEach(() => {
    // 用户模板是模块级单例（组件与测试同一实例）—— 用 API 清空而不是 resetModules
    localStorage.clear()
    const api = useUserTemplates()
    for (const t of [...api.templates.value]) api.remove(t.id)
  })

  it('默认折叠，展开后列出内置场景卡组（含新增三场景）', async () => {
    const w = mount(TemplateSidebarPanel)
    expect(w.find('[data-testid="template-sidebar-panel"]').exists()).toBe(false)
    await w.find('[data-testid="template-sidebar-toggle"]').trigger('click')
    const panel = w.find('[data-testid="template-sidebar-panel"]')
    expect(panel.exists()).toBe(true)
    const titles = panel.findAll('[data-testid="template-fill-item"] .tpl-title').map((x) => x.text())
    for (const t of ['销售分析', '环比对比', '异常检测', '用户画像', '可视化看板']) {
      expect(titles).toContain(t)
    }
    expect(w.find('[data-testid="template-sidebar-toggle"]').attributes('aria-expanded')).toBe('true')
  })

  it('点击内置模板卡 → emit fill 携带模板对象', async () => {
    const w = mount(TemplateSidebarPanel)
    await w.find('[data-testid="template-sidebar-toggle"]').trigger('click')
    const card = w.findAll('[data-testid="template-fill-item"]').find((x) => x.text().includes('环比对比'))!
    await card.trigger('click')
    const events = w.emitted('fill')
    expect(events).toHaveLength(1)
    const t = (events![0][0] as { title: string; prompt: string })
    expect(t.title).toBe('环比对比')
    expect(t.prompt).toContain('环比')
  })

  it('保存当前输入为模板：表单预填 draftPrompt，保存后出现在我的模板并持久化', async () => {
    const w = mount(TemplateSidebarPanel, { props: { draftPrompt: '分析复购率并分层' } })
    await w.find('[data-testid="template-sidebar-toggle"]').trigger('click')
    await w.find('[data-testid="template-save-open"]').trigger('click')
    const prompt = w.find('[data-testid="template-save-prompt"]')
    expect((prompt.element as HTMLTextAreaElement).value).toBe('分析复购率并分层')
    await w.find('[data-testid="template-save-title"]').setValue('复购分层')
    await w.find('[data-testid="template-save-submit"]').trigger('click')
    await settle()
    // 我的模板组出现
    const mine = w.findAll('[data-testid="template-mine-item"]')
    expect(mine.map((x) => x.text()).join()).toContain('复购分层')
    // localStorage 持久化
    const raw = JSON.parse(localStorage.getItem('dataagent.user-templates.v1') ?? '[]')
    expect(raw[0].title).toBe('复购分层')
    // 表单关闭
    expect(w.find('[data-testid="template-save-form"]').exists()).toBe(false)
  })

  it('空标题保存 → 内联报错，不写 localStorage', async () => {
    const w = mount(TemplateSidebarPanel, { props: { draftPrompt: 'p' } })
    await w.find('[data-testid="template-sidebar-toggle"]').trigger('click')
    await w.find('[data-testid="template-save-open"]').trigger('click')
    await w.find('[data-testid="template-save-submit"]').trigger('click')
    await settle()
    expect(w.find('[data-testid="template-save-error"]').text()).toContain('标题')
    // 未写入任何用户模板（beforeEach 清理落盘 '[]' 或从未写 null 均合法）
    expect(JSON.parse(localStorage.getItem('dataagent.user-templates.v1') ?? '[]')).toHaveLength(0)
  })

  it('我的模板可填入也可删除；删除后 localStorage 同步', async () => {
    useUserTemplates().save({ title: '我的月报', prompt: 'monthly…' })
    const w = mount(TemplateSidebarPanel)
    await w.find('[data-testid="template-sidebar-toggle"]').trigger('click')
    const item = w.find('[data-testid="template-mine-item"]')
    expect(item.text()).toContain('我的月报')
    // 填入
    await item.trigger('click')
    expect(w.emitted('fill')![0][0]).toMatchObject({ title: '我的月报', prompt: 'monthly…' })
    // 删除（不触发 fill）
    await item.find('[data-testid="template-delete"]').trigger('click')
    await settle()
    expect(w.find('[data-testid="template-mine-item"]').exists()).toBe(false)
    expect(JSON.parse(localStorage.getItem('dataagent.user-templates.v1') ?? '[]')).toHaveLength(0)
    expect(w.emitted('fill')).toHaveLength(1)
  })

  it('我的模板为空时显示空态提示', async () => {
    const w = mount(TemplateSidebarPanel)
    await w.find('[data-testid="template-sidebar-toggle"]').trigger('click')
    expect(w.find('[data-testid="template-mine-empty"]').exists()).toBe(true)
  })
})
