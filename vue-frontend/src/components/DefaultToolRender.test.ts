import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { CopilotKitProvider, useCopilotKit } from '@copilotkit/vue'
import { HttpAgent } from '@ag-ui/client'
import DefaultToolRender from './DefaultToolRender.vue'

/**
 * 需求7-3: 工具调用可见。CopilotChat 的 fallback 路径在未注册
 * renderToolCalls 时不渲染任何工具调用 —— App 通过 DefaultToolRender
 * 注册通配 "*" 渲染器（fork 内置可折叠 UI），让 agent 的
 * bash/read/render_a2ui 等工具过程（名称/参数/状态/结果）可见。
 */
describe('DefaultToolRender (需求7-3)', () => {
  it('registers a wildcard "*" tool-call renderer inside CopilotKitProvider', () => {
    const observedCore = ref<any>()

    const Child = defineComponent({
      setup() {
        const { copilotkit } = useCopilotKit()
        observedCore.value = copilotkit.value
        return () => h(DefaultToolRender)
      },
    })

    mount(CopilotKitProvider as any, {
      props: { directAgents: { default: new HttpAgent({ url: '/unused-in-test' }) } },
      slots: { default: () => h(Child) },
    })

    const names = observedCore.value?.renderToolCalls?.map((r: any) => r.name) ?? []
    expect(names, 'wildcard tool renderer must be registered').toContain('*')
  })
})
