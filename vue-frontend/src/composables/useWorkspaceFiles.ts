import { ref } from 'vue'

/**
 * workspace 文件管理（spec: docs/spec/workspace-files.md）。
 * API 权威（gateway /files），无 localStorage 兜底需求（文件在服务端）。
 */

export interface WorkspaceFile { name: string; size: number; modifiedAt: string }

const API = '/agui-api/files'

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function useWorkspaceFiles() {
  const files = ref<WorkspaceFile[]>([])
  const loading = ref(false)
  const error = ref('')
  /** 预览中的文件内容（文本）；null = 未在预览 */
  const preview = ref<{ name: string; content: string; truncated: boolean } | null>(null)

  async function refresh() {
    loading.value = true
    error.value = ''
    try {
      const res = await fetch(API)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      files.value = data.files ?? []
    } catch (e: any) {
      error.value = e?.message ?? '加载失败'
    } finally {
      loading.value = false
    }
  }

  async function previewFile(name: string) {
    error.value = ''
    try {
      const res = await fetch(`${API}/${encodeURIComponent(name)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = await res.arrayBuffer()
      const truncated = buf.byteLength > 256 * 1024
      const text = new TextDecoder('utf-8', { fatal: false })
        .decode(truncated ? buf.slice(0, 256 * 1024) : buf)
      preview.value = { name, content: text, truncated }
    } catch (e: any) {
      error.value = e?.message ?? '读取失败'
    }
  }

  function closePreview() { preview.value = null }

  async function upload(file: File) {
    error.value = ''
    const form = new FormData()
    form.append('file', file, file.name)
    const res = await fetch(API, { method: 'POST', body: form })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.error ?? `HTTP ${res.status}`)
    }
    await refresh()
  }

  function downloadUrl(name: string) {
    return `${API}/${encodeURIComponent(name)}`
  }

  /** 读取完整文件文本（task5-B4：表格编辑器打开 / agent handler 读当前内容用）。 */
  async function readFile(name: string): Promise<string> {
    const res = await fetch(`${API}/${encodeURIComponent(name)}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return new TextDecoder('utf-8', { fatal: false }).decode(await res.arrayBuffer())
  }

  /** task5-B4：PUT 覆盖写（raw text body），保存后刷新列表并同步预览内容。 */
  async function saveFile(name: string, content: string) {
    error.value = ''
    const res = await fetch(`${API}/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: content,
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.error ?? `HTTP ${res.status}`)
    }
    if (preview.value?.name === name) preview.value = { name, content, truncated: false }
    await refresh()
  }

  async function remove(name: string) {
    error.value = ''
    const res = await fetch(`${API}/${encodeURIComponent(name)}`, { method: 'DELETE' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    if (preview.value?.name === name) preview.value = null
    await refresh()
  }

  return { files, loading, error, preview, refresh, previewFile, closePreview, upload, downloadUrl, remove, readFile, saveFile }
}
