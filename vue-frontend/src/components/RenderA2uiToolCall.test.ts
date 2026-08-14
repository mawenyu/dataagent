import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { CopilotKitProvider, useCopilotKit } from '@copilotkit/vue'
import { HttpAgent } from '@ag-ui/client'
import RenderA2uiToolCall from './RenderA2uiToolCall.vue'

/**
 * Generative UI: render_a2ui 命名渲染器必须注册到 core.renderToolCalls,
 * 且 named renderer 优先于通配 "*"（CopilotKit 按 name 精确匹配）。
 * 渲染逻辑本身用导出的纯函数不便（组件内私有），这里通过 core 注册表 +
 * 直接调用 renderer.render 验证三种状态的输出。
 */
describe('RenderA2uiToolCall (generative UI)', () => {
  async function setup() {
    const observedCore = ref<any>()
    const Child = defineComponent({
      setup() {
        const { copilotkit } = useCopilotKit()
        observedCore.value = copilotkit.value
        return () => h(RenderA2uiToolCall)
      },
    })
    mount(CopilotKitProvider as any, {
      props: { directAgents: { default: new HttpAgent({ url: '/unused-in-test' }) } },
      slots: { default: () => h(Child) },
    })
    await new Promise((r) => setTimeout(r, 0))
    return observedCore.value
  }

  it('registers a named "render_a2ui" tool-call renderer', async () => {
    const core = await setup()
    const names = core?.renderToolCalls?.map((r: any) => r.name) ?? []
    expect(names).toContain('render_a2ui')
  })

  it('renders a generative surface card for each status', async () => {
    const core = await setup()
    const renderer = core.renderToolCalls.find((r: any) => r.name === 'render_a2ui')
    expect(renderer).toBeTruthy()
    const args = {
      surfaceId: 'sales-dashboard',
      components: [
        { component: 'MetricCard', id: 'root' },
        { component: 'BarChart', id: 'c1' },
      ],
      data: { total: 137 },
    }
    const running = renderer.render({ name: 'render_a2ui', toolCallId: 't1', args, status: 0 /* InProgress */, result: undefined })
    expect(JSON.stringify(running)).toContain('sales-dashboard')
    const complete = renderer.render({ name: 'render_a2ui', toolCallId: 't1', args, status: 2 /* Complete */, result: 'ok' })
    const html = JSON.stringify(complete)
    expect(html).toContain('MetricCard')
    expect(html).toContain('BarChart')
  })
})
