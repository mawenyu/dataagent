import React from 'react'
import type { Session } from '../types'

interface SessionListProps {
  sessions: Session[]
  activeSessionId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()

  if (isToday) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

export const SessionList: React.FC<SessionListProps> = ({
  sessions,
  activeSessionId,
  onSelect,
  onDelete,
}) => {
  if (sessions.length === 0) {
    return <div className="empty-sidebar">暂无会话</div>
  }

  return (
    <ul className="session-list">
      {sessions.map((session) => (
        <li
          key={session.id}
          className={`session-item ${session.id === activeSessionId ? 'active' : ''}`}
          onClick={() => onSelect(session.id)}
        >
          <span className="session-title" title={session.title}>
            {session.title}
          </span>
          <span className="session-time">{formatTime(session.updatedAt)}</span>
          <button
            className="delete-session-btn"
            title="删除会话"
            onClick={(e) => {
              e.stopPropagation()
              onDelete(session.id)
            }}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  )
}
