import { ref, watch, type Ref } from 'vue'

/**
 * P-B: run 失败/中断的内联错误恢复。
 *
 * CopilotChat 的 onError 只给一次性事件，消息流里不留痕迹 —— 这里把错误
 * 持有为状态（内联错误卡数据源），并提供"原线程重发最后一条用户消息"的
 * 重试：截掉失败那一轮（最后一条 user 消息及其后的半截 assistant 流），
 * 以相同内容（含多模态 parts）重新入列后重新触发 run。
 */

export interface AgentLike {
  messages: unknown[]
  setMessages(next: unknown[]): void
  addMessage(message: unknown): void
}

/** 用户主动停止（abort）不算"可重试的失败"，不弹内联错误卡。 */
export function isAbortError(input: { code?: string; message?: string } | undefined | null): boolean {
  if (!input) return false
  const code = (input.code ?? '').toLowerCase()
  const message = (input.message ?? '').toLowerCase()
  return code === 'abort' || message.includes('aborted') || message.includes('abort')
}

export function useRunErrorRecovery(deps: {
  /** 解析当前线程实际渲染的 agent（registry 的 per-thread clone 优先）。 */
  resolveAgent: () => AgentLike | undefined | null
  threadId: Ref<string>
  /** 触发 run（默认形态: (agent) => agent.runAgent()，便于测试替换）。 */
  run: (agent: AgentLike) => Promise<void>
}) {
  const runError = ref<string | null>(null)
  const retrying = ref(false)

  function reportError(message: string) {
    runError.value = message
  }
  function clear() {
    runError.value = null
  }

  interface ChatMessageLike {
    id?: string
    role?: string
    content?: unknown
  }

  function lastUserIndex(messages: unknown[]): number {
    for (let i = messages.length - 1; i >= 0; i--) {
      if ((messages[i] as ChatMessageLike)?.role === 'user') return i
    }
    return -1
  }

  /** 重发当前线程最后一条用户消息；无 user 消息或已在重试中 → false。 */
  async function retryLastMessage(): Promise<boolean> {
    if (retrying.value) return false
    const agent = deps.resolveAgent()
    if (!agent) return false
    const messages = [...(agent.messages ?? [])]
    const idx = lastUserIndex(messages)
    if (idx < 0) return false

    const content = (messages[idx] as ChatMessageLike).content
    retrying.value = true
    clear() // 重试开始即收起错误卡
    try {
      agent.setMessages(messages.slice(0, idx))
      agent.addMessage({ id: crypto.randomUUID(), role: 'user', content })
      await deps.run(agent)
      return true
    } catch (e: any) {
      // 重试本身失败（网络层直接抛错）→ 重新弹卡展示新原因；
      // 流式 RUN_ERROR 不走这里，由 core onError 通道上报。
      reportError(e?.message ?? '重试失败')
      return true
    } finally {
      retrying.value = false
    }
  }

  watch(deps.threadId, clear)

  return { runError, retrying, reportError, clear, retryLastMessage }
}
