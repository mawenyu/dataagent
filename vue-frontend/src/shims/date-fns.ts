/**
 * 瘦身(2026-08-17): date-fns mini shim(25.7KB gz → ~1KB)。
 *
 * 唯一消费方 = @a2ui/web_core basic_functions 的 FormatDate(`import { format } from 'date-fns'`,
 * basic_functions.js:316 `format(date, args.format)`);vite resolve.alias 把精确名 'date-fns'
 * 指到本文件。覆盖 agent 可能下发的常用 token(yyyy/yy/M/MM/MMM/MMMM/d/dd/E..EEE/H/HH/h/hh/m/mm/s/ss/a),
 * 语义对齐 date-fns v4 默认 en locale;未识别字符原样透传,单引号字面量原样输出。
 * 契约见 src/shims/date-fns.test.ts。
 */

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const pad2 = (n: number) => String(n).padStart(2, '0')

/** 最长匹配优先的 token 表。 */
const TOKENS: Array<[string, (d: Date) => string]> = [
  ['yyyy', (d) => String(d.getFullYear())],
  ['yy', (d) => pad2(d.getFullYear() % 100)],
  ['MMMM', (d) => MONTHS_LONG[d.getMonth()]!],
  ['MMM', (d) => MONTHS_SHORT[d.getMonth()]!],
  ['MM', (d) => pad2(d.getMonth() + 1)],
  ['M', (d) => String(d.getMonth() + 1)],
  ['dd', (d) => pad2(d.getDate())],
  ['d', (d) => String(d.getDate())],
  ['EEEE', (d) => DAYS_LONG[d.getDay()]!],
  ['EEE', (d) => DAYS_SHORT[d.getDay()]!],
  ['HH', (d) => pad2(d.getHours())],
  ['H', (d) => String(d.getHours())],
  ['hh', (d) => pad2(d.getHours() % 12 || 12)],
  ['h', (d) => String(d.getHours() % 12 || 12)],
  ['mm', (d) => pad2(d.getMinutes())],
  ['m', (d) => String(d.getMinutes())],
  ['ss', (d) => pad2(d.getSeconds())],
  ['s', (d) => String(d.getSeconds())],
  ['a', (d) => (d.getHours() < 12 ? 'am' : 'pm')],
]

/** date-fns format() 常用子集: 支持上表 token + '...' 字面量,其余字符原样透传。 */
export function format(date: Date, formatStr: string): string {
  let out = ''
  let i = 0
  while (i < formatStr.length) {
    const ch = formatStr[i]!
    if (ch === "'") {
      // 单引号字面量('' 转义为单引号)
      const end = formatStr.indexOf("'", i + 1)
      if (end === -1) { i++; continue }
      out += formatStr.slice(i + 1, end)
      i = end + 1
      continue
    }
    let matched = false
    for (const [tok, fn] of TOKENS) {
      if (formatStr.startsWith(tok, i)) {
        out += fn(date)
        i += tok.length
        matched = true
        break
      }
    }
    if (!matched) { out += ch; i++ }
  }
  return out
}
