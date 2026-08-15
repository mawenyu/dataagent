import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { h, nextTick, ref } from 'vue'
import { CopilotKitProvider, CopilotChatMessageView } from '@copilotkit/vue'
import { HttpAgent } from '@ag-ui/client'

/**
 * P11: 长会话渲染性能（docs/perf/frontend-long-chat.md）。
 * 500 条混合消息（user/assistant/含工具调用）首屏 + 流式追加重渲染耗时。
 * jsdom 数字为相对上界；真实浏览器数字经画廊 longchat 页测量。
 *
 * before/after 对比锚点：fork CopilotChatMessageView v-memo 优化。
 */

interface Msg { id: string; role: string; content: any; toolCalls?: any[] }

function makeMessages(n: number): Msg[] {
  const out: Msg[] = []
  for (let i = 0; i < n; i++) {
    if (i % 5 === 4) {
      // 每 5 条塞一个带工具调用的 assistant + tool 结果（工具卡渲染路径）
      out.push({
        id: `a${i}`, role: 'assistant', content: `分析结论 ${i}`,
        toolCalls: [{ id: `call_${i}`, type: 'function', function: { name: 'shell', arguments: `{"command":"ls ${i}"}` } }],
      })
      out.push({ id: `t${i}`, role: 'tool', toolCallId: `call_${i}`, content: `file-${i}.csv 结果` } as any)
    } else {
      out.push({
        id: `m${i}`,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `第 ${i} 条消息内容，包含一段正常长度的中文文本用于模拟真实会话消息体积。`,
      })
    }
  }
  return out
}

function mountMessages(messages: Msg[]) {
  const msgsRef = ref<Msg[]>(messages)
  const agent = new HttpAgent({ url: '/unused-in-test' })
  const wrapper = mount(CopilotKitProvider as any, {
    props: { runtimeUrl: '/unused' },
    slots: {
      default: () => h(CopilotChatMessageView as any, {
        messages: msgsRef.value,
        isRunning: true,
      }),
    },
  })
  return {
    wrapper,
    async pushDelta(mutate: (msgs: Msg[]) => void) {
      const next = [...msgsRef.value]
      mutate(next)
      msgsRef.value = next
      await nextTick(); await nextTick()
    },
  }
}

describe('P11 长会话渲染性能（500+ 消息）', () => {
  it('500 条混合消息首屏渲染', async () => {
    const t0 = performance.now()
    const { wrapper } = mountMessages(makeMessages(500))
    await nextTick(); await nextTick()
    const ms = performance.now() - t0
    console.log(`[PERF-P11] 500 消息首屏（jsdom）: ${ms.toFixed(1)}ms`)
    expect(wrapper.text()).toContain('第 498 条消息')
    expect(ms).toBeLessThan(30000)
  }, 60000)

  it('流式 delta 重渲染（活动消息内容增长，列表长度不变）', async () => {
    const { pushDelta } = mountMessages(makeMessages(500))
    // 模拟 20 次流式 delta：只改最后一条 assistant 的内容
    const t0 = performance.now()
    for (let i = 0; i < 20; i++) {
      await pushDelta((msgs) => {
        const last = msgs[msgs.length - 2] // 最后是 tool 消息，-2 是 assistant
        msgs[msgs.length - 2] = { ...last, content: (last.content as string) + '▌' }
      })
    }
    const ms = performance.now() - t0
    console.log(`[PERF-P11] 20 次流式 delta 重渲染（jsdom）: ${ms.toFixed(1)}ms（${(ms / 20).toFixed(1)}ms/tick）`)
    expect(ms).toBeLessThan(30000)
  }, 60000)

  it('追加新消息（列表长度 +1）', async () => {
    const { pushDelta } = mountMessages(makeMessages(500))
    const t0 = performance.now()
    await pushDelta((msgs) => {
      msgs.push({ id: 'm-new', role: 'user', content: '新消息追加' })
    })
    const ms = performance.now() - t0
    console.log(`[PERF-P11] 追加 1 条消息重渲染（jsdom）: ${ms.toFixed(1)}ms`)
    expect(ms).toBeLessThan(10000)
  }, 60000)
})
