import { computed, getCurrentScope, onScopeDispose, ref } from 'vue'
import type { AbstractAgent } from '@ag-ui/client'

/**
 * 需求7-5: 会话 context 用量显示。
 *
 * The gateway translates OpenCode `session.next.step.ended` token stats into
 * AG-UI `CUSTOM{name:"context_usage"}` events. This composable subscribes to
 * the agent and exposes the latest context size + a display label.
 */

/** DeepSeek chat/reasoner context window. */
export const CONTEXT_WINDOW = 128_000

export function formatContextSize(n: number): string {
  if (n < 1000) return String(n)
  const k = n / 1000
  return (k >= 100 ? Math.round(k).toString() : k.toFixed(1).replace(/\.0$/, '')) + 'k'
}

export function useContextUsage(agent: AbstractAgent) {
  const contextSize = ref(0)
  const { unsubscribe } = agent.subscribe({
    onEvent: ({ event }: any) => {
      if (event?.type === 'CUSTOM' && event.name === 'context_usage') {
        const v = event.value?.contextSize
        if (typeof v === 'number' && Number.isFinite(v)) contextSize.value = v
      }
    },
  })
  if (getCurrentScope()) onScopeDispose(unsubscribe)

  const label = computed(() =>
    `context: ${formatContextSize(contextSize.value)}/${formatContextSize(CONTEXT_WINDOW)}`)

  return { contextSize, maxTokens: CONTEXT_WINDOW, label }
}
