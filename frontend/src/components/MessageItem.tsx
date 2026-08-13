import React from 'react'
import { MarkdownRenderer } from './MarkdownRenderer'
import type { ChatMessage } from '../types'

interface MessageItemProps {
  message: ChatMessage
}

export const MessageItem: React.FC<MessageItemProps> = ({ message }) => {
  if (message.kind === 'tool_call') {
    const status = message.error ? 'error' : message.streaming ? 'running' : 'success'
    return (
      <div className="tool-call">
        <div className="tool-call-card">
          <div className="tool-call-header">
            <span className="tool-call-name">{message.name}</span>
            <span className={`tool-call-status ${status}`}>
              {message.streaming ? '运行中' : message.error ? '失败' : '完成'}
            </span>
          </div>
          <div className="tool-call-section">
            <div className="tool-call-section-label">参数</div>
            <pre className="tool-call-code">{message.arguments || '(无参数)'}</pre>
          </div>
          {message.result !== undefined && (
            <div className="tool-call-section">
              <div className="tool-call-section-label">结果</div>
              <pre className="tool-call-code">
                {typeof message.result === 'string'
                  ? message.result
                  : JSON.stringify(message.result, null, 2)}
              </pre>
            </div>
          )}
          {message.error && (
            <div className="tool-call-section">
              <div className="tool-call-section-label">错误</div>
              <pre className="tool-call-code">{message.error}</pre>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={`message ${message.role}`}>
      <div className={`avatar ${message.role}`}>
        {message.role === 'user' ? '我' : 'AI'}
      </div>
      <div className="bubble">
        <MarkdownRenderer content={message.content} />
        {message.streaming && (
          <span className="streaming-dot" />
        )}
      </div>
    </div>
  )
}
