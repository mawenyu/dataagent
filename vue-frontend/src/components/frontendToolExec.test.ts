import { describe, expect, it, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { h, nextTick } from 'vue'
import { CopilotKitProvider, CopilotChat } from '@copilotkit/vue'
import { HttpAgent } from '@ag-ui/client'
import { z } from 'zod'

/**
 * 2026-08-16 线上实测回归（spreadsheetEdits 确认 modal 不弹）。
 *
 * 现场事件序（gateway 伪 <tool_call> 纯标记消息路径）：
 *   RUN_STARTED → STATE_SNAPSHOT → STEP_STARTED
 *   → TOOL_CALL_START/ARGS/END（parentMessageId 指向一个从未
 *     TEXT_MESSAGE_START 的消息 —— 纯标记消息全程 BUFFERING，文本未开张）
 *   → STEP_FINISHED → MESSAGES_SNAPSHOT（内含 opencode 历史里的
 *     原始 <tool_call> 文本消息）→ RUN_FINISHED
 *
 * 结果：浏览器从不执行 frontend tool handler → 确认 modal 不出现，
 * HITL 链路断裂；MESSAGES_SNAPSHOT 还把裸 <tool_call> 标记渲染成可见文本。
 *
 * 本测试用真实 HttpAgent + CopilotKitProvider + CopilotChat + 打桩 fetch
 * 复现该字节流，隔离定位是「悬空 parentMessageId」还是「SNAPSHOT 冲刷」。
 */

const sse = (obj: Record<string, unknown>) => `data:${JSON.stringify(obj)}\n\n`

function sseResponse(events: Record<string, unknown>[]): Response {
  const body = events.map(sse).join('')
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

interface SeqOpts {
  wrapTextMessage?: boolean   // TOOL_CALL 前后补 TEXT_MESSAGE_START/END（候选修复）
  includeSnapshot?: boolean   // 末尾是否带 MESSAGES_SNAPSHOT
  snapshotWithToolCalls?: boolean // 快照内 assistant 消息把标记转成 toolCalls（候选修复）
}

function gatewaySequence(opts: SeqOpts): Record<string, unknown>[] {
  const marker =
    '<tool_call>{"name":"applySpreadsheetEdits","arguments":{"file":"sales.csv","cells":[{"row":1,"col":5,"value":"999999"}]}}</tool_call>'
  const ev: Record<string, unknown>[] = [
    { type: 'RUN_STARTED', threadId: 't1', runId: 'r1', timestamp: 1 },
    {
      type: 'STATE_SNAPSHOT',
      threadId: 't1',
      runId: 'r1',
      timestamp: 1,
      snapshot: { contextSize: 0, threadId: 't1', provider: 'deepseek', workspace: 'workspace', model: 'deepseek-reasoner' },
    },
    { type: 'STEP_STARTED', threadId: 't1', runId: 'r1', timestamp: 2, stepName: 'step-m1' },
  ]
  if (opts.wrapTextMessage) {
    ev.push({ type: 'TEXT_MESSAGE_START', threadId: 't1', runId: 'r1', timestamp: 3, messageId: 'ag-m1', role: 'assistant' })
  }
  ev.push(
    {
      type: 'TOOL_CALL_START', threadId: 't1', runId: 'r1', timestamp: 4,
      toolCallId: 'call_x', toolCallName: 'applySpreadsheetEdits', parentMessageId: 'ag-m1',
    },
    {
      type: 'TOOL_CALL_ARGS', threadId: 't1', runId: 'r1', timestamp: 5,
      toolCallId: 'call_x',
      delta: '{"file":"sales.csv","cells":[{"row":1,"col":5,"value":"999999"}],"summary":"改销售额"}',
    },
    { type: 'TOOL_CALL_END', threadId: 't1', runId: 'r1', timestamp: 6, toolCallId: 'call_x' },
  )
  if (opts.wrapTextMessage) {
    ev.push({ type: 'TEXT_MESSAGE_END', threadId: 't1', runId: 'r1', timestamp: 7, messageId: 'ag-m1' })
  }
  ev.push({ type: 'STEP_FINISHED', threadId: 't1', runId: 'r1', timestamp: 8, stepName: 'step-m1' })
  if (opts.includeSnapshot) {
    const assistantMsg: Record<string, unknown> = opts.snapshotWithToolCalls
      ? {
          id: 'm1', role: 'assistant', content: '',
          toolCalls: [{
            // 快照由 gateway 历史转换生成，id 与流式 TOOL_CALL_START 的
            // toolCallId 不同源（opencode 历史里没有 gateway 生成的 id）
            id: 'histcall-m1', type: 'function',
            function: {
              name: 'applySpreadsheetEdits',
              arguments: '{"file":"sales.csv","cells":[{"row":1,"col":5,"value":"999999"}],"summary":"改销售额"}',
            },
          }],
        }
      : { id: 'm1', role: 'assistant', content: marker }
    ev.push({
      type: 'MESSAGES_SNAPSHOT', threadId: 't1', runId: 'r1', timestamp: 9,
      messages: [
        { id: 'u1', role: 'user', content: '把销售额改成 999999' },
        assistantMsg,
      ],
    })
  }
  ev.push({ type: 'RUN_FINISHED', threadId: 't1', runId: 'r1', timestamp: 10 })
  return ev
}

// 续跑（浏览器回发 tool result 后的 follow-up run）—— 空收尾即可
const FOLLOWUP = [
  { type: 'RUN_STARTED', threadId: 't1', runId: 'r2', timestamp: 20 },
  { type: 'RUN_FINISHED', threadId: 't1', runId: 'r2', timestamp: 21 },
]

async function flush(times = 30) {
  for (let i = 0; i < times; i++) {
    await new Promise((r) => setTimeout(r, 0))
    await nextTick()
  }
}

async function runScenario(opts: SeqOpts) {
  const handlerSpy = vi.fn(async () => 'ok: 已确认修改')
  let fetchCount = 0
  vi.stubGlobal('fetch', vi.fn(async () => {
    fetchCount++
    return sseResponse(fetchCount === 1 ? gatewaySequence(opts) : FOLLOWUP)
  }))

  const w = mount(CopilotKitProvider as any, {
    props: {
      directAgents: { default: new HttpAgent({ url: '/agui-api/agent/run' }) },
      frontendTools: [
        {
          name: 'applySpreadsheetEdits',
          description: 'edit csv',
          parameters: z.object({
            file: z.string(),
            cells: z.array(z.object({ row: z.number(), col: z.number(), value: z.string() })),
            summary: z.string().optional(),
          }),
          handler: handlerSpy,
        },
      ],
    },
    slots: {
      default: () => h(CopilotChat as any, { agentId: 'default', threadId: 't1', welcomeScreen: false }),
    },
  })
  await flush(5)
  const textareas = w.findAll('textarea')
  const input = textareas[textareas.length - 1]
  expect(input.exists()).toBe(true)
  await input.setValue('把销售额改成 999999')
  await input.trigger('keydown', { key: 'Enter' })
  await flush(40)
  w.unmount()
  return handlerSpy
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('frontend tool 线上回归（2026-08-16 纯标记消息 modal 不弹）', () => {
  // 诊断结论（2026-08-16 四场景隔离实验，A/C 为线上原始字节流必败、已随
  // gateway 修复移除）：悬空 parentMessageId 与 TEXT_MESSAGE 包裹与否都无关
  // —— 唯一致败因素是 MESSAGES_SNAPSHOT 用 opencode 历史里的裸 <tool_call>
  // 文本消息冲刷掉流式工具调用。客户端要求：快照必须携带 toolCalls（D），
  // 或干脆不发快照（B）。gateway 侧修复 = ThreadMessagesService 标记→toolCalls。
  it('B: 无 MESSAGES_SNAPSHOT 的截断流 —— handler 必须执行', async () => {
    const spy = await runScenario({ wrapTextMessage: false, includeSnapshot: false })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('D: 快照内标记转 toolCalls（gateway 修复后形态）—— handler 恰好执行一次', async () => {
    const spy = await runScenario({ wrapTextMessage: false, includeSnapshot: true, snapshotWithToolCalls: true })
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
