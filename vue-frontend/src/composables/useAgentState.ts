import { getCurrentScope, onScopeDispose, ref, type Ref } from 'vue'
import type { AbstractAgent } from '@ag-ui/client'

/**
 * AG-UI shared state（task4 协议全量）：gateway 在 RUN_STARTED 后发
 * STATE_SNAPSHOT（{threadId, model, provider, workspace, contextSize}），
 * step 结算时发 STATE_DELTA（JSON Patch，目前只有 replace /contextSize）。
 * 订阅 agent 事件流把两者应用到本地 state，供顶栏模型徽章等展示。
 */

/** 应用一条 STATE_SNAPSHOT / STATE_DELTA 事件到 state（纯函数，便于测试）。 */
export function applyStateEvent(
  state: Record<string, any>,
  event: { type?: string; snapshot?: Record<string, any>; delta?: { op: string; path: string; value?: any }[] },
): Record<string, any> {
  if (event?.type === 'STATE_SNAPSHOT' && event.snapshot && typeof event.snapshot === 'object') {
    return { ...event.snapshot }
  }
  if (event?.type === 'STATE_DELTA' && Array.isArray(event.delta)) {
    const next = { ...state }
    for (const p of event.delta) {
      // 只支持顶层 key（本项目 delta 只有 /contextSize；JSON Pointer 全量留 TODO）
      const key = String(p.path ?? '').replace(/^\//, '')
      if (!key || key.includes('/')) continue
      if (p.op === 'remove') delete next[key]
      else if (p.op === 'replace' || p.op === 'add') next[key] = p.value
    }
    return next
  }
  return state
}

export function useAgentState(agent: AbstractAgent): { state: Ref<Record<string, any>> } {
  const state = ref<Record<string, any>>((agent.state as Record<string, any>) ?? {})
  const { unsubscribe } = agent.subscribe({
    onEvent: ({ event }: any) => {
      const next = applyStateEvent(state.value, event)
      if (next !== state.value) state.value = next
    },
    // client 应用 state mutation 后同步一次（双保险，涵盖其他来源的 state 变更）
    onStateChanged: ({ state: s }: any) => {
      if (s && typeof s === 'object' && Object.keys(s).length > 0) {
        state.value = { ...state.value, ...(s as Record<string, any>) }
      }
    },
  })
  if (getCurrentScope()) onScopeDispose(unsubscribe)
  return { state }
}
