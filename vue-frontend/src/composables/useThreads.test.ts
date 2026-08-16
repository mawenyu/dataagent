import { describe, expect, it, beforeEach, vi } from 'vitest'
import { effectScope } from 'vue'
import { useThreads } from './useThreads'

/**
 * 需求1: 多会话管理。gateway /agui-api/chat/threads 为权威来源，
 * localStorage 仅作缓存兜底（API 不可用时也能展示上次的列表）。
 */

function fakeAgent() {
  const calls: any[][] = []
  return {
    calls,
    agent: {
      setMessages: (...args: any[]) => calls.push(args),
    } as any,
  }
}

function mockFetch(routes: Record<string, any>) {
  // 最长前缀优先，避免 'GET /agui-api/chat/threads' 吞掉 '.../a/messages'
  const sorted = Object.entries(routes).sort((a, b) => b[0].length - a[0].length)
  return vi.fn(async (url: string, init?: any) => {
    const method = init?.method ?? 'GET'
    const key = `${method} ${url}`
    for (const [pattern, value] of sorted) {
      if (key.startsWith(pattern)) {
        const body = typeof value === 'function' ? value(init) : value
        return { ok: true, json: async () => body } as any
      }
    }
    return { ok: false, status: 404, json: async () => ({}) } as any
  })
}

const T = (id: string, title: string) => ({ id, title, sessionId: null, createdAt: 't', updatedAt: 't' })

describe('useThreads (需求1)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('refresh 从 gateway 拉取列表并写 localStorage 缓存', async () => {
    const fetchMock = mockFetch({ 'GET /agui-api/chat/threads': { data: [T('a', '会话A'), T('b', '会话B')] } })
    vi.stubGlobal('fetch', fetchMock)
    const { agent } = fakeAgent()
    const th = useThreads(agent)
    await th.refresh()
    expect(th.threads.value.map((t) => t.id)).toEqual(['a', 'b'])
    expect(JSON.parse(localStorage.getItem('dataagent.threads')!).threads).toHaveLength(2)
    vi.unstubAllGlobals()
  })

  it('API 挂掉时用 localStorage 缓存兜底', async () => {
    localStorage.setItem('dataagent.threads', JSON.stringify({ threads: [T('c', '缓存会话')], currentId: 'c' }))
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const { agent } = fakeAgent()
    const th = useThreads(agent)
    await th.refresh()
    expect(th.threads.value).toHaveLength(1)
    expect(th.threads.value[0].title).toBe('缓存会话')
    vi.unstubAllGlobals()
  })

  it('switchTo 加载历史并写入 agent', async () => {
    const history = [{ id: 'u1', role: 'user', content: '你好' }]
    vi.stubGlobal('fetch', mockFetch({
      'GET /agui-api/chat/threads': { data: [T('a', 'A')] },
      'GET /agui-api/chat/threads/a/messages': { data: history },
    }))
    const { agent, calls } = fakeAgent()
    const th = useThreads(agent)
    await th.refresh()
    await th.switchTo('a')
    expect(th.currentId.value).toBe('a')
    expect(calls).toEqual([[history]])
    vi.unstubAllGlobals()
  })

  it('createNew 生成新 thread 并清空 agent 消息', async () => {
    vi.stubGlobal('fetch', mockFetch({
      'GET /agui-api/chat/threads': { data: [] },
      'POST /agui-api/chat/threads': (init) => ({ data: JSON.parse(init.body) }),
    }))
    const { agent, calls } = fakeAgent()
    const th = useThreads(agent)
    await th.createNew()
    expect(th.currentId.value).toBeTruthy()
    expect(calls).toEqual([[[]]])
    expect(th.threads.value).toHaveLength(1)
    vi.unstubAllGlobals()
  })

  it('P29: crypto.randomUUID 缺失（裸 HTTP 非安全上下文）时 createNew 仍生效', async () => {
    vi.stubGlobal('fetch', mockFetch({
      'GET /agui-api/chat/threads': { data: [T('a', '旧会话')] },
      'POST /agui-api/chat/threads': (init) => ({ data: JSON.parse(init.body) }),
    }))
    // 模拟裸 HTTP 部署：randomUUID 不存在（生产实测 createNew 首行抛 TypeError）
    const realCrypto = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) })
    const { agent, calls } = fakeAgent()
    const th = useThreads(agent)
    await th.refresh()
    await th.switchTo('a')
    const id = await th.createNew()
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(th.currentId.value).toBe(id)
    expect(th.threads.value[0]?.id).toBe(id)
    expect(calls[calls.length - 1]).toEqual([[]])
    vi.unstubAllGlobals()
  })

  it('P29: 在途 refresh 晚于 createNew 落地时不得顶掉新会话（竞态回归）', async () => {
    // gateway 有状态：POST 建档、GET 返回当前档案 —— 但首个 refresh 挂起，
    // 直到 createNew 开始后才带着「旧快照」落地（connect 回放/run 收尾触发
    // 的 refresh 真实时序）。没有 settle 防护时新会话会被旧快照顶掉。
    const API_GET = '/agui-api/chat/threads'
    let releaseStale!: () => void
    let store = [T('a', '旧会话')]
    let getCount = 0
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      const method = init?.method ?? 'GET'
      if (method === 'POST') {
        store = [{ ...T(JSON.parse(init.body).id, '新会话') }, ...store]
        return { ok: true, json: async () => ({ data: {} }) } as any
      }
      getCount++
      if (getCount === 1) {
        // 第一次 GET：挂起的在途旧快照（只看到 [a]，永远看不到新建）
        await new Promise<void>((r) => { releaseStale = r })
        return { ok: true, json: async () => ({ data: [T('a', '旧会话')] }) } as any
      }
      return { ok: true, json: async () => ({ data: store }) } as any
    })
    vi.stubGlobal('fetch', fetchMock)
    const { agent } = fakeAgent()
    const th = useThreads(agent)
    void th.refresh() // 挂起的在途 refresh（快照 = 只有旧会话）
    const creating = th.createNew()
    await new Promise((r) => setTimeout(r, 10)) // 让 createNew 推进到 settle 等待点
    releaseStale() // 旧快照此刻才落地
    const id = await creating
    await new Promise((r) => setTimeout(r, 10))
    expect(th.threads.value.find((t) => t.id === id), '新会话不得被在途旧快照顶掉').toBeTruthy()
    expect(th.threads.value[0]?.id).toBe(id)
    vi.unstubAllGlobals()
  })

  it('remove 删除当前会话后自动开新会话', async () => {
    vi.stubGlobal('fetch', mockFetch({
      'GET /agui-api/chat/threads': { data: [T('a', 'A')] },
      'DELETE /agui-api/chat/threads/a': { data: true },
      'POST /agui-api/chat/threads': (init) => ({ data: JSON.parse(init.body) }),
    }))
    const { agent } = fakeAgent()
    const th = useThreads(agent)
    await th.refresh()
    await th.switchTo('a')
    await th.remove('a')
    expect(th.threads.value.find((t) => t.id === 'a')).toBeUndefined()
    expect(th.currentId.value).not.toBe('a')
    vi.unstubAllGlobals()
  })

  it('rename 更新列表标题', async () => {
    vi.stubGlobal('fetch', mockFetch({
      'GET /agui-api/chat/threads': { data: [T('a', '旧名')] },
      'PATCH /agui-api/chat/threads/a': { data: T('a', '新名字') },
    }))
    const { agent } = fakeAgent()
    const th = useThreads(agent)
    await th.refresh()
    await th.rename('a', '新名字')
    expect(th.threads.value[0].title).toBe('新名字')
    vi.unstubAllGlobals()
  })

  it('init 恢复缓存的当前会话并加载历史', async () => {
    localStorage.setItem('dataagent.threads', JSON.stringify({ threads: [T('a', 'A'), T('b', 'B')], currentId: 'b' }))
    const history = [{ id: 'u1', role: 'user', content: 'hi' }]
    vi.stubGlobal('fetch', mockFetch({
      'GET /agui-api/chat/threads/b/messages': { data: history },
      'GET /agui-api/chat/threads': { data: [T('a', 'A'), T('b', 'B')] },
    }))
    const { agent, calls } = fakeAgent()
    const th = useThreads(agent)
    await th.init()
    expect(th.currentId.value).toBe('b')
    expect(calls).toEqual([[history]])
    vi.unstubAllGlobals()
  })

  it('init 空列表时分配全新 threadId 且不发请求建帖', async () => {
    vi.stubGlobal('fetch', mockFetch({ 'GET /agui-api/chat/threads': { data: [] } }))
    const { agent, calls } = fakeAgent()
    const th = useThreads(agent)
    await th.init()
    expect(th.currentId.value).toBeTruthy()
    expect(calls).toEqual([[[]]])
    vi.unstubAllGlobals()
  })
})
