import { describe, expect, it, vi } from 'vitest'
import { applyEdits, applySpreadsheetEdits, parseCsv, serializeCsv } from './spreadsheetEdits'

/**
 * task5-B4 spreadsheet（spec: docs/spec/copilotkit-capabilities.md B4）：
 * CSV 解析/序列化、单元格变更应用、agent HITL handler 的纯函数单测。
 */

describe('parseCsv / serializeCsv', () => {
  it('round-trips simple CSV（无引号转义）', () => {
    const text = '区域,销售额\n华北,388082\n华南,256061\n'
    const rows = parseCsv(text)
    expect(rows).toEqual([['区域', '销售额'], ['华北', '388082'], ['华南', '256061']])
    expect(serializeCsv(rows)).toBe(text)
  })

  it('忽略末尾空行，兼容 CRLF', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']])
  })
})

describe('applyEdits', () => {
  it('覆盖既有单元格', () => {
    const next = applyEdits('区域,销售额\n华北,100\n', [{ row: 1, col: 1, value: '150' }])
    expect(next).toBe('区域,销售额\n华北,150\n')
  })

  it('越界行：自动追加新行（行间补空行）', () => {
    const next = applyEdits('a,b\n1,2\n', [{ row: 3, col: 0, value: 'x' }])
    // 中间被跳过的行补为空行（序列化为空字符串，解析回 ['']）
    expect(parseCsv(next)).toEqual([['a', 'b'], ['1', '2'], [''], ['x']])
  })

  it('越界列：既有行自动补空列', () => {
    const next = applyEdits('a,b\n1,2\n', [{ row: 0, col: 3, value: 'd' }])
    expect(parseCsv(next)[0]).toEqual(['a', 'b', '', 'd'])
  })

  it('非法坐标（负数/非整数）抛错', () => {
    expect(() => applyEdits('a,b\n', [{ row: -1, col: 0, value: 'x' }])).toThrow()
    expect(() => applyEdits('a,b\n', [{ row: 0, col: 1.5, value: 'x' }])).toThrow()
  })
})

describe('applySpreadsheetEdits（agent frontend tool handler）', () => {
  const deps = (current: string | null, confirmResult: boolean) => ({
    readFile: vi.fn().mockResolvedValue(current),
    saveFile: vi.fn().mockResolvedValue(undefined),
    confirm: vi.fn().mockReturnValue(confirmResult),
  })

  it('用户确认 → 落盘并返回已应用 N 处', async () => {
    const d = deps('区域,销售额\n华北,100\n', true)
    const msg = await applySpreadsheetEdits(
      { file: 'sales.csv', cells: [{ row: 1, col: 1, value: '150' }], summary: '修正华北数据' },
      d,
    )
    expect(d.confirm).toHaveBeenCalledOnce()
    expect(d.confirm.mock.calls[0][0]).toContain('sales.csv')
    expect(d.confirm.mock.calls[0][0]).toContain('1 处变更')
    expect(d.confirm.mock.calls[0][0]).toContain('修正华北数据')
    expect(d.saveFile).toHaveBeenCalledWith('sales.csv', '区域,销售额\n华北,150\n')
    expect(msg).toBe('已应用 1 处变更到 sales.csv')
  })

  it('用户取消 → 不落盘', async () => {
    const d = deps('a,b\n', false)
    const msg = await applySpreadsheetEdits({ file: 'f.csv', cells: [{ row: 0, col: 0, value: 'x' }] }, d)
    expect(d.saveFile).not.toHaveBeenCalled()
    expect(msg).toBe('用户取消了变更')
  })

  it('读不到文件 → 返回失败且不弹确认', async () => {
    const d = deps(null, true)
    const msg = await applySpreadsheetEdits({ file: 'ghost.csv', cells: [{ row: 0, col: 0, value: 'x' }] }, d)
    expect(msg).toContain('失败')
    expect(d.confirm).not.toHaveBeenCalled()
    expect(d.saveFile).not.toHaveBeenCalled()
  })

  it('非法坐标 → 返回变更无效且不弹确认', async () => {
    const d = deps('a,b\n', true)
    const msg = await applySpreadsheetEdits({ file: 'f.csv', cells: [{ row: -1, col: 0, value: 'x' }] }, d)
    expect(msg).toContain('变更无效')
    expect(d.saveFile).not.toHaveBeenCalled()
  })

  it('空 cells → 短路返回', async () => {
    const d = deps('a,b\n', true)
    const msg = await applySpreadsheetEdits({ file: 'f.csv', cells: [] }, d)
    expect(d.readFile).not.toHaveBeenCalled()
    expect(msg).toContain('没有')
  })
})
