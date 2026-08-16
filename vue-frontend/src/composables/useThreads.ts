import { ref, watch, nextTick } from 'vue'
import type { Ref } from 'vue'
import type { AbstractAgent } from '@ag-ui/client'
import { getThreadClone } from '@copilotkit/vue'
import { uuid } from './uuid'

/**
 * 需求1: 多会话管理。
 *
 * gateway /agui-api/chat/threads* 是权威来源（文件持久化，刷新不丢）；
 * localStorage 仅作缓存兜底（API 不可用时展示上次的列表与当前会话）。
 */

export interface ThreadMeta {
  id: string
  title: string
  sessionId: string | null
  createdAt: string
  updatedAt: string
  /** P-Q: 分叉来源(源会话 + 分叉消息),非分叉会话缺省 */
  branchedFrom?: { threadId: string; messageId: string } | null
}

const CACHE_KEY = 'dataagent.threads'
const API = '/agui-api/chat/threads'

interface CacheShape {
  threads: ThreadMeta[]
  currentId: string
}

function readCache(): CacheShape | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as CacheShape) : null
  } catch {
    return null
  }
}

export function useThreads(agent: AbstractAgent) {
  const threads = ref<ThreadMeta[]>([])
  const currentId = ref<string>('')
  const loading = ref(false)
  /** 在途 refresh 的 Promise（竞态防护见 refresh 注释）。 */
  let pendingRefresh: Promise<void> | null = null

  function persistCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        threads: threads.value,
        currentId: currentId.value,
      } satisfies CacheShape))
    } catch { /* quota 等忽略 */ }
  }

  async function refresh(): Promise<void> {
    // P29: 竞态防护 —— refresh 可能被 onRunFinalized 等事件在任意时刻触发
    // （connect 回放/上一轮 run 收尾都会冒泡）。若在途的 refresh 晚于
    // createNew/remove 的本地列表变更落地，会用旧的 gateway 快照把新会话
    // 顶掉（实测：点「新建」后新会话从列表消失、高亮丢失）。变更操作前
    // 必须先等在途 refresh 落定（见 createNew/remove/rename 的 await）。
    const p = (async () => {
      try {
        const res = await fetch(API)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = await res.json()
        threads.value = body.data ?? []
        persistCache()
      } catch {
        const cache = readCache()
        if (cache) threads.value = cache.threads ?? []
      }
    })()
    pendingRefresh = p
    try {
      await p
    } finally {
      if (pendingRefresh === p) pendingRefresh = null
    }
  }

  /** 等待在途 refresh 落定，避免旧快照回写覆盖本地列表变更。 */
  async function settlePendingRefresh(): Promise<void> {
    try {
      await pendingRefresh
    } catch { /* refresh 自身已兜底 */ }
  }

  /** 新建会话：gateway 建档 + 清空 agent 消息。 */
  async function createNew(): Promise<string> {
    const id = uuid()
    try {
      await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
    } catch { /* gateway 挂掉时也允许本地新建（run 时会自动建档） */ }
    // P29: 先等在途 refresh 落定 —— 否则其旧快照会晚于本地 prepend 落地，
    // 把刚建的会话从列表顶掉（用户视角 = 点新建没反应、高亮留在旧会话）。
    await settlePendingRefresh()
    currentId.value = id
    agent.setMessages([])
    await nextTick()
    getThreadClone(agent, id)?.setMessages([])
    if (!threads.value.find((t) => t.id === id)) {
      threads.value = [{ id, title: '新会话', sessionId: null, createdAt: '', updatedAt: '' }, ...threads.value]
    }
    persistCache()
    return id
  }

  /** 切换会话：加载该会话历史消息并渲染（写入 CopilotChat 实际渲染的 per-thread clone）。 */
  async function switchTo(id: string): Promise<void> {
    if (id === currentId.value) return
    currentId.value = id
    persistCache()
    let history: unknown[] = []
    try {
      const res = await fetch(`${API}/${id}/messages`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      history = body.data ?? []
    } catch { /* 拉取失败则空历史 */ }
    // 等 useAgent 的 watch 创建/复用 clone 后再写入
    await nextTick()
    const target = getThreadClone(agent, id) ?? agent
    target.setMessages(history as any)
  }

  async function remove(id: string): Promise<void> {
    try {
      await fetch(`${API}/${id}`, { method: 'DELETE' })
    } catch { /* 离线也从本地列表移除 */ }
    await settlePendingRefresh() // P29: 同 createNew 的竞态防护
    threads.value = threads.value.filter((t) => t.id !== id)
    if (currentId.value === id) {
      const next = threads.value[0]
      if (next) await switchTo(next.id)
      else await createNew()
    }
    persistCache()
  }

  async function rename(id: string, title: string): Promise<void> {
    if (!title.trim()) return
    try {
      await fetch(`${API}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim() }),
      })
    } catch { /* 离线仅本地改名 */ }
    await settlePendingRefresh() // P29: 同 createNew 的竞态防护
    threads.value = threads.value.map((t) => (t.id === id ? { ...t, title: title.trim() } : t))
    persistCache()
  }

  /** 首轮 run 结束后 gateway 会用首条消息命名 —— 调用方在 run 完成时触发。 */
  watch(currentId, persistCache)

  /**
   * 启动初始化：拉列表 → 恢复上次的当前会话（缓存兜底）→ 否则进第一个会话 →
   * 都没有则给一个全新的本地 threadId（首次发消息时 gateway 自动建档）。
   */
  async function init(): Promise<void> {
    const cache = readCache() // 先读缓存 —— refresh() 里的 persistCache 会用空 currentId 覆盖
    await refresh()
    const cached = cache?.currentId
    if (cached && threads.value.find((t) => t.id === cached)) {
      await switchTo(cached)
      return
    }
    const first = threads.value[0]
    if (first) {
      await switchTo(first.id)
      return
    }
    currentId.value = uuid()
    agent.setMessages([])
    persistCache()
  }

  return { threads, currentId, loading, refresh, createNew, switchTo, remove, rename, init, persistCache }
}
