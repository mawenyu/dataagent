import { describe, expect, it } from 'vitest'
import { applyStateEvent, useAgentState } from './useAgentState'

/**
 * AG-UI shared state（task4 协议全量第 7 项）：STATE_SNAPSHOT 全量替换 +
 * STATE_DELTA JSON Patch 增量更新。
 */
describe('applyStateEvent', () => {
  it('STATE_SNAPSHOT replaces the whole state', () => {
    const next = applyStateEvent({ old: 1 }, {
      type: 'STATE_SNAPSHOT',
      snapshot: { threadId: 't1', model: 'deepseek-reasoner', contextSize: 0 },
    })
    expect(next).toEqual({ threadId: 't1', model: 'deepseek-reasoner', contextSize: 0 })
  })

  it('STATE_DELTA applies JSON Patch replace/add/remove on top-level keys', () => {
    let s = { threadId: 't1', model: 'm', contextSize: 0 }
    s = applyStateEvent(s, { type: 'STATE_DELTA', delta: [{ op: 'replace', path: '/contextSize', value: 6183 }] })
    expect(s.contextSize).toBe(6183)
    s = applyStateEvent(s, { type: 'STATE_DELTA', delta: [{ op: 'add', path: '/note', value: 'x' }] })
    expect((s as any).note).toBe('x')
    s = applyStateEvent(s, { type: 'STATE_DELTA', delta: [{ op: 'remove', path: '/note' }] })
    expect('note' in s).toBe(false)
    expect(s.model).toBe('m', 'untouched keys preserved')
  })

  it('ignores unrelated events and nested paths (TODO: full JSON Pointer)', () => {
    const s = { a: 1 }
    expect(applyStateEvent(s, { type: 'TEXT_MESSAGE_CONTENT' })).toBe(s)
    expect(applyStateEvent(s, { type: 'STATE_DELTA', delta: [{ op: 'replace', path: '/a/b', value: 2 }] }).a).toBe(1)
  })
})

describe('useAgentState', () => {
  it('applies STATE_SNAPSHOT/STATE_DELTA events arriving on the agent subscription', () => {
    let handler: any
    const fakeAgent = {
      state: {},
      subscribe: (sub: any) => { handler = sub; return { unsubscribe: () => {} } },
    }
    const { state } = useAgentState(fakeAgent as any)
    handler.onEvent({ event: { type: 'STATE_SNAPSHOT', snapshot: { model: 'deepseek-reasoner', contextSize: 0 } } })
    expect(state.value.model).toBe('deepseek-reasoner')
    handler.onEvent({ event: { type: 'STATE_DELTA', delta: [{ op: 'replace', path: '/contextSize', value: 6183 }] } })
    expect(state.value.contextSize).toBe(6183)
  })
})
