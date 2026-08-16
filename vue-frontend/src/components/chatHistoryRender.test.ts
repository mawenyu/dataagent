import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { h, nextTick } from 'vue'
import { CopilotKitProvider, CopilotChat, getThreadClone } from '@copilotkit/vue'
import { HttpAgent } from '@ag-ui/client'
import { dataAgentCatalog } from '../a2ui/dataAgentCatalog'

/**
 * 需求1 补充验证（用户重申）：切换会话时历史消息不只是后端存着，
 * 而是真的渲染到聊天 DOM。
 *
 * 真实链路：CopilotChat 渲染的是 useAgent 按 threadId 克隆的 agent 副本，
 * 所以历史必须写进 per-thread clone（getThreadClone —— App 的
 * useThreads.switchTo 正是这么做的）。本测试用真实 CopilotKitProvider +
 * CopilotChat 组件验证端到端渲染。
 */
/** 轮询等待文本出现 —— FORK#19 起 assistant/reasoning 经 defineAsyncComponent
 * 懒加载 streamdown-vue，渲染完成跨越动态 import，需要真实等待而非固定 tick。 */
async function waitForText(w: { text: () => string }, s: string, timeoutMs = 3000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    await nextTick()
    if (w.text().includes(s)) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error(`timeout waiting for rendered text: ${s}`)
}

describe('切换会话历史渲染（需求1 用户重申）', () => {
  it('写入 per-thread clone 的历史消息渲染到 CopilotChat DOM', async () => {
    const agent = new HttpAgent({ url: '/unused-in-test' })

    const w = mount(CopilotKitProvider as any, {
      props: {
        directAgents: { default: agent },
        a2ui: { catalog: dataAgentCatalog, includeSchema: false },
      },
      slots: {
        default: () => h(CopilotChat as any, {
          agentId: 'default',
          threadId: 'thread-hist-1',
          welcomeScreen: false,
        }),
      },
    })

    // 等 useAgent 创建 per-thread clone
    for (let i = 0; i < 5; i++) await nextTick()

    // 模拟 useThreads.switchTo：历史写入 CopilotChat 实际渲染的 clone
    const clone = getThreadClone(agent, 'thread-hist-1')
    expect(clone, 'per-thread clone must exist').toBeTruthy()
    clone!.setMessages([
      { id: 'u1', role: 'user', content: '暗号甲：红枫77' },
      { id: 'a1-r1', role: 'reasoning', content: '用户给了暗号，记住即可' } as any,
      { id: 'a1', role: 'assistant', content: '收到，已记住暗号' },
    ])
    for (let i = 0; i < 5; i++) await nextTick()

    const text = w.text()
    expect(text).toContain('暗号甲：红枫77')
    // assistant / reasoning 走懒加载的 StreamMarkdown（FORK#19），等其真正落地
    await waitForText(w, '收到，已记住暗号')
    await waitForText(w, '用户给了暗号，记住即可')
  })
})
