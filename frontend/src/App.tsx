import React, { useEffect } from 'react'
import { SessionList } from './components/SessionList'
import { MessageList } from './components/MessageList'
import { ChatInput } from './components/ChatInput'
import { useSessions } from './hooks/useSessions'
import { useChat } from './hooks/useChat'
import type { ChatMessage } from './types'
import './styles.css'

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

const App: React.FC = () => {
  const {
    sessions,
    activeSessionId,
    activeSession,
    setActiveSessionId,
    createSession,
    deleteSession,
    appendMessages,
    updateMessage,
  } = useSessions()

  useEffect(() => {
    if (!activeSessionId && sessions.length === 0) {
      createSession()
    }
  }, [activeSessionId, sessions.length, createSession])

  const handleUserMessage = (content: string) => {
    if (!activeSession) return
    const userMessage: ChatMessage = {
      kind: 'text',
      id: generateId(),
      role: 'user',
      content,
    }
    appendMessages(activeSession.id, [userMessage], { userContent: content })
  }

  const handleAssistantDelta = (messageId: string, delta: string) => {
    if (!activeSession) return
    const exists = activeSession.messages.some((m) => m.id === messageId)
    if (!exists) {
      const assistantMessage: ChatMessage = {
        kind: 'text',
        id: messageId,
        role: 'assistant',
        content: delta,
        streaming: true,
      }
      appendMessages(activeSession.id, [assistantMessage])
    } else {
      updateMessage(activeSession.id, messageId, (msg) => {
        if (msg.kind !== 'text') return msg
        return { ...msg, content: msg.content + delta }
      })
    }
  }

  const handleAssistantDone = (messageId: string) => {
    if (!activeSession) return
    updateMessage(activeSession.id, messageId, (msg) => {
      if (msg.kind !== 'text') return msg
      return { ...msg, streaming: false }
    })
  }

  const handleToolCallStart = (toolCall: ChatMessage) => {
    if (!activeSession) return
    appendMessages(activeSession.id, [toolCall])
  }

  const handleToolCallArgs = (toolMessageId: string, delta: string) => {
    if (!activeSession) return
    updateMessage(activeSession.id, toolMessageId, (msg) => {
      if (msg.kind !== 'tool_call') return msg
      return { ...msg, arguments: msg.arguments + delta }
    })
  }

  const handleToolCallEnd = (
    toolMessageId: string,
    result?: unknown,
    error?: string
  ) => {
    if (!activeSession) return
    updateMessage(activeSession.id, toolMessageId, (msg) => {
      if (msg.kind !== 'tool_call') return msg
      return { ...msg, streaming: false, result, error }
    })
  }

  const { sendMessage, stop, isStreaming } = useChat({
    session: activeSession,
    onUserMessage: handleUserMessage,
    onAssistantDelta: handleAssistantDelta,
    onAssistantDone: handleAssistantDone,
    onToolCallStart: handleToolCallStart,
    onToolCallArgs: handleToolCallArgs,
    onToolCallEnd: handleToolCallEnd,
  })

  const canSend = Boolean(activeSession) && !isStreaming

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <button className="new-session-btn" onClick={createSession}>
            + 新会话
          </button>
        </div>
        <SessionList
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelect={setActiveSessionId}
          onDelete={deleteSession}
        />
      </aside>
      <main className="chat">
        <header className="chat-header">
          <h2>AG-UI Chat</h2>
          <p>
            {activeSession
              ? `${activeSession.title} · ${activeSession.messages.length} 条消息`
              : '请选择一个会话'}
          </p>
        </header>
        <MessageList messages={activeSession?.messages ?? []} />
        <ChatInput
          onSend={sendMessage}
          onStop={stop}
          disabled={!canSend}
          isStreaming={isStreaming}
        />
      </main>
    </div>
  )
}

export default App
