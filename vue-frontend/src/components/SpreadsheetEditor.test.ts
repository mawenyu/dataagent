import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import SpreadsheetEditor from './SpreadsheetEditor.vue'

/**
 * task5-B4 spreadsheet 编辑器（spec: docs/spec/copilotkit-capabilities.md B4）：
 * CSV → 可编辑表格渲染 / contenteditable 编辑后保存走 PUT / 加行加列 / 脏标记。
 */

const CSV = '区域,销售额\n华北,100\n华南,200\n'

function mockPutThenRefresh() {
  return vi.fn()
    .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ name: 'sales.csv', size: 30 }) }) // PUT
    .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ files: [] }) }) // refresh list
}

describe('SpreadsheetEditor (task5-B4)', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('把 CSV 渲染为表格：首行表头 + 数据行', () => {
    vi.stubGlobal('fetch', vi.fn())
    const wrapper = mount(SpreadsheetEditor, { props: { name: 'sales.csv', content: CSV } })
    const editor = wrapper.find('[data-testid="spreadsheet-editor"]')
    expect(editor.exists()).toBe(true)
    const headers = wrapper.findAll('th')
    expect(headers.map((h) => h.text())).toEqual(['区域', '销售额'])
    const rows = wrapper.findAll('tbody tr')
    expect(rows.length).toBe(2)
    expect(wrapper.find('[data-testid="cell-1-0"]').text()).toBe('华北')
    expect(wrapper.find('[data-testid="cell-2-1"]').text()).toBe('200')
    // 未编辑时不显示脏标记
    expect(wrapper.find('[data-testid="dirty-mark"]').exists()).toBe(false)
  })

  it('contenteditable 编辑后保存调用 PUT，body 含新值', async () => {
    const fetchMock = mockPutThenRefresh()
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(SpreadsheetEditor, { props: { name: 'sales.csv', content: CSV } })
    const cell = wrapper.find('[data-testid="cell-1-1"]')
    cell.element.textContent = '150'
    await cell.trigger('blur')
    // 出现脏标记
    expect(wrapper.find('[data-testid="dirty-mark"]').exists()).toBe(true)
    await wrapper.find('[data-testid="save-btn"]').trigger('click')
    await nextTick(); await nextTick(); await nextTick()
    const putCall = fetchMock.mock.calls[0]
    expect(putCall[0]).toBe('/agui-api/files/sales.csv')
    expect(putCall[1].method).toBe('PUT')
    expect(putCall[1].body).toContain('华北,150')
    expect(putCall[1].body).toContain('华南,200')
    // 保存成功后 emit saved 并刷新列表
    expect(wrapper.emitted('saved')).toBeTruthy()
    expect(fetchMock).toHaveBeenLastCalledWith('/agui-api/files')
  })

  it('加行按钮行数 +1，加列按钮列数 +1', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const wrapper = mount(SpreadsheetEditor, { props: { name: 'sales.csv', content: CSV } })
    expect(wrapper.findAll('tbody tr').length).toBe(2)
    await wrapper.find('[data-testid="add-row-btn"]').trigger('click')
    expect(wrapper.findAll('tbody tr').length).toBe(3)
    await wrapper.find('[data-testid="add-col-btn"]').trigger('click')
    expect(wrapper.findAll('th').length).toBe(3)
  })

  it('关闭按钮 emit close', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const wrapper = mount(SpreadsheetEditor, { props: { name: 'sales.csv', content: CSV } })
    await wrapper.find('[data-testid="close-editor-btn"]').trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })
})
