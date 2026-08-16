import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

/**
 * 布局分栏：中央 A2UI 工作区。fork 的 createA2UIMessageRenderer 打桩为
 * 轻量 div（真渲染链路在 fork 侧有自己的测试与公网实测覆盖）。
 */
const renderCalls: Array<{ messageId: string }> = []
vi.mock('@copilotkit/vue', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    createA2UIMessageRenderer: () => ({
      activityType: 'a2ui-surface',
      content: {},
      render: defineComponent({
        name: 'A2uiStub',
        props: { message: { type: Object, required: true } },
        setup(props) {
          renderCalls.push({ messageId: props.message.id })
          return () => h('div', { 'data-testid': 'a2ui-stub' }, `surface-of-${props.message.id}`)
        },
      }),
    }),
  }
})

import A2uiWorkspace from './A2uiWorkspace.vue'

function a2uiMsg(id: string, ops: unknown[] = [{ createSurface: { surfaceId: `s-${id}` } }]) {
  return { id, role: 'activity', activityType: 'a2ui-surface', content: { a2ui_operations: ops } }
}

describe('A2uiWorkspace', () => {
  it('每条 a2ui-surface 消息渲染一个块，并传给 fork 渲染器', async () => {
    renderCalls.length = 0
    const wrapper = mount(A2uiWorkspace, {
      props: { entries: [{ message: a2uiMsg('m1') }, { message: a2uiMsg('m2') }] },
    })
    await flushPromises()
    const blocks = wrapper.findAll('[data-testid="a2ui-workspace-block"]')
    expect(blocks).toHaveLength(2)
    expect(blocks[0].attributes('data-message-id')).toBe('m1')
    expect(renderCalls.map((c) => c.messageId)).toEqual(['m1', 'm2'])
    expect(wrapper.text()).toContain('s-m1')
  })

  it('空态：无产物时显示占位', () => {
    const wrapper = mount(A2uiWorkspace, { props: { entries: [] } })
    expect(wrapper.find('[data-testid="a2ui-workspace-empty"]').exists()).toBe(true)
  })

  it('locate(messageId) 滚动到对应块并加高亮类', async () => {
    const scrollIntoView = vi.fn()
    const wrapper = mount(A2uiWorkspace, {
      props: { entries: [{ message: a2uiMsg('m1') }, { message: a2uiMsg('m2') }] },
      attachTo: document.body,
    })
    await flushPromises()
    const el = wrapper.find('[data-message-id="m2"]').element as HTMLElement
    el.scrollIntoView = scrollIntoView
    ;(wrapper.vm as unknown as { locate: (id: string) => void }).locate('m2')
    await flushPromises()
    expect(scrollIntoView).toHaveBeenCalled()
    expect(wrapper.find('[data-message-id="m2"]').classes()).toContain('a2ui-block-flash')
    wrapper.unmount()
  })

  it('locate 不存在的 id 不炸', () => {
    const wrapper = mount(A2uiWorkspace, { props: { entries: [] } })
    expect(() => (wrapper.vm as unknown as { locate: (id: string) => void }).locate('nope')).not.toThrow()
  })
})
