import { useCallback, useEffect, useState } from 'react'
import type { ChatMessage, Session } from '../types'

const STORAGE_KEY = 'agui-chat-sessions'

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Session[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveSessions(sessions: Session[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
  } catch {
    // ignore storage errors
  }
}

function makeTitle(content: string): string {
  const first = content.trim().split('\n')[0] ?? '新会话'
  return first.slice(0, 30) || '新会话'
}

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>(loadSessions)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  useEffect(() => {
    saveSessions(sessions)
  }, [sessions])

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null

  const createSession = useCallback(() => {
    const session: Session = {
      id: generateId(),
      title: '新会话',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    setSessions((prev) => [session, ...prev])
    setActiveSessionId(session.id)
    return session.id
  }, [])

  const deleteSession = useCallback((id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id))
    setActiveSessionId((current) => (current === id ? null : current))
  }, [])

  const renameSession = useCallback((id: string, title: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, title: title.slice(0, 60), updatedAt: Date.now() } : s))
    )
  }, [])

  const appendMessages = useCallback(
    (sessionId: string, messages: ChatMessage[], options?: { userContent?: string }) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s
          const nextMessages = [...s.messages, ...messages]
          const nextTitle =
            s.title === '新会话' && options?.userContent
              ? makeTitle(options.userContent)
              : s.title
          return {
            ...s,
            title: nextTitle,
            messages: nextMessages,
            updatedAt: Date.now(),
          }
        })
      )
    },
    []
  )

  const updateMessage = useCallback(
    (sessionId: string, messageId: string, updater: (msg: ChatMessage) => ChatMessage) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s
          return {
            ...s,
            messages: s.messages.map((m) => (m.id === messageId ? updater(m) : m)),
            updatedAt: Date.now(),
          }
        })
      )
    },
    []
  )

  return {
    sessions,
    activeSessionId,
    activeSession,
    setActiveSessionId,
    createSession,
    deleteSession,
    renameSession,
    appendMessages,
    updateMessage,
  }
}
