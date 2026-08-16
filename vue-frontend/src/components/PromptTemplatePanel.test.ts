import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import PromptTemplatePanel from './PromptTemplatePanel.vue'
import { templatesByGroup } from '../composables/promptTemplates'

/** P-b: 快捷指令面板 —— 分组渲染、select/close 语义、Esc 关闭。 */
describe('PromptTemplatePanel (P-b)', () => {
  function mountPanel(open = true) {
    return mount(PromptTemplatePanel, {
      props: { open },
      global: { stubs: { Teleport: true } },
    })
  }

  it('open=false 不渲染面板', () => {
    const w = mountPanel(false)
    expect(w.find('[data-testid="template-panel"]').exists()).toBe(false)
  })

  it('按组渲染全部模板项, data-testid 携带模板 id', () => {
    const w = mountPanel()
    expect(w.find('[data-testid="template-panel"]').exists()).toBe(true)
    for (const t of [...templatesByGroup('开场'), ...templatesByGroup('追问')]) {
      expect(w.find(`[data-testid="template-item-${t.id}"]`).exists(), t.id).toBe(true)
    }
    // 组标题
    const groupNames = w.findAll('.tpl-group-name').map((n) => n.text())
    expect(groupNames).toContain('开场模板')
    expect(groupNames).toContain('追问指令')
  })

  it('点击模板项 emit select(携带模板对象)', async () => {
    const w = mountPanel()
    await w.find('[data-testid="template-item-fu-summary"]').trigger('click')
    const ev = w.emitted('select')
    expect(ev).toBeTruthy()
    expect((ev![0][0] as { id: string }).id).toBe('fu-summary')
    expect((ev![0][0] as { prompt: string }).prompt).toContain('一句话总结')
  })

  it('关闭按钮与遮罩 emit close', async () => {
    const w = mountPanel()
    await w.find('[data-testid="template-close"]').trigger('click')
    expect(w.emitted('close')).toBeTruthy()
    const w2 = mountPanel()
    await w2.find('[data-testid="template-backdrop"]').trigger('click')
    expect(w2.emitted('close')).toBeTruthy()
  })

  it('Esc 关闭面板', async () => {
    const w = mountPanel()
    await w.find('[data-testid="template-panel"]').trigger('keydown.esc')
    expect(w.emitted('close')).toBeTruthy()
  })
})
