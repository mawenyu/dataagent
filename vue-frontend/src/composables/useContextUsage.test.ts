import { describe, expect, it } from 'vitest'
import { effectScope, ref } from 'vue'
import { formatContextSize, useContextUsage, CONTEXT_WINDOW } from './useContextUsage'

/**
 * 需求7-5: context 用量显示。gateway 在每个 step 结束时发
 * CUSTOM{name:"context_usage", value:{contextSize,...}}；前端订阅并格式化。
 */

/** Minimal fake agent capturing the subscriber so tests can fire events. */
function fakeAgent() {
  let subscriber: any = null
  return {
    fire(event: any) {
      subscriber?.onEvent?.({ event })
    },
    agent: {
      subscribe(s: any) {
        subscriber = s
        return { unsubscribe: () => { subscriber = null } }
      },
    } as any,
    getSubscriber: () => subscriber,
  }
}

describe('formatContextSize', () => {
  it('formats small numbers as-is', () => {
    expect(formatContextSize(0)).toBe('0')
    expect(formatContextSize(999)).toBe('999')
  })
  it('formats thousands with one decimal', () => {
    expect(formatContextSize(7303)).toBe('7.3k')
    expect(formatContextSize(12300)).toBe('12.3k')
    expect(formatContextSize(128000)).toBe('128k')
  })
})

describe('useContextUsage', () => {
  it('updates on context_usage CUSTOM events and ignores others', async () => {
    const scope = effectScope()
    const { agent, fire } = fakeAgent()
    const usage = scope.run(() => useContextUsage(agent))!
    expect(usage.contextSize.value).toBe(0)

    fire({ type: 'CUSTOM', name: 'context_usage', value: { contextSize: 7303, finish: 'tool-calls' } })
    expect(usage.contextSize.value).toBe(7303)
    expect(usage.label.value).toBe(`context: 7.3k/128k`)

    fire({ type: 'CUSTOM', name: 'other', value: 1 })
    fire({ type: 'TEXT_MESSAGE_CONTENT', delta: 'x' })
    expect(usage.contextSize.value).toBe(7303)

    fire({ type: 'CUSTOM', name: 'context_usage', value: { contextSize: 12300 } })
    expect(usage.label.value).toBe('context: 12.3k/128k')
    scope.stop()
  })

  it('unsubscribes when the scope is disposed', () => {
    const scope = effectScope()
    const { agent, getSubscriber } = fakeAgent()
    scope.run(() => useContextUsage(agent))
    expect(getSubscriber()).not.toBeNull()
    scope.stop()
    expect(getSubscriber()).toBeNull()
  })

  it('exposes the context window constant', () => {
    expect(CONTEXT_WINDOW).toBeGreaterThan(0)
  })
})

describe('P-K: 累计 token 消耗(每会话分桶)', () => {
  it('逐 step 累计 input/output/reasoning,tokenLabel 格式化', async () => {
    const scope = effectScope()
    const { agent, fire } = fakeAgent()
    const usage = scope.run(() => useContextUsage(agent))!

    fire({ type: 'CUSTOM', name: 'context_usage', value: { input: 1000, output: 200, reasoning: 50, contextSize: 1000, finish: 'tool-calls' } })
    fire({ type: 'CUSTOM', name: 'context_usage', value: { input: 1200, output: 300, reasoning: 0, contextSize: 1200, finish: 'stop' } })
    expect(usage.totalTokens.value).toBe(1000 + 200 + 50 + 1200 + 300)
    expect(usage.tokenLabel.value).toBe('tokens: 2.8k')
    expect(usage.breakdown.value).toMatchObject({ input: 2200, output: 500, reasoning: 50, steps: 2 })
    scope.stop()
  })

  it('按 threadId 分桶: 切换会话显示各自累计,互不影响', () => {
    const scope = effectScope()
    const { agent, fire } = fakeAgent()
    const threadId = ref('t1')
    const usage = scope.run(() => useContextUsage(agent, threadId))!

    fire({ type: 'CUSTOM', name: 'context_usage', value: { input: 1000, output: 100, contextSize: 1000 } })
    expect(usage.totalTokens.value).toBe(1100)

    threadId.value = 't2'
    expect(usage.totalTokens.value).toBe(0)
    fire({ type: 'CUSTOM', name: 'context_usage', value: { input: 500, output: 50, contextSize: 500 } })
    expect(usage.totalTokens.value).toBe(550)

    threadId.value = 't1'
    expect(usage.totalTokens.value).toBe(1100)
    scope.stop()
  })

  it('cacheRead 计入 breakdown 但 contextSize 沿用网关口径', () => {
    const scope = effectScope()
    const { agent, fire } = fakeAgent()
    const usage = scope.run(() => useContextUsage(agent))!
    fire({ type: 'CUSTOM', name: 'context_usage', value: { input: 300, output: 100, cacheRead: 900, contextSize: 1200 } })
    expect(usage.contextSize.value).toBe(1200)
    expect(usage.breakdown.value.cacheRead).toBe(900)
    // 累计消耗 = input+output+reasoning(cacheRead 是缓存命中,不计新增消耗)
    expect(usage.totalTokens.value).toBe(400)
    scope.stop()
  })
})

describe('P-K: 上下文接近上限提示级别', () => {
  function levelAt(size: number) {
    const scope = effectScope()
    const { agent, fire } = fakeAgent()
    const usage = scope.run(() => useContextUsage(agent))!
    fire({ type: 'CUSTOM', name: 'context_usage', value: { contextSize: size } })
    const l = usage.warningLevel.value
    scope.stop()
    return l
  }

  it('<80% none,≥80% amber,≥95% red', () => {
    expect(levelAt(Math.floor(CONTEXT_WINDOW * 0.79))).toBe('none')
    expect(levelAt(Math.floor(CONTEXT_WINDOW * 0.8))).toBe('amber')
    expect(levelAt(Math.floor(CONTEXT_WINDOW * 0.9))).toBe('amber')
    expect(levelAt(Math.ceil(CONTEXT_WINDOW * 0.95))).toBe('red')
  })
})
