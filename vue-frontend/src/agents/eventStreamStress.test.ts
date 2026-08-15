import { describe, expect, it, vi } from 'vitest'
import { HttpAgent } from '@ag-ui/client'

/**
 * P16: 前端事件流压测 —— 1000+ AG-UI 事件经真实 HttpAgent 消费
 * （SSE 分片边界 + token 流 + 多工具交错），断言消息内容顺序一致、
 * 工具调用完整、重复 run 无订阅泄漏。
 * 对应 docs/perf/event-stream-stress.md。
 */

function buildAguiStream(deltas: number, tools: number): string {
  const lines: string[] = []
  const ev = (o: any) => lines.push(`data: ${JSON.stringify(o)}\n`)
  ev({ type: 'RUN_STARTED', threadId: 'stress', runId: 'r1' })
  ev({ type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' })
  let toolAt = 0
  for (let i = 0; i < deltas; i++) {
    ev({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: `d${i}` })
    if (i % 200 === 100 && toolAt < tools) {
      const cid = `call_${toolAt}`
      ev({ type: 'TOOL_CALL_START', toolCallId: cid, toolCallName: 'shell', parentMessageId: 'm1' })
      ev({ type: 'TOOL_CALL_ARGS', toolCallId: cid, delta: `{"command":"ls ${toolAt}"}` })
      ev({ type: 'TOOL_CALL_END', toolCallId: cid })
      ev({ type: 'TOOL_CALL_RESULT', toolCallId: cid, messageId: `tr${toolAt}`, content: `ok ${toolAt}` })
      toolAt++
    }
  }
  ev({ type: 'TEXT_MESSAGE_END', messageId: 'm1' })
  ev({ type: 'RUN_FINISHED', threadId: 'stress', runId: 'r1' })
  return lines.join('\n')
}

/** fetch mock：把 SSE 文本按任意字节切片（含跨事件边界）返回 ReadableStream。 */
function stubFetchWithStream(body: string, chunks = 17) {
  const bytes = new TextEncoder().encode(body)
  return vi.fn().mockImplementation(() => {
    const stream = new ReadableStream({
      start(controller) {
        const step = Math.ceil(bytes.length / chunks)
        for (let i = 0; i < bytes.length; i += step) {
          controller.enqueue(bytes.slice(i, i + step))
        }
        controller.close()
      },
    })
    return Promise.resolve(new Response(stream, {
      status: 200, headers: { 'Content-Type': 'text/event-stream' },
    }))
  })
}

describe('P16 前端事件流压测', () => {
  it('1000 delta + 5 工具交错 + SSE 任意分片 → 内容顺序一致、工具完整', async () => {
    vi.stubGlobal('fetch', stubFetchWithStream(buildAguiStream(1000, 5)))
    const agent = new HttpAgent({ url: '/agui-api/agent/run' })
    agent.threadId = 'stress'
    await agent.runAgent({ runId: 'r1' } as any)

    const msgs = agent.messages as any[]
    const assistant = msgs.find((m) => m.role === 'assistant')
    let expectText = ''
    for (let i = 0; i < 1000; i++) expectText += `d${i}`
    expect(assistant.content, '1000 delta 严格按序拼接').toBe(expectText)
    expect(assistant.toolCalls?.length).toBe(5)
    expect(assistant.toolCalls[0].function.name).toBe('shell')
    const toolResults = msgs.filter((m) => m.role === 'tool')
    expect(toolResults.length).toBe(5)
    expect(toolResults[4].content).toBe('ok 4')
  }, 30000)

  it('重复 20 次大流 run：无订阅累积/状态错乱', async () => {
    const fetchMock = stubFetchWithStream(buildAguiStream(200, 2))
    vi.stubGlobal('fetch', fetchMock)
    const agent = new HttpAgent({ url: '/agui-api/agent/run' })
    let subs = 0
    for (let i = 0; i < 20; i++) {
      agent.threadId = `s${i}`
      const sub = agent.subscribe({ onRunFinishedEvent: () => {} })
      subs++
      await agent.runAgent({ runId: `r${i}` } as any)
      sub.unsubscribe()
      expect(agent.messages.length).toBeGreaterThan(0)
    }
    // subscribers 数组不应随 run 累积泄漏
    const anyAgent = agent as any
    const subCount = anyAgent.subscribers?.length ?? anyAgent.subscriptions?.length ?? 0
    console.log(`[STRESS-FE] 20 runs ok; residual subscribers=${subCount}`)
    expect(subCount).toBeLessThanOrEqual(1)
  }, 60000)
})
