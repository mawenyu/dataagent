import { computed, getCurrentScope, onScopeDispose, ref } from 'vue'
import type { Ref } from 'vue'
import type { AbstractAgent } from '@ag-ui/client'

/**
 * 需求7-5: 会话 context 用量显示。
 * P-K: 累计 token 消耗（按会话分桶）+ 接近上下文上限提示级别。
 *
 * The gateway translates OpenCode `session.next.step.ended` token stats into
 * AG-UI `CUSTOM{name:"context_usage"}` events,携带逐步 input/output/reasoning/
 * cacheRead/cacheWrite/contextSize。累计消耗 = Σ(input+output+reasoning)
 * (cacheRead 是缓存命中,不计新增);分桶按 threadId,会话切换各自保留。
 */

/** DeepSeek chat/reasoner context window. */
export const CONTEXT_WINDOW = 128_000
/** P-K: 上下文用量提示阈值。 */
export const CONTEXT_WARN_RATIO = 0.8
export const CONTEXT_CRIT_RATIO = 0.95

export function formatContextSize(n: number): string {
  if (n < 1000) return String(n)
  const k = n / 1000
  return (k >= 100 ? Math.round(k).toString() : k.toFixed(1).replace(/\.0$/, '')) + 'k'
}

export interface TokenBreakdown {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  steps: number
}

const EMPTY_BREAKDOWN: TokenBreakdown = {
  input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, steps: 0,
}

export type ContextWarningLevel = 'none' | 'amber' | 'red'

export function useContextUsage(agent: AbstractAgent, threadId?: Ref<string>) {
  const contextSize = ref(0)
  /** P-K: 每会话累计桶(threadId 缺省时全部落默认桶) */
  const buckets = ref(new Map<string, TokenBreakdown>())

  const { unsubscribe } = agent.subscribe({
    onEvent: ({ event }: any) => {
      if (event?.type === 'CUSTOM' && event.name === 'context_usage') {
        const v = event.value ?? {}
        const size = v.contextSize
        if (typeof size === 'number' && Number.isFinite(size)) contextSize.value = size

        const key = threadId?.value ?? ''
        const prev = buckets.value.get(key) ?? { ...EMPTY_BREAKDOWN }
        const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
        const next: TokenBreakdown = {
          input: prev.input + num(v.input),
          output: prev.output + num(v.output),
          reasoning: prev.reasoning + num(v.reasoning),
          cacheRead: prev.cacheRead + num(v.cacheRead),
          cacheWrite: prev.cacheWrite + num(v.cacheWrite),
          steps: prev.steps + 1,
        }
        const m = new Map(buckets.value)
        m.set(key, next)
        buckets.value = m
      }
    },
  })
  if (getCurrentScope()) onScopeDispose(unsubscribe)

  const breakdown = computed<TokenBreakdown>(
    () => buckets.value.get(threadId?.value ?? '') ?? EMPTY_BREAKDOWN,
  )
  /** 累计消耗(input+output+reasoning;cacheRead 为缓存命中不计新增) */
  const totalTokens = computed(
    () => breakdown.value.input + breakdown.value.output + breakdown.value.reasoning,
  )
  const tokenLabel = computed(() => `tokens: ${formatContextSize(totalTokens.value)}`)
  const tokenTitle = computed(() => {
    const b = breakdown.value
    return `本会话累计 token（${b.steps} 个 step）\n输入 ${b.input.toLocaleString()} · 输出 ${b.output.toLocaleString()} · 推理 ${b.reasoning.toLocaleString()}\n缓存命中 ${b.cacheRead.toLocaleString()}（不计新增消耗）`
  })

  /** 接近上下文上限的提示级别:<80% none,≥80% amber,≥95% red */
  const warningLevel = computed<ContextWarningLevel>(() => {
    const ratio = contextSize.value / CONTEXT_WINDOW
    if (ratio >= CONTEXT_CRIT_RATIO) return 'red'
    if (ratio >= CONTEXT_WARN_RATIO) return 'amber'
    return 'none'
  })

  const label = computed(() =>
    `context: ${formatContextSize(contextSize.value)}/${formatContextSize(CONTEXT_WINDOW)}`)

  return {
    contextSize,
    maxTokens: CONTEXT_WINDOW,
    label,
    totalTokens,
    breakdown,
    tokenLabel,
    tokenTitle,
    warningLevel,
  }
}
