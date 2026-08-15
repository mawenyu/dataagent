import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { h, nextTick } from 'vue'
import { A2UISurfaceActivityRenderer, CopilotKitProvider } from '@copilotkit/vue'
import { HttpAgent } from '@ag-ui/client'
import { DATA_AGENT_CATALOG_ID, dataAgentCatalog } from './dataAgentCatalog'

/**
 * P14: HITL 并发 —— 同会话多张确认卡共存时的前端状态一致性。
 * 两张卡（不同 actionId）必须同时可见、各自独立派发自家 actionId。
 */
function hitlOps(sid: string, actionId: string, title: string) {
  return [
    { version: 'v0.9', createSurface: { surfaceId: sid, catalogId: DATA_AGENT_CATALOG_ID } },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: sid,
        components: [
          { component: 'Column', id: 'root', children: ['warn', 'actions'] },
          { component: 'WarningCard', id: 'warn', title, text: `${title} 的说明` },
          { component: 'Row', id: 'actions', children: ['confirm', 'cancel'] },
          {
            component: 'ActionButton', id: 'confirm', label: '确认', variant: 'primary',
            action: { event: { name: 'hitl_confirm', context: { actionId } } },
          },
          {
            component: 'ActionButton', id: 'cancel', label: '取消',
            action: { event: { name: 'hitl_cancel', context: { actionId } } },
          },
        ],
      },
    },
  ]
}

describe('P14 HITL 并发卡片（前端一致性）', () => {
  it('两张确认卡共存且各自派发正确的 actionId', async () => {
    const sseBody = 'data: {"type":"RUN_STARTED"}\n\ndata: {"type":"RUN_FINISHED"}\n\n'
    const fetchMock = vi.fn().mockResolvedValue(new Response(sseBody, {
      status: 200, headers: { 'Content-Type': 'text/event-stream' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const operations = [
      ...hitlOps('hitl-act-1', 'act-1', '删除文件A'),
      ...hitlOps('hitl-act-2', 'act-2', '删除文件B'),
    ]
    const agent = new HttpAgent({ url: '/unused-in-test' })
    const wrapper = mount(CopilotKitProvider as any, {
      props: { directAgents: { default: agent }, a2ui: { catalog: dataAgentCatalog, includeSchema: true } },
      slots: {
        default: () =>
          h(A2UISurfaceActivityRenderer as any, {
            activityType: 'a2ui-surface',
            content: { operations },
            message: { id: 'a2ui-p14', role: 'activity', activityType: 'a2ui-surface', content: { operations } },
            catalog: dataAgentCatalog, theme: {}, agent,
          }),
      },
    })
    await nextTick(); await nextTick(); await nextTick()

    // 双卡共存
    expect(wrapper.text()).toContain('删除文件A')
    expect(wrapper.text()).toContain('删除文件B')
    const surfaces = wrapper.findAll('[data-surface-id]')
    expect(surfaces.length).toBe(2)

    // 分别点击两张卡的"确认"：各自派发自己的 actionId
    const confirms = wrapper.findAll('button').filter((b) => b.text().includes('确认'))
    expect(confirms.length).toBe(2)

    await confirms[0].trigger('click')
    await new Promise((r) => setTimeout(r, 50))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body1 = JSON.parse((fetchMock.mock.calls[0][1] as any).body)
    const action1 = body1?.forwardedProps?.a2uiAction
    expect(JSON.stringify(action1)).toContain('act-1')

    await confirms[1].trigger('click')
    await new Promise((r) => setTimeout(r, 50))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const body2 = JSON.parse((fetchMock.mock.calls[1][1] as any).body)
    expect(JSON.stringify(body2?.forwardedProps?.a2uiAction)).toContain('act-2')

    // 点击后各自 busy（防重复），另一卡不受影响
    expect(confirms[0].attributes('disabled')).toBeDefined()
  })
})
