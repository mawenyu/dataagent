import React, { useState, useRef, useEffect } from 'react'

interface ChatInputProps {
  onSend: (message: string) => void
  onStop: () => void
  disabled: boolean
  isStreaming: boolean
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSend,
  onStop,
  disabled,
  isStreaming,
}) => {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [value])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue('')
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  return (
    <div className="input-bar">
      <form className="input-form" onSubmit={handleSubmit}>
        <textarea
          ref={textareaRef}
          className="input-textarea"
          placeholder="输入消息...（Shift+Enter 换行）"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={1}
        />
        {isStreaming ? (
          <button type="button" className="stop-btn" onClick={onStop}>
            停止
          </button>
        ) : (
          <button type="submit" className="send-btn" disabled={disabled || !value.trim()}>
            发送
          </button>
        )}
      </form>
    </div>
  )
}
