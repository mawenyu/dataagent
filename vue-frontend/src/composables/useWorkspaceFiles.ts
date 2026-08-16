import { ref, watch, type Ref } from 'vue'

/**
 * workspace 文件管理（spec: docs/spec/workspace-files.md）。
 * API 权威（gateway），无 localStorage 兜底需求（文件在服务端）。
 *
 * task6 会话隔离（spec: docs/spec/workspace-isolation.md）：
 * 传入 threadId ref 后所有 API 走 /agui-api/chat/threads/{id}/files，
 * 切换 threadId 自动刷新并清空预览；不传则走 legacy /agui-api/files（共享根）。
 */

export interface WorkspaceFile { name: string; size: number; modifiedAt: string }

const LEGACY_API = '/agui-api/files'

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** P-N: 逐段编码相对路径(%2F 会被网关拒,必须保留 / 分隔)。 */
function encodeRel(rel: string): string {
  return rel.split('/').map(encodeURIComponent).join('/')
}

export function useWorkspaceFiles(threadId?: Ref<string | undefined>) {
  const files = ref<WorkspaceFile[]>([])
  /** P-N: 当前目录的子目录名列表(listDir 响应) */
  const dirs = ref<string[]>([])
  const loading = ref(false)
  const error = ref('')
  /** 预览中的文件内容（文本）；null = 未在预览 */
  const preview = ref<{ name: string; content: string; truncated: boolean } | null>(null)

  function apiBase(): string {
    const tid = threadId?.value
    return tid ? `/agui-api/chat/threads/${encodeURIComponent(tid)}/files` : LEGACY_API
  }

  // task6: 切换会话 → 文件列表/预览跟着切换
  if (threadId) {
    watch(threadId, () => {
      preview.value = null
      void refresh()
    })
  }

  /**
   * 冷启动竞态防护（多模态预览 e2e 实测发现）：fresh 首屏 useThreads.init()
   * 完成前 currentId=''，此窗口的写操作会落到 legacy 共享根（/agui-api/files）
   * —— 会话隔离泄漏。upload 前等 threadId 就绪；10s 不就绪则抛错（不静默落 legacy）。
   */
  function awaitThreadId(): Promise<void> {
    if (!threadId || threadId.value) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        stop()
        reject(new Error('会话未就绪，请稍后重试'))
      }, 10_000)
      const stop = watch(threadId, (v) => {
        if (v) {
          clearTimeout(timer)
          stop()
          resolve()
        }
      })
    })
  }

  /** P-N: path = 相对子目录('' = 根);响应含 dirs + files。 */
  async function refresh(path = '') {
    loading.value = true
    error.value = ''
    try {
      const res = await fetch(apiBase() + (path ? `?path=${encodeURIComponent(path)}` : ''))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      files.value = data.files ?? []
      dirs.value = data.dirs ?? []
    } catch (e: any) {
      error.value = e?.message ?? '加载失败'
    } finally {
      loading.value = false
    }
  }

  async function previewFile(name: string) {
    error.value = ''
    try {
      const res = await fetch(`${apiBase()}/${encodeRel(name)}`)
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

  /** P-N: path = 目标子目录(须已存在);上传后刷新该目录。 */
  async function upload(file: File, path = '') {
    error.value = ''
    await awaitThreadId() // 冷启动竞态: 等会话 id 就绪,不写 legacy 共享根
    const form = new FormData()
    form.append('file', file, file.name)
    const res = await fetch(apiBase() + (path ? `?path=${encodeURIComponent(path)}` : ''), { method: 'POST', body: form })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.error ?? `HTTP ${res.status}`)
    }
    await refresh(path)
  }

  function downloadUrl(name: string) {
    return `${apiBase()}/${encodeRel(name)}`
  }

  /** 读取完整文件文本（task5-B4：表格编辑器打开 / agent handler 读当前内容用）。 */
  async function readFile(name: string): Promise<string> {
    const res = await fetch(`${apiBase()}/${encodeRel(name)}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return new TextDecoder('utf-8', { fatal: false }).decode(await res.arrayBuffer())
  }

  /** task5-B4：PUT 覆盖写（raw text body），保存后刷新列表并同步预览内容。
   *  P15: baseModified（打开/读取时的 modifiedAt 毫秒）→ 乐观并发检测，
   *  服务端不符返回 409（不静默覆盖他人改动）。 */
  async function saveFile(name: string, content: string, baseModified?: number) {
    error.value = ''
    const url = `${apiBase()}/${encodeRel(name)}`
        + (baseModified != null ? `?baseModified=${baseModified}` : '')
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: content,
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      // 带状态码：409 冲突检测依赖它（P15）
      throw new Error(`${body?.error ?? 'error'} (HTTP ${res.status})`)
    }
    if (preview.value?.name === name) preview.value = { name, content, truncated: false }
    await refresh()
  }

  async function remove(name: string) {
    error.value = ''
    const res = await fetch(`${apiBase()}/${encodeRel(name)}`, { method: 'DELETE' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    if (preview.value?.name === name) preview.value = null
    await refresh()
  }

  /** P-N: 只读取目录内容(不改动当前列表状态),供树展开懒加载。 */
  async function fetchDir(path: string): Promise<{ dirs: string[]; files: WorkspaceFile[] }> {
    const res = await fetch(apiBase() + (path ? `?path=${encodeURIComponent(path)}` : ''))
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return { dirs: data.dirs ?? [], files: data.files ?? [] }
  }

  /** P15: 文件当前 modifiedAt（毫秒），用于乐观冲突检测；找不到 → null。 */
  function statOf(name: string): number | null {
    const f = files.value.find((x) => x.name === name)
    if (!f) return null
    const ms = Date.parse(f.modifiedAt)
    return Number.isNaN(ms) ? null : ms
  }

  return { files, dirs, loading, error, preview, refresh, fetchDir, previewFile, closePreview, upload, downloadUrl, remove, readFile, saveFile, statOf }
}
