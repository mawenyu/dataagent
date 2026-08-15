import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ref, nextTick } from 'vue'
import { useWorkspaceFiles } from './useWorkspaceFiles'

/**
 * task6: workspace 会话隔离 —— useWorkspaceFiles 接受 threadId ref，
 * API 路径变为 /agui-api/chat/threads/{id}/files；切换会话自动刷新。
 * 不传 threadId 时保持 legacy /agui-api/files（spec: docs/spec/workspace-isolation.md）。
 */

function listResponse(names: string[]) {
  return {
    ok: true,
    json: () => Promise.resolve({
      files: names.map((n) => ({ name: n, size: 10, modifiedAt: '2026-08-15T01:00:00Z' })),
    }),
  }
}

describe('useWorkspaceFiles (task6 会话隔离)', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('不传 threadId 时走 legacy /files（向后兼容）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(listResponse(['a.csv']))
    vi.stubGlobal('fetch', fetchMock)
    const api = useWorkspaceFiles()
    await api.refresh()
    expect(fetchMock).toHaveBeenCalledWith('/agui-api/files')
    expect(api.files.value.map((f) => f.name)).toEqual(['a.csv'])
  })

  it('传 threadId 后所有 API 按会话隔离', async () => {
    const fetchMock = vi.fn().mockResolvedValue(listResponse(['t1.csv']))
    vi.stubGlobal('fetch', fetchMock)
    const tid = ref('thread-1')
    const api = useWorkspaceFiles(tid)
    await api.refresh()
    expect(fetchMock).toHaveBeenLastCalledWith('/agui-api/chat/threads/thread-1/files')

    await api.previewFile('t1.csv')
    expect(fetchMock).toHaveBeenLastCalledWith('/agui-api/chat/threads/thread-1/files/t1.csv')

    expect(api.downloadUrl('t1.csv')).toBe('/agui-api/chat/threads/thread-1/files/t1.csv')

    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ name: 'up.csv', size: 3 }) })
      .mockResolvedValueOnce(listResponse(['up.csv']))
    const file = new File(['a,b'], 'up.csv', { type: 'text/csv' })
    await api.upload(file)
    expect(fetchMock.mock.calls[fetchMock.mock.calls.length - 2][0])
      .toBe('/agui-api/chat/threads/thread-1/files')
    expect(fetchMock.mock.calls[fetchMock.mock.calls.length - 2][1]?.method).toBe('POST')
  })

  it('切换 threadId 自动刷新并清空预览', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(listResponse(['t1.csv']))
      .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(new TextEncoder().encode('x').buffer) })
      .mockResolvedValueOnce(listResponse(['t2.csv']))
    vi.stubGlobal('fetch', fetchMock)
    const tid = ref('thread-1')
    const api = useWorkspaceFiles(tid)
    await api.refresh()
    await api.previewFile('t1.csv')
    expect(api.preview.value?.name).toBe('t1.csv')

    tid.value = 'thread-2'
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchMock).toHaveBeenLastCalledWith('/agui-api/chat/threads/thread-2/files')
    expect(api.preview.value).toBeNull()
    expect(api.files.value.map((f) => f.name)).toEqual(['t2.csv'])
  })

  it('saveFile/readFile/remove 同样按会话隔离', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ files: [] }) })
    vi.stubGlobal('fetch', fetchMock)
    const api = useWorkspaceFiles(ref('thread-9'))

    fetchMock.mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(new TextEncoder().encode('a,b').buffer) })
    await api.readFile('g.csv')
    expect(fetchMock).toHaveBeenLastCalledWith('/agui-api/chat/threads/thread-9/files/g.csv')

    await api.saveFile('g.csv', 'a,b\n1,2')
    expect(fetchMock.mock.calls.at(-2)?.[0]).toBe('/agui-api/chat/threads/thread-9/files/g.csv')
    expect((fetchMock.mock.calls.at(-2)?.[1] as any)?.method).toBe('PUT')

    await api.remove('g.csv')
    expect(fetchMock.mock.calls.at(-2)?.[0]).toBe('/agui-api/chat/threads/thread-9/files/g.csv')
    expect((fetchMock.mock.calls.at(-2)?.[1] as any)?.method).toBe('DELETE')
  })
})
