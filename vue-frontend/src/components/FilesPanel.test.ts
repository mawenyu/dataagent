import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import FilesPanel from './FilesPanel.vue'

/**
 * workspace 文件面板（spec: docs/spec/workspace-files.md）：
 * 列表渲染 / 预览 / 上传(multipart) / 下载链接 / 删除确认。
 */
function mockFetchOnce(body: any, init?: { ok?: boolean; status?: number }) {
  return vi.fn().mockResolvedValue({
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve(new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body)).buffer),
  })
}

const FILE_LIST = {
  files: [
    { name: 'sales-2026-08.csv', size: 4096, modifiedAt: '2026-08-15T01:00:00Z' },
    { name: 'notes.md', size: 128, modifiedAt: '2026-08-14T09:00:00Z' },
  ],
}

describe('FilesPanel (task5-A workspace 文件管理)', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('renders the file list with name/size', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(FILE_LIST))
    const wrapper = mount(FilesPanel)
    await nextTick(); await nextTick(); await nextTick()
    expect(wrapper.text()).toContain('sales-2026-08.csv')
    expect(wrapper.text()).toContain('4.0 KB')
    expect(wrapper.text()).toContain('notes.md')
  })

  it('previews file content on click', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(FILE_LIST) })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new TextEncoder().encode('区域,销售额\n华北,388082').buffer),
      })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(FilesPanel)
    await nextTick(); await nextTick(); await nextTick()
    await wrapper.find('[data-file="sales-2026-08.csv"] .file-name').trigger('click')
    await nextTick(); await nextTick()
    expect(fetchMock).toHaveBeenLastCalledWith('/agui-api/files/sales-2026-08.csv')
    expect(wrapper.find('[data-testid="file-preview"]').text()).toContain('华北,388082')
  })

  it('uploads via multipart POST and refreshes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(FILE_LIST) }) // initial list
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ name: 'up.csv', size: 3 }) }) // upload
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ files: [...FILE_LIST.files, { name: 'up.csv', size: 3, modifiedAt: '2026-08-15T02:00:00Z' }] }) }) // refresh
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(FilesPanel)
    await nextTick(); await nextTick(); await nextTick()
    const input = wrapper.find('[data-testid="file-input"]')
    const file = new File(['a,b'], 'up.csv', { type: 'text/csv' })
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await nextTick(); await nextTick(); await nextTick()
    const uploadCall = fetchMock.mock.calls[1]
    expect(uploadCall[0]).toBe('/agui-api/files')
    expect(uploadCall[1].method).toBe('POST')
    expect(uploadCall[1].body).toBeInstanceOf(FormData)
    expect(wrapper.text()).toContain('up.csv')
  })

  it('deletes after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(FILE_LIST) })
      .mockResolvedValueOnce({ ok: true, status: 204 })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ files: [FILE_LIST.files[1]] }) })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(FilesPanel)
    await nextTick(); await nextTick(); await nextTick()
    await wrapper.find('[data-testid="del-sales-2026-08.csv"]').trigger('click')
    await nextTick(); await nextTick(); await nextTick()
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE')
    expect(wrapper.text()).not.toContain('sales-2026-08.csv')
  })

  it('download link points at the files API', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(FILE_LIST))
    const wrapper = mount(FilesPanel)
    await nextTick(); await nextTick(); await nextTick()
    const link = wrapper.find('a.act')
    expect(link.attributes('href')).toBe('/agui-api/files/sales-2026-08.csv')
  })

  // task5-B4: CSV 文件行有"编辑"入口，点击后读内容并打开表格编辑器
  it('csv rows offer an edit button that opens the spreadsheet editor', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(FILE_LIST) }) // initial list
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new TextEncoder().encode('区域,销售额\n华北,100').buffer),
      }) // readFile for editor
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(FilesPanel)
    await nextTick(); await nextTick(); await nextTick()
    // .csv 行有编辑按钮，.md 行没有
    expect(wrapper.find('[data-testid="edit-sales-2026-08.csv"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="edit-notes.md"]').exists()).toBe(false)
    await wrapper.find('[data-testid="edit-sales-2026-08.csv"]').trigger('click')
    await nextTick(); await nextTick()
    expect(fetchMock).toHaveBeenLastCalledWith('/agui-api/files/sales-2026-08.csv')
    expect(wrapper.find('[data-testid="spreadsheet-editor"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="spreadsheet-editor"]').text()).toContain('华北')
  })
})

describe('FilesPanel (task6 会话隔离)', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('传入 threadId 后列表按会话加载，切换会话重新加载', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ files: [{ name: 't1-only.csv', size: 5, modifiedAt: '2026-08-15T01:00:00Z' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ files: [{ name: 't2-only.csv', size: 6, modifiedAt: '2026-08-15T01:00:00Z' }] }),
      })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(FilesPanel, { props: { threadId: 'thread-1' } })
    await nextTick(); await nextTick(); await nextTick()
    expect(fetchMock).toHaveBeenLastCalledWith('/agui-api/chat/threads/thread-1/files')
    expect(wrapper.text()).toContain('t1-only.csv')

    await wrapper.setProps({ threadId: 'thread-2' })
    await nextTick(); await nextTick(); await nextTick()
    expect(fetchMock).toHaveBeenLastCalledWith('/agui-api/chat/threads/thread-2/files')
    expect(wrapper.text()).toContain('t2-only.csv')
    expect(wrapper.text()).not.toContain('t1-only.csv')
  })
})
