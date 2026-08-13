// AG-UI protocol event types for the /agent/run SSE stream.

export interface AgentRunRequest {
  input: AgentInputItem[]
  session_id?: string
}

export type AgentInputItem = {
  type: 'TEXT_MESSAGE'
  role: MessageRole
  content: string
}

/** Server-sent event from /agent/run */
export interface AgentEvent {
  type: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

export interface TextMessageStartEvent extends AgentEvent {
  type: 'TEXT_MESSAGE_START'
  message_id: string
  role: 'assistant'
}

export interface TextMessageContentEvent extends AgentEvent {
  type: 'TEXT_MESSAGE_CONTENT'
  message_id: string
  delta: string
  content?: string
}

export interface TextMessageEndEvent extends AgentEvent {
  type: 'TEXT_MESSAGE_END'
  message_id: string
}

export interface ToolCallStartEvent extends AgentEvent {
  type: 'TOOL_CALL_START'
  tool_call_id: string
  name: string
  arguments?: string | Record<string, unknown>
}

export interface ToolCallArgsEvent extends AgentEvent {
  type: 'TOOL_CALL_ARGS'
  tool_call_id: string
  delta: string
  arguments?: string | Record<string, unknown>
}

export interface ToolCallEndEvent extends AgentEvent {
  type: 'TOOL_CALL_END'
  tool_call_id: string
  result?: unknown
  error?: string
}

export interface ErrorEvent extends AgentEvent {
  type: 'ERROR'
  message: string
}

// Domain model used by the UI.

export type MessageRole = 'user' | 'assistant' | 'system'

export interface TextMessage {
  kind: 'text'
  id: string
  role: MessageRole
  content: string
  streaming?: boolean
}

export interface ToolCallMessage {
  kind: 'tool_call'
  id: string
  toolCallId: string
  name: string
  arguments: string
  result?: unknown
  error?: string
  streaming?: boolean
}

export type ChatMessage = TextMessage | ToolCallMessage

export interface Session {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}
