/**
 * P-C: 文件在线预览的纯函数层。
 * - parseCsvPreview: 引号感知的 CSV 解析（预览用；编辑链路的简易 parser 在
 *   spreadsheetEdits.ts,行为契约不同,不动）
 * - prettyJson: 合法 JSON 美化,非法原样返回
 * - renderMarkdownLite: 轻量 Markdown → HTML。安全模型: 先整体 HTML 转义,
 *   再在转义后的文本上做 Markdown 变换,链接仅放行 http/https/mailto ——
 *   产物可安全用于 v-html。
 */

const PREVIEWABLE = new Set(['csv', 'json', 'md', 'txt', 'log', 'tsv'])

/** P32: 图片扩展名 —— 预览走 <img src=下载URL> 直渲（浏览器流式解码，不按文本拉内容）。 */
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico'])

function extOf(name: string): string {
  const idx = name.lastIndexOf('.')
  return idx < 0 ? '' : name.slice(idx + 1).toLowerCase()
}

export function isImage(name: string): boolean {
  return IMAGE_EXTS.has(extOf(name))
}

export function isPreviewable(name: string): boolean {
  return PREVIEWABLE.has(extOf(name)) || isImage(name)
}

/** 引号感知 CSV 解析：支持 ".." 内含逗号/换行、"" 转义、CRLF 归一、空行忽略。 */
export function parseCsvPreview(text: string): string[][] {
  const src = text.replace(/\r\n?/g, '\n')
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  let rowHasContent = false

  const pushField = () => {
    row.push(field)
    field = ''
    rowHasContent = true
  }
  const pushRow = () => {
    if (rowHasContent && !(row.length === 1 && row[0] === '')) rows.push(row)
    row = []
    rowHasContent = false
  }

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"' && field === '') {
      inQuotes = true
    } else if (ch === ',') {
      pushField()
    } else if (ch === '\n') {
      pushField()
      pushRow()
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length > 0) {
    pushField()
    pushRow()
  }
  return rows
}

export function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 行内变换（输入已是转义文本）：`code`、**bold**、*italic*、[text](safe-url)。 */
function inlineMd(escaped: string): string {
  let out = escaped
  out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>')
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
  out = out.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) => {
    // 转义后 & 已成 &amp;;还原比较协议。仅 http/https/mailto 放行
    const raw = url.replace(/&amp;/g, '&')
    if (/^(https?:\/\/|mailto:)/i.test(raw)) {
      return `<a href="${raw}" target="_blank" rel="noopener noreferrer">${text}</a>`
    }
    return text
  })
  return out
}

/**
 * 轻量 Markdown 渲染： fenced code / 标题 / GFM 表格 / 无序列表 / 行内样式。
 * 不支持的一律按段落文本输出（先转义,绝无 HTML 注入）。
 */
export function renderMarkdownLite(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let i = 0
  let para: string[] = []

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${para.map(inlineMd).join('<br>')}</p>`)
      para = []
    }
  }

  while (i < lines.length) {
    const line = lines[i]

    // fenced code block
    if (line.trimStart().startsWith('```')) {
      flushPara()
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        buf.push(lines[i])
        i++
      }
      i++ // skip closing fence
      out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`)
      continue
    }

    // GFM table: header 行 + |---| 分隔行
    if (line.trimStart().startsWith('|') && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      flushPara()
      const splitRow = (l: string) =>
        l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      const header = splitRow(line)
      i += 2
      const bodyRows: string[][] = []
      while (i < lines.length && lines[i].trimStart().startsWith('|')) {
        bodyRows.push(splitRow(lines[i]))
        i++
      }
      const th = header.map((c) => `<th>${inlineMd(escapeHtml(c))}</th>`).join('')
      const trs = bodyRows
        .map((r) => `<tr>${r.map((c) => `<td>${inlineMd(escapeHtml(c))}</td>`).join('')}</tr>`)
        .join('')
      out.push(`<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`)
      continue
    }

    // heading
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      flushPara()
      const level = h[1].length
      out.push(`<h${level}>${inlineMd(escapeHtml(h[2].trim()))}</h${level}>`)
      i++
      continue
    }

    // unordered list block
    if (/^\s*[-*]\s+/.test(line)) {
      flushPara()
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''))
        i++
      }
      out.push(`<ul>${items.map((it) => `<li>${inlineMd(escapeHtml(it))}</li>`).join('')}</ul>`)
      continue
    }

    if (line.trim() === '') {
      flushPara()
      i++
      continue
    }
    para.push(escapeHtml(line))
    i++
  }
  flushPara()
  return out.join('\n')
}
