import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'

/**
 * 布局分栏（P 布局）：宽屏 = 右侧窄对话栏 + 中央 A2UI 工作区；
 * 窄屏（<1024px）退化单栏、A2UI 仍在对话流内联渲染。
 * fork 的 createA2UIMessageRenderer 打桩（渲染管线非本测试目标）。
 */
vi.mock('@copilotkit/vue', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    createA2UIMessageRenderer: () => ({
      activityType: 'a2ui-surface',
      content: { parse: () => ({}), safeParse: (v: unknown) => ({ success: true, data: v }) },
      render: defineComponent({
        name: 'A2uiStub',
        props: { message: { type: Object, required: true } },
        setup(props) {
          return () => h('div', { 'data-testid': 'a2ui-inline-stub' }, `surface-of-${props.message.id}`)
        },
      }),
    }),
  }
})

import App from '../App.vue'
import { dataAgent } from '../agents/dataAgent'
import { getThreadClone } from '@copilotkit/vue'

async function settle(n = 12, ms = 15) {
  for (let i = 0; i < n; i++) { await nextTick(); await new Promise((r) => setTimeout(r, ms)) }
}

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) })))
}

/** 发一条消息建立会话，然后往当前 thread clone 注入一条 a2ui-surface activity 消息。 */
async function seedA2uiMessage(w: ReturnType<typeof mount>, id = 'a2ui-m1') {
  await w.find('.welcome-input textarea').setValue('画个看板')
  await w.find('.welcome-send').trigger('click')
  await settle()
  const cache = JSON.parse(localStorage.getItem('dataagent.threads') ?? '{}')
  const tid = cache.currentId as string
  expect(tid, '应已建立当前会话').toBeTruthy()
  const clone = getThreadClone(dataAgent as never, tid) as { addMessage: (m: unknown) => void } | undefined
  expect(clone, 'thread clone 应存在').toBeTruthy()
  clone!.addMessage({
    id,
    role: 'activity',
    activityType: 'a2ui-surface',
    content: { a2ui_operations: [{ createSurface: { surfaceId: 'dash-1' } }, { updateComponents: { surfaceId: 'dash-1', components: [{ id: 'c1' }] } }] },
  })
  await settle()
  return tid
}

describe('App 布局分栏（A2UI 工作区）', () => {
  beforeEach(() => {
    localStorage.clear()
    stubFetch()
  })

  it('宽屏：A2UI 消息 → 中央工作区出现 + 对话栏只留引用卡', async () => {
    const w = mount(App, { attachTo: document.body })
    await settle()
    await seedA2uiMessage(w)
    // 中央工作区出现且含对应块
    const shell = w.find('[data-testid="a2ui-workspace-shell"]')
    expect(shell.exists(), '宽屏有 A2UI 产物时中央工作区应出现').toBe(true)
    expect(w.find('[data-testid="a2ui-workspace-block"]').attributes('data-message-id')).toBe('a2ui-m1')
    // 对话栏：引用卡 + 无内联 surface
    expect(w.find('[data-testid="a2ui-ref-card"]').exists()).toBe(true)
    expect(w.find('.chat-col [data-testid="a2ui-inline-stub"]').exists()).toBe(false)
    w.unmount()
  })

  it('宽屏：无 A2UI 产物时中央工作区不出现（对话栏占满）', async () => {
    const w = mount(App, { attachTo: document.body })
    await settle()
    expect(w.find('[data-testid="a2ui-workspace-shell"]').exists()).toBe(false)
    w.unmount()
  })

  it('宽屏：点击引用卡 → 中央区对应块定位高亮', async () => {
    const w = mount(App, { attachTo: document.body })
    await settle()
    await seedA2uiMessage(w)
    const block = w.find('[data-testid="a2ui-workspace-block"]')
    ;(block.element as HTMLElement).scrollIntoView = vi.fn()
    await w.find('[data-testid="a2ui-ref-card"]').trigger('click')
    await flushPromises()
    expect((block.element as HTMLElement).scrollIntoView).toHaveBeenCalled()
    expect(block.classes()).toContain('a2ui-block-flash')
    w.unmount()
  })

  it('窄屏（<1024px）：退化单栏，A2UI 回到对话流内联渲染', async () => {
    const originalMatchMedia = window.matchMedia
    window.matchMedia = ((query: string) => ({
      matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
    try {
      const w = mount(App, { attachTo: document.body })
      await settle()
      await seedA2uiMessage(w)
      expect(w.find('[data-testid="a2ui-workspace-shell"]').exists()).toBe(false)
      expect(w.find('[data-testid="a2ui-ref-card"]').exists()).toBe(false)
      expect(w.find('[data-testid="a2ui-inline-stub"]').exists()).toBe(true) // 内联渲染回来
      w.unmount()
    } finally {
      window.matchMedia = originalMatchMedia
    }
  })
})
