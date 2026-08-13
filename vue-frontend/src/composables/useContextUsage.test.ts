import { describe, expect, it } from 'vitest'
import { effectScope, nextTick } from 'vue'
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
