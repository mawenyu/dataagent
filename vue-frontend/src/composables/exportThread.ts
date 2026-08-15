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
}

export interface ExportableMessage {
  id?: string
  role: string
  content?: unknown
  toolCalls?: ExportableToolCall[]
  toolCallId?: string
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
    lines.push(`- **${name}** \`${args}\``)
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
      lines.push('## 👤 用户', '', userContentText(m.content), '')
    } else if (m.role === 'assistant') {
      lines.push('## 🤖 助手', '')
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

/** 导出文件名：标题净化（去掉文件系统非法字符）+ 会话 id 前 8 位。 */
export function exportFilename(thread: { id: string; title: string }): string {
  const safeTitle = thread.title
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  const base = safeTitle || thread.id.slice(0, 8)
  return `${base}-${thread.id.slice(0, 8)}.md`
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
