/**
 * P-A: 会话导出为 Markdown（前端生成 Blob 下载，无服务端依赖）。
 *
 * 输入契约 = gateway /chat/threads/{id}/messages 的 AG-UI 形态消息：
 * - user / assistant / reasoning: content 为字符串（user 亦兼容多模态 parts）
 * - assistant.toolCalls: [{id, function:{name, arguments(JSON 字符串)}}]
 * - role=tool: {toolCallId, content} —— 按 toolCallId 与调用配对渲染摘要
 *
 * 消息无逐条时间戳（OpenCode 历史转换不含时间），时间信息取会话元数据
 * (createdAt/updatedAt) + 导出时间。
 */

export interface ExportableToolCall {
  id?: string
  function?: { name?: string; arguments?: string }
  /** P-M: gateway 转换层补齐(无则字段缺省,向后兼容) */
  durationMs?: number
  status?: string
}

export interface ExportableMessage {
  id?: string
  role: string
  content?: unknown
  toolCalls?: ExportableToolCall[]
  toolCallId?: string
  /** P-M: ISO 时间戳(gateway 取自 opencode time.created) */
  createdAt?: string
  /** P-M: 附件文件名清单(gateway 从 prompt 的 <attachments> 段还原) */
  attachments?: string[]
}

export interface ExportThreadMeta {
  id: string
  title: string
  createdAt?: string
  updatedAt?: string
}

/** 工具结果摘要截断阈值（完整对话 = 消息原文；工具输出可能极长，按摘要处理）。 */
const TOOL_RESULT_MAX = 500
/** 工具参数行内展示截断阈值。 */
const TOOL_ARGS_MAX = 120

function formatDateTime(iso: string | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** P-M: 消息小节时间(HH:mm:ss 本地时区)。 */
function formatTimePart(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** P-M: 工具耗时格式化(导出用,无 live 计时需求)。 */
function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const sec = Math.round((ms % 60_000) / 1000)
  return `${m}m ${sec}s`
}

/** P-M: 工具结果状态 → 人类可读徽标。 */
function toolStatusLabel(status: string | undefined): string | null {
  if (!status) return null
  switch (status) {
    case 'completed': return '✓ 完成'
    case 'error':
    case 'failed': return '✗ 失败'
    case 'running': return '⏳ 运行中'
    default: return status
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…(截断, 共 ${text.length} 字符)`
}

/** 用户消息 content 兼容多模态 parts：拼接文本 + 附件文件名标注。 */
function userContentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const texts: string[] = []
    const files: string[] = []
    for (const part of content) {
      if (!part || typeof part !== 'object') continue
      const p = part as Record<string, unknown>
      if (p.type === 'text' && typeof p.text === 'string') texts.push(p.text)
      const meta = p.metadata as Record<string, unknown> | undefined
      if (meta && typeof meta.filename === 'string' && meta.filename) files.push(meta.filename)
    }
    if (files.length) texts.push(`📎 附件：${files.join('、')}`)
    return texts.join('\n')
  }
  return content == null ? '' : String(content)
}

function renderToolCalls(
  toolCalls: ExportableToolCall[],
  resultsByCallId: Map<string, string>,
  consumedToolCallIds: Set<string>,
): string[] {
  const lines: string[] = ['', '**工具调用**', '']
  for (const tc of toolCalls) {
    const name = tc.function?.name || 'unknown'
    const args = truncate(tc.function?.arguments ?? '{}', TOOL_ARGS_MAX)
    let result: string | undefined
    if (tc.id && resultsByCallId.has(tc.id)) {
      result = resultsByCallId.get(tc.id)
      consumedToolCallIds.add(tc.id)
    }
    // P-M: 摘要行附耗时与结果状态(字段缺省则不渲染,兼容旧历史)
    const extras: string[] = []
    if (typeof tc.durationMs === 'number' && Number.isFinite(tc.durationMs)) {
      extras.push(formatDurationMs(tc.durationMs))
    }
    const statusLabel = toolStatusLabel(tc.status)
    if (statusLabel) extras.push(statusLabel)
    lines.push(`- **${name}** \`${args}\`${extras.length ? ' · ' + extras.join(' · ') : ''}`)
    lines.push(`  - ${result !== undefined ? `结果：${truncate(result, TOOL_RESULT_MAX)}` : '结果：无结果'}`)
  }
  return lines
}

export function buildThreadMarkdown(
  thread: ExportThreadMeta,
  messages: ExportableMessage[],
  exportedAt: Date,
): string {
  const resultsByCallId = new Map<string, string>()
  for (const m of messages) {
    if (m.role === 'tool' && m.toolCallId) {
      resultsByCallId.set(m.toolCallId, typeof m.content === 'string' ? m.content : String(m.content ?? ''))
    }
  }
  const consumedToolCallIds = new Set<string>()

  const lines: string[] = [
    `# 会话导出：${thread.title || thread.id}`,
    '',
    `- 会话 ID: ${thread.id}`,
    `- 创建时间: ${formatDateTime(thread.createdAt)}`,
    `- 最后更新: ${formatDateTime(thread.updatedAt)}`,
    `- 导出时间: ${formatDateTime(exportedAt.toISOString())}`,
    `- 消息数: ${messages.length}`,
    '',
    '---',
    '',
  ]

  for (const m of messages) {
    if (m.role === 'user') {
      const t = formatTimePart(m.createdAt)
      lines.push(`## 👤 用户${t ? ' · ' + t : ''}`, '', userContentText(m.content), '')
      if (m.attachments?.length) lines.push(`📎 附件：${m.attachments.join('、')}`, '')
    } else if (m.role === 'assistant') {
      const t = formatTimePart(m.createdAt)
      lines.push(`## 🤖 助手${t ? ' · ' + t : ''}`, '')
      const text = typeof m.content === 'string' ? m.content.trim() : userContentText(m.content).trim()
      if (text) lines.push(text, '')
      if (m.toolCalls?.length) {
        lines.push(...renderToolCalls(m.toolCalls, resultsByCallId, consumedToolCallIds), '')
      }
    } else if (m.role === 'reasoning') {
      const text = typeof m.content === 'string' ? m.content : String(m.content ?? '')
      lines.push('## 🧠 思考过程', '')
      for (const line of text.split('\n')) lines.push(`> ${line}`)
      lines.push('')
    } else if (m.role === 'tool') {
      // 已被助手工具调用配对消费的结果不再重复渲染；孤儿结果保留为独立小节
      if (m.toolCallId && consumedToolCallIds.has(m.toolCallId)) continue
      const text = typeof m.content === 'string' ? m.content : String(m.content ?? '')
      lines.push('## 🔧 工具输出', '', truncate(text, TOOL_RESULT_MAX), '')
    }
    // system 等其他角色跳过
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

/** 导出文件名：标题 slug（去文件系统非法字符）+ 会话 id 前 8 位 + 扩展名。 */
export function exportFilename(thread: { id: string; title: string }, ext: 'md' | 'json' = 'md'): string {
  const safeTitle = thread.title
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  const base = safeTitle || thread.id.slice(0, 8)
  return `${base}-${thread.id.slice(0, 8)}.${ext}`
}

/** 前端生成 Blob 触发浏览器下载。 */
export function downloadMarkdown(filename: string, markdown: string): void {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** P-M: 结构化 JSON 导出。 */
export interface ThreadJsonExport {
  thread: ExportThreadMeta & { title: string }
  exportedAt: string
  messageCount: number
  messages: NormalizedMessage[]
}

export interface NormalizedToolCall {
  id?: string
  name: string
  arguments?: string
  durationMs?: number
  status?: string
  /** 按 toolCallId 配对的结果文本(未配对则缺省) */
  result?: string
}

export interface NormalizedMessage {
  id?: string
  role: string
  content?: unknown
  createdAt?: string
  attachments?: string[]
  toolCalls?: NormalizedToolCall[]
  toolCallId?: string
}

/**
 * 结构化会话数据：线程元数据 + 逐消息（toolCall 归一 name/arguments 并
 * 按 toolCallId 配对结果文本）。下游可直接 JSON.parse 消费。
 */
export function buildThreadJson(
  thread: ExportThreadMeta,
  messages: ExportableMessage[],
  exportedAt: Date,
): ThreadJsonExport {
  const resultsByCallId = new Map<string, string>()
  for (const m of messages) {
    if (m.role === 'tool' && m.toolCallId) {
      resultsByCallId.set(m.toolCallId, typeof m.content === 'string' ? m.content : String(m.content ?? ''))
    }
  }
  const normalized: NormalizedMessage[] = messages.map((m) => {
    const out: NormalizedMessage = { id: m.id, role: m.role }
    if (m.content !== undefined) out.content = m.content
    if (m.createdAt) out.createdAt = m.createdAt
    if (m.attachments?.length) out.attachments = m.attachments
    if (m.toolCallId) out.toolCallId = m.toolCallId
    if (m.toolCalls?.length) {
      out.toolCalls = m.toolCalls.map((tc) => {
        const n: NormalizedToolCall = {
          id: tc.id,
          name: tc.function?.name || 'unknown',
          arguments: tc.function?.arguments,
        }
        if (typeof tc.durationMs === 'number') n.durationMs = tc.durationMs
        if (tc.status) n.status = tc.status
        if (tc.id && resultsByCallId.has(tc.id)) n.result = resultsByCallId.get(tc.id)
        return n
      })
    }
    return out
  })
  return {
    thread: { ...thread, title: thread.title || thread.id },
    exportedAt: exportedAt.toISOString(),
    messageCount: messages.length,
    messages: normalized,
  }
}

/** P-M: JSON Blob 下载。 */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
