/**
 * task5-B4 spreadsheet（spec: docs/spec/copilotkit-capabilities.md B4）。
 *
 * CSV 解析/序列化 + 单元格变更应用 + agent frontend tool 的 HITL handler，
 * 全部抽成纯函数（依赖注入 readFile/saveFile/confirm），便于脱离组件单测。
 *
 * 注意：workspace 数据文件均为简单 CSV，这里只做逗号分割，不处理引号转义。
 */

/** 一处单元格变更；row/col 从 0 开始（第 0 行是表头）。 */
export interface CellEdit { row: number; col: number; value: string }

/** 解析 CSV 文本为二维数组；忽略末尾空行，兼容 CRLF。 */
export function parseCsv(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  if (lines.length === 0) return []
  return lines.map((l) => l.split(','))
}

/** 序列化回 CSV 文本（非空时以换行结尾，与上传的数据文件风格一致）。 */
export function serializeCsv(rows: string[][]): string {
  if (rows.length === 0) return ''
  return rows.map((r) => r.join(',')).join('\n') + '\n'
}

/**
 * 把 cells 变更应用到 CSV 文本，返回新文本。
 * 越界语义：row 超出现有行数 → 自动追加新行（中间补空行）；
 *           col 超出行宽 → 该行补空列；负数/非整数坐标 → 抛错（调用方应拒绝落盘）。
 */
export function applyEdits(csvText: string, cells: CellEdit[]): string {
  const rows = parseCsv(csvText)
  for (const c of cells) {
    if (!Number.isInteger(c.row) || !Number.isInteger(c.col) || c.row < 0 || c.col < 0) {
      throw new Error(`非法单元格坐标 row=${c.row}, col=${c.col}`)
    }
    while (rows.length <= c.row) rows.push([])
    const r = rows[c.row]
    while (r.length <= c.col) r.push('')
    r[c.col] = c.value
  }
  return serializeCsv(rows)
}

export interface ApplyEditsArgs { file: string; cells: CellEdit[]; summary?: string }

/** handler 的外部副作用，全部注入以便测试。 */
export interface ApplyEditsDeps {
  /** 读 workspace 文件当前内容；读不到返回 null。 */
  readFile: (name: string) => Promise<string | null>
  /** PUT 落盘（覆盖写）。 */
  saveFile: (name: string, content: string) => Promise<void>
  /** HITL 确认（浏览器 confirm 对话框）；返回 false = 用户取消。 */
  confirm: (message: string) => boolean
}

/**
 * frontend tool `applySpreadsheetEdits` 的 handler：
 * 读当前内容 → 应用变更 → 用户确认（HITL）→ 落盘。任一环失败都不改文件。
 */
export async function applySpreadsheetEdits(args: ApplyEditsArgs, deps: ApplyEditsDeps): Promise<string> {
  if (!args.cells || args.cells.length === 0) return '没有任何变更需要应用'
  const current = await deps.readFile(args.file)
  if (current == null) return `读取文件 ${args.file} 失败，未做任何修改`
  let next: string
  try {
    next = applyEdits(current, args.cells)
  } catch (e: any) {
    return `变更无效：${e?.message ?? e}，未做任何修改`
  }
  const ok = deps.confirm(
    `agent 要修改 ${args.file}：${args.cells.length} 处变更。${args.summary ? args.summary + ' ' : ''}确认应用？`,
  )
  if (!ok) return '用户取消了变更'
  await deps.saveFile(args.file, next)
  return `已应用 ${args.cells.length} 处变更到 ${args.file}`
}
