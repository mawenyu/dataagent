import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useRunErrorRecovery, isAbortError, parseRunError } from './runErrorRecovery'

/** P-B: run 失败/中断的内联恢复 —— 错误卡状态 + 原线程重发最后一条用户消息。 */

function makeAgent(messages: any[] = []) {
  return {
    messages: [...messages],
    setMessages(next: any[]) { this.messages = [...next] },
    addMessage(m: any) { this.messages = [...this.messages, m] },
  }
}

function setup(messages: any[] = [], run?: (agent: any) => Promise<void>) {
  const agent = makeAgent(messages)
  const threadId = ref('t-1')
  const runFn = run ?? vi.fn(async () => {})
  const api = useRunErrorRecovery({ resolveAgent: () => agent, threadId, run: runFn })
  return { api, agent, threadId, runFn }
}

describe('isAbortError (P-B)', () => {
  it('识别用户主动停止(code=abort / 消息含 abort),不算可重试错误', () => {
    expect(isAbortError({ code: 'abort' })).toBe(true)
    expect(isAbortError({ message: 'Request aborted' })).toBe(true)
    expect(isAbortError({ code: 'RUN_ERROR', message: 'model timeout' })).toBe(false)
    expect(isAbortError(undefined)).toBe(false)
  })
})

describe('useRunErrorRecovery (P-B)', () => {
  it('reportError/clear 驱动错误卡显隐', () => {
    const { api } = setup()
    expect(api.runError.value).toBeNull()
    api.reportError('model timeout')
    expect(api.runError.value).toBe('model timeout')
    api.clear()
    expect(api.runError.value).toBeNull()
  })

  it('retry: 截掉失败轮(最后用户消息及其后所有)再以同内容重发并触发 run', async () => {
    const { api, agent, runFn } = setup([
      { id: 'u1', role: 'user', content: '第一个问题' },
      { id: 'a1', role: 'assistant', content: '第一个回答' },
      { id: 'u2', role: 'user', content: '分析本月销售' },
      { id: 'a2', role: 'assistant', content: '半截回答(流式中断)' },
    ])
    const ok = await api.retryLastMessage()
    expect(ok).toBe(true)
    // 重发后: u1/a1 保留,u2 重新入列(新 id),半截 a2 被截掉
    const roles = agent.messages.map((m) => m.role)
    expect(roles).toEqual(['user', 'assistant', 'user'])
    const resent = agent.messages[2]
    expect(resent.content).toBe('分析本月销售')
    expect(resent.id).not.toBe('u2')
    expect(runFn).toHaveBeenCalledTimes(1)
    expect(runFn).toHaveBeenCalledWith(agent)
  })

  it('retry: 失败轮只有用户消息(无 assistant 残留)也正确重发', async () => {
    const { api, agent } = setup([{ id: 'u1', role: 'user', content: '你好' }])
    await api.retryLastMessage()
    expect(agent.messages.map((m) => m.role)).toEqual(['user'])
    expect(agent.messages[0].content).toBe('你好')
  })

  it('retry: 多模态用户消息 content(parts 数组)原样重发', async () => {
    const parts = [{ type: 'text', text: '看附件' }, { type: 'document', metadata: { filename: 'a.csv' } }]
    const { api, agent } = setup([{ id: 'u1', role: 'user', content: parts }])
    await api.retryLastMessage()
    expect(agent.messages[0].content).toBe(parts)
  })

  it('retry: 线程里没有用户消息 → false 且不触发 run', async () => {
    const { api, runFn } = setup([{ id: 'a1', role: 'assistant', content: 'x' }])
    expect(await api.retryLastMessage()).toBe(false)
    expect(runFn).not.toHaveBeenCalled()
  })

  it('retry 开始时清除错误卡;run 再抛错则重弹卡展示新原因,不残留 retrying 态', async () => {
    const failing = vi.fn(async () => { throw new Error('network down') })
    const { api } = setup([{ id: 'u1', role: 'user', content: 'q' }], failing)
    api.reportError('first failure')
    expect(await api.retryLastMessage()).toBe(true)
    expect(api.runError.value).toBe('network down')
    expect(api.retrying.value).toBe(false)
  })

  it('retry 期间 retrying=true(按钮 loading),并发重试被拒', async () => {
    let release!: () => void
    const blocked = vi.fn(() => new Promise<void>((r) => { release = r }))
    const { api } = setup([{ id: 'u1', role: 'user', content: 'q' }], blocked)
    const p1 = api.retryLastMessage()
    await Promise.resolve()
    expect(api.retrying.value).toBe(true)
    const p2 = api.retryLastMessage()
    expect(blocked).toHaveBeenCalledTimes(1)
    release()
    expect(await p1).toBe(true)
    expect(await p2).toBe(false)
  })

  it('切换会话清除错误卡', async () => {
    const { api, threadId } = setup([{ id: 'u1', role: 'user', content: 'q' }])
    api.reportError('boom')
    threadId.value = 't-2'
    await Promise.resolve()
    expect(api.runError.value).toBeNull()
  })
})

describe('parseRunError (P-I)', () => {
  it('消息内 HTTP 状态码提取 + 5xx 友好文案', () => {
    const r = parseRunError({ message: 'HTTP 502 Bad Gateway' })
    expect(r.code).toBe('502')
    expect(r.message).toContain('网关')
    expect(r.message).toContain('502')
  })

  it('显式 code 优先于消息提取', () => {
    const r = parseRunError({ code: 'RUN_TIMEOUT', message: 'HTTP 500' })
    expect(r.code).toBe('RUN_TIMEOUT')
  })

  it('5xx 各码归一为网关/服务不可用;413/429 专属文案', () => {
    expect(parseRunError({ message: 'HTTP 500' }).message).toContain('服务暂时不可用')
    expect(parseRunError({ message: 'HTTP 504' }).message).toContain('服务暂时不可用')
    expect(parseRunError({ message: 'HTTP 413' }).message).toContain('过大')
    expect(parseRunError({ message: 'HTTP 429' }).message).toContain('频繁')
  })

  it('非结构化消息原样透传,code 为 null', () => {
    const r = parseRunError({ message: 'model timeout after 120s' })
    expect(r.code).toBeNull()
    expect(r.message).toBe('model timeout after 120s')
  })

  it('空输入兜底', () => {
    const r = parseRunError({})
    expect(r.code).toBeNull()
    expect(r.message).toBe('未知错误')
  })
})

describe('useRunErrorRecovery 错误码 (P-I)', () => {
  it('reportError 携带 code 时 runErrorCode 同步;clear 一并清除', () => {
    const agent = { messages: [], setMessages() {}, addMessage() {} }
    const api = useRunErrorRecovery({ resolveAgent: () => agent, threadId: ref('t'), run: async () => {} })
    api.reportError('网关错误', '502')
    expect(api.runError.value).toBe('网关错误')
    expect(api.runErrorCode.value).toBe('502')
    api.clear()
    expect(api.runError.value).toBeNull()
    expect(api.runErrorCode.value).toBeNull()
  })
})
