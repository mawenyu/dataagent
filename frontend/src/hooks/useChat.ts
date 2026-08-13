import { useCallback, useRef, useState } from 'react'
import { streamAgentRun } from '../api/agent'
import type {
  AgentInputItem,
  AgentRunRequest,
  ChatMessage,
  Session,
  TextMessage,
  TextMessageContentEvent,
  TextMessageEndEvent,
  TextMessageStartEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  ToolCallStartEvent,
} from '../types'

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export interface UseChatOptions {
  session: Session | null
  onUserMessage: (content: string) => void
  onAssistantDelta: (messageId: string, delta: string) => void
  onAssistantDone: (messageId: string) => void
  onToolCallStart: (toolCall: ChatMessage) => void
  onToolCallArgs: (toolCallId: string, delta: string) => void
  onToolCallEnd: (toolCallId: string, result?: unknown, error?: string) => void
}

export function useChat(options: UseChatOptions) {
  const [isStreaming, setIsStreaming] = useState(false)
  const abortRef = useRef<(() => void) | null>(null)

  const sendMessage = useCallback(
    (content: string) => {
      if (!options.session) return

      options.onUserMessage(content)

      const currentMessages = options.session.messages
      const input: AgentInputItem[] = currentMessages
        .filter((m): m is TextMessage => m.kind === 'text')
        .map((m) => ({
          type: 'TEXT_MESSAGE',
          role: m.role,
          content: m.content,
        }))
      input.push({
        type: 'TEXT_MESSAGE',
        role: 'user',
        content,
      })

      const request: AgentRunRequest = {
        input,
        session_id: options.session.id,
      }

      const assistantMessageIds = new Map<string, string>()
      const toolCallIds = new Map<string, string>()

      setIsStreaming(true)

      abortRef.current = streamAgentRun(request, {
        onEvent: (event) => {
          switch (event.type) {
            case 'TEXT_MESSAGE_START': {
              const startEvent = event as TextMessageStartEvent
              const messageId = generateId()
              assistantMessageIds.set(startEvent.message_id, messageId)
              break
            }
            case 'TEXT_MESSAGE_CONTENT': {
              const contentEvent = event as TextMessageContentEvent
              const messageId = assistantMessageIds.get(contentEvent.message_id)
              if (messageId) {
                options.onAssistantDelta(messageId, contentEvent.delta)
              }
              break
            }
            case 'TEXT_MESSAGE_END': {
              const endEvent = event as TextMessageEndEvent
              const messageId = assistantMessageIds.get(endEvent.message_id)
              if (messageId) {
                options.onAssistantDone(messageId)
              }
              break
            }
            case 'TOOL_CALL_START': {
              const toolStart = event as ToolCallStartEvent
              const toolMessageId = generateId()
              toolCallIds.set(toolStart.tool_call_id, toolMessageId)
              options.onToolCallStart({
                kind: 'tool_call',
                id: toolMessageId,
                toolCallId: toolStart.tool_call_id,
                name: toolStart.name,
                arguments:
                  typeof toolStart.arguments === 'string'
                    ? toolStart.arguments
                    : toolStart.arguments
                      ? JSON.stringify(toolStart.arguments, null, 2)
                      : '',
                streaming: true,
              })
              break
            }
            case 'TOOL_CALL_ARGS': {
              const toolArgs = event as ToolCallArgsEvent
              const toolMessageId = toolCallIds.get(toolArgs.tool_call_id)
              if (toolMessageId) {
                options.onToolCallArgs(toolMessageId, toolArgs.delta)
              }
              break
            }
            case 'TOOL_CALL_END': {
              const toolEnd = event as ToolCallEndEvent
              const toolMessageId = toolCallIds.get(toolEnd.tool_call_id)
              if (toolMessageId) {
                options.onToolCallEnd(toolMessageId, toolEnd.result, toolEnd.error)
              }
              break
            }
            case 'ERROR': {
              // Server reported an error; stop streaming gracefully.
              setIsStreaming(false)
              break
            }
          }
        },
        onError: () => {
          setIsStreaming(false)
          abortRef.current = null
        },
        onDone: () => {
          setIsStreaming(false)
          abortRef.current = null
        },
      })
    },
    [options]
  )

  const stop = useCallback(() => {
    abortRef.current?.()
    abortRef.current = null
    setIsStreaming(false)
  }, [])

  return { sendMessage, stop, isStreaming }
}
