import { readFileSync } from 'node:fs'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import FilesPanel from './FilesPanel.vue'

/**
 * workspace 文件面板（spec: docs/spec/workspace-files.md）：
 * 列表渲染 / 预览(P-C: Teleported modal) / 上传(multipart) / 下载链接 /
 * 删除(P-C: 两段确认,不再用原生 confirm)。
 */
function mockFetchOnce(body: any, init?: { ok?: boolean; status?: number }) {
  return vi.fn().mockResolvedValue({
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve(new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body)).buffer),
  })
}

function previewModal() {
  return document.body.querySelector('[data-testid="file-preview-modal"]')
}

const FILE_LIST = {
  files: [
    { name: 'sales-2026-08.csv', size: 4096, modifiedAt: '2026-08-15T01:00:00Z' },
    { name: 'notes.md', size: 128, modifiedAt: '2026-08-14T09:00:00Z' },
  ],
}

describe('FilesPanel (task5-A workspace 文件管理)', () => {
  beforeEach(() => { vi.restoreAllMocks() })
  afterEach(() => { document.body.innerHTML = '' })

  it('renders the file list with name/size', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(FILE_LIST))
    const wrapper = mount(FilesPanel)
    await nextTick(); await nextTick(); await nextTick()
    expect(wrapper.text()).toContain('sales-2026-08.csv')
    expect(wrapper.text()).toContain('4.0 KB')
    expect(wrapper.text()).toContain('notes.md')
  })

  it('P-C: 点文件名开预览 modal,csv 渲染为表格;ESC 关闭', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(FILE_LIST) })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new TextEncoder().encode('区域,销售额\n华北,388082').buffer),
      })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(FilesPanel, { attachTo: document.body })
    await nextTick(); await nextTick(); await nextTick()
    await wrapper.find('[data-file="sales-2026-08.csv"] .file-name').trigger('click')
    await nextTick(); await nextTick()
    expect(fetchMock).toHaveBeenLastCalledWith('/agui-api/files/sales-2026-08.csv')
    const dlg = previewModal()
    expect(dlg, '预览应开 modal(Teleport 到 body)').toBeTruthy()
    const table = dlg!.querySelector('[data-testid="file-preview-table"] table')!
    expect([...table.querySelectorAll('th')].map((e) => e.textContent)).toEqual(['区域', '销售额'])
    expect(table.textContent).toContain('388082')
    // ESC 关闭
    ;(document.body.querySelector('[data-testid="file-preview-overlay"]') as HTMLElement)
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(previewModal()).toBeNull()
    wrapper.unmount()
  })

  it('P-C: 不可预览类型(xlsx)给内联提示,不发预览请求', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ files: [{ name: 'book.xlsx', size: 9, modifiedAt: '2026-08-15T01:00:00Z' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(FilesPanel)
    await nextTick(); await nextTick(); await nextTick()
    await wrapper.find('[data-file="book.xlsx"] .file-name').trigger('click')
    await nextTick()
    expect(fetchMock).toHaveBeenCalledTimes(1) // 只有列表请求
    expect(wrapper.find('[data-testid="files-notice"]').text()).toContain('不支持在线预览')
    expect(previewModal()).toBeNull()
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

  it('P-C: 删除两段确认 —— 第一次点击变"确认删除？",再点才真删', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(FILE_LIST) })
      .mockResolvedValueOnce({ ok: true, status: 204 })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ files: [FILE_LIST.files[1]] }) })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(FilesPanel)
    await nextTick(); await nextTick(); await nextTick()

    // 第一次点击: 不进 DELETE,按钮变确认态
    await wrapper.find('[data-testid="del-sales-2026-08.csv"]').trigger('click')
    await nextTick()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const btn = wrapper.find('[data-testid="del-sales-2026-08.csv"]')
    expect(btn.text()).toBe('确认删除？')

    // 第二次点击: 真删并刷新
    await btn.trigger('click')
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

describe('FilesPanel P-N（目录树导航 + 大文件提示）', () => {
  beforeEach(() => { vi.restoreAllMocks() })
  afterEach(() => { document.body.innerHTML = '' })

  const ROOT_LIST = {
    path: '',
    dirs: ['reports'],
    files: [{ name: 'top.csv', size: 100, modifiedAt: '2026-08-15T01:00:00Z' }],
  }
  const SUB_LIST = {
    path: 'reports',
    dirs: [],
    files: [{ name: 'q1.csv', size: 50, modifiedAt: '2026-08-15T02:00:00Z' }],
  }

  it('点目录名进入子目录,面包屑可返回根目录', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(ROOT_LIST) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(SUB_LIST) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(ROOT_LIST) })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(FilesPanel)
    await nextTick(); await nextTick(); await nextTick()

    // 根: 目录行 + 顶层文件
    expect(wrapper.find('[data-dir="reports"]').exists()).toBe(true)
    expect(wrapper.find('[data-file="top.csv"]').exists()).toBe(true)

    // 进入 reports
    await wrapper.find('[data-dir="reports"] .dir-name').trigger('click')
    await nextTick(); await nextTick()
    expect(fetchMock).toHaveBeenLastCalledWith('/agui-api/files?path=reports')
    expect(wrapper.find('[data-file="reports/q1.csv"]').exists()).toBe(true)
    expect(wrapper.find('[data-file="top.csv"]').exists()).toBe(false)
    // 面包屑: 根目录 / reports
    const crumbs = wrapper.find('[data-testid="breadcrumbs"]')
    expect(crumbs.text()).toContain('根目录')
    expect(crumbs.text()).toContain('reports')

    // 面包屑返回
    await wrapper.find('[data-testid="crumb-root"]').trigger('click')
    await nextTick(); await nextTick()
    expect(fetchMock).toHaveBeenLastCalledWith('/agui-api/files')
    expect(wrapper.find('[data-file="top.csv"]').exists()).toBe(true)
  })

  it('chevron 就地展开子目录(懒加载+缩进),再点折叠', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(ROOT_LIST) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(SUB_LIST) })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(FilesPanel, { attachTo: document.body })
    await nextTick(); await nextTick(); await nextTick()

    await wrapper.find('[data-testid="expand-reports"]').trigger('click')
    await nextTick(); await nextTick()
    expect(fetchMock).toHaveBeenLastCalledWith('/agui-api/files?path=reports')
    // 子文件就地出现且不离开当前目录(top.csv 仍在)
    const child = wrapper.find('[data-file="reports/q1.csv"]')
    expect(child.exists()).toBe(true)
    expect(wrapper.find('[data-file="top.csv"]').exists()).toBe(true)
    // 缩进: 子行 paddingLeft 大于父行
    expect(child.attributes('style')).toContain('padding-left: 26px')

    // 折叠
    await wrapper.find('[data-testid="expand-reports"]').trigger('click')
    await nextTick()
    expect(wrapper.find('[data-file="reports/q1.csv"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('大文件(>1MB)点击 → 下载提示 modal,不发内容请求', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        path: '', dirs: [],
        files: [{ name: 'big.csv', size: 2 * 1024 * 1024, modifiedAt: '2026-08-15T01:00:00Z' }],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(FilesPanel, { attachTo: document.body })
    await nextTick(); await nextTick(); await nextTick()

    await wrapper.find('[data-file="big.csv"] .file-name').trigger('click')
    await nextTick()
    expect(fetchMock).toHaveBeenCalledTimes(1) // 只有列表请求,没拉内容
    const dlg = document.body.querySelector('[data-testid="file-preview-oversize"]')
    expect(dlg, '应出大文件下载提示 modal').toBeTruthy()
    expect(dlg!.textContent).toContain('2.0 MB')
    wrapper.unmount()
  })

  it('上传落入当前目录(?path=)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(ROOT_LIST) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(SUB_LIST) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ name: 'up.csv', size: 3 }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(SUB_LIST) })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(FilesPanel)
    await nextTick(); await nextTick(); await nextTick()
    await wrapper.find('[data-dir="reports"] .dir-name').trigger('click')
    await nextTick(); await nextTick()

    const input = wrapper.find('[data-testid="file-input"]')
    const file = new File(['a,b'], 'up.csv', { type: 'text/csv' })
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await nextTick(); await nextTick(); await nextTick()
    expect(fetchMock.mock.calls[2][0]).toBe('/agui-api/files?path=reports')
    expect(fetchMock.mock.calls[2][1].method).toBe('POST')
  })
})

describe('FilesPanel P-R（友好空态）', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('空目录: 图标 + 文案 + 上传引导按钮(点击触发文件选择)', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({ files: [], dirs: [] }))
    const wrapper = mount(FilesPanel)
    await nextTick(); await nextTick(); await nextTick()
    const empty = wrapper.find('[data-testid="files-empty"]')
    expect(empty.exists()).toBe(true)
    expect(empty.text()).toContain('还没有文件')
    const btn = wrapper.find('[data-testid="empty-upload"]')
    expect(btn.exists()).toBe(true)
    const input = wrapper.find('[data-testid="file-input"]').element as HTMLInputElement
    const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => {})
    await btn.trigger('click')
    expect(clickSpy).toHaveBeenCalled()
  })
})

describe('FilesPanel 移动端点击穿透（与 ThreadSidebar 同款守卫）', () => {
  // vitest(jsdom) 不注入 SFC <style>，直接守卫源码 CSS 规则。
  const css = readFileSync('src/components/FilesPanel.vue', 'utf-8')

  it('.file-actions 隐形时 pointer-events:none，hover 揭示/触屏常显时 auto', () => {
    const base = css.match(/\.file-actions \{[^}]*\}/)?.[0] ?? ''
    expect(base).toContain('opacity: 0')
    expect(base).toContain('pointer-events: none')
    const reveal = css.match(/\.file-item:hover \.file-actions[^{]*\{[^}]*\}/)?.[0] ?? ''
    expect(reveal).toContain('pointer-events: auto')
    const touch = css.match(/@media \(hover:\s*none\)[^}]*\{[^}]*\.file-actions[^}]*\}/)?.[0] ?? ''
    expect(touch).toContain('pointer-events: auto')
  })
})
