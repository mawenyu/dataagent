import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import A2uiRefCard from './A2uiRefCard.vue'

/**
 * 布局分栏：对话栏内的紧凑引用卡（A2UI 产物挪到中央工作区后，对话流里
 * 只留这张卡；点击 → 中央区定位对应 surface 块）。
 */
describe('A2uiRefCard', () => {
  it('显示 surface 数/组件数与首个 surfaceId', () => {
    const wrapper = mount(A2uiRefCard, {
      props: { messageId: 'm1', surfaceIds: ['dash-1', 'panel-2'], componentCount: 5 },
    })
    const card = wrapper.find('[data-testid="a2ui-ref-card"]')
    expect(card.exists()).toBe(true)
    expect(card.text()).toContain('dash-1')
    expect(card.text()).toContain('2 个 surface')
    expect(card.text()).toContain('5 个组件')
  })

  it('点击 emit locate(messageId)', async () => {
    const wrapper = mount(A2uiRefCard, {
      props: { messageId: 'm42', surfaceIds: ['s'], componentCount: 1 },
    })
    await wrapper.find('[data-testid="a2ui-ref-card"]').trigger('click')
    expect(wrapper.emitted('locate')).toEqual([['m42']])
  })

  it('键盘 Enter 也触发 locate（a11y）', async () => {
    const wrapper = mount(A2uiRefCard, {
      props: { messageId: 'm7', surfaceIds: ['s'], componentCount: 1 },
    })
    await wrapper.find('[data-testid="a2ui-ref-card"]').trigger('keydown.enter')
    expect(wrapper.emitted('locate')).toEqual([['m7']])
  })
})
