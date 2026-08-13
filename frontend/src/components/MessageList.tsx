import React, { useEffect, useRef } from 'react'
import { MessageItem } from './MessageItem'
import type { ChatMessage } from '../types'

interface MessageListProps {
  messages: ChatMessage[]
}

export const MessageList: React.FC<MessageListProps> = ({ messages }) => {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (messages.length === 0) {
    return (
      <div className="empty-chat">
        <div>开始一段新对话</div>
        <div style={{ fontSize: 12, opacity: 0.7 }}>输入消息，AI 会通过 SSE 流式响应</div>
      </div>
    )
  }

  return (
    <div className="message-list">
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
