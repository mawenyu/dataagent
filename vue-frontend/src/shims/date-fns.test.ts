import { describe, expect, it } from 'vitest'
import { format } from './date-fns'

/**
 * 瘦身(2026-08-17): date-fns mini shim 契约。
 * 唯一消费方 = @a2ui/web_core basic_functions 的 FormatDate(vite alias '^date-fns$' 指到本 shim),
 * 覆盖 agent 可能下发的常用 token;语义对齐 date-fns v4(en locale)。
 */

const D = new Date(2026, 7, 17, 15, 4, 5) // 2026-08-17 15:04:05 周一
const D_AM = new Date(2026, 0, 2, 9, 8, 3) // 2026-01-02 09:08:03 周五

describe('shims/date-fns format', () => {
  it('ISO 常用格式', () => {
    expect(format(D, 'yyyy-MM-dd')).toBe('2026-08-17')
    expect(format(D, 'yyyy-MM-dd HH:mm:ss')).toBe('2026-08-17 15:04:05')
    expect(format(D_AM, 'yyyy-MM-dd HH:mm:ss')).toBe('2026-01-02 09:08:03')
  })

  it('单位数 token 不补零 / 双位补零', () => {
    expect(format(D_AM, 'yyyy-M-d H:m:s')).toBe('2026-1-2 9:8:3')
    expect(format(D, 'yy-MM-dd')).toBe('26-08-17')
  })

  it('英文月名/星期名(en locale 对齐 date-fns 默认)', () => {
    expect(format(D, 'MMM d, yyyy')).toBe('Aug 17, 2026')
    expect(format(D, 'MMMM d, yyyy')).toBe('August 17, 2026')
    expect(format(D, 'EEE, MMM d')).toBe('Mon, Aug 17')
    expect(format(D_AM, 'EEEE, MMMM d')).toBe('Friday, January 2')
  })

  it('12 小时制 + am/pm', () => {
    expect(format(D, 'h:mm a')).toBe('3:04 pm')
    expect(format(D_AM, 'hh:mm a')).toBe('09:08 am')
    expect(format(new Date(2026, 0, 1, 0, 0, 0), 'h a')).toBe('12 am')
    expect(format(new Date(2026, 0, 1, 12, 0, 0), 'h a')).toBe('12 pm')
  })

  it('单引号字面量原样输出,未识别字符原样透传', () => {
    expect(format(D, "yyyy年MM月dd日")).toBe('2026年08月17日')
    expect(format(D, "yyyy-MM-dd 'at' HH:mm")).toBe('2026-08-17 at 15:04')
  })
})
