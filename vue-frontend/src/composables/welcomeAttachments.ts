import { computed, ref, watch, type Ref } from 'vue'
import { ATTACH_ACCEPT, ATTACH_MAX_SIZE } from './chatAttachments'

/**
 * F1b: 欢迎页 ChatGPT 式附件上传（task6-B 主输入框链路的欢迎页补完）。
 *
 * 与主输入框的差异：欢迎页走自绘输入区（welcome-screen 槽整视图替换），
 * fork 的附件队列不参与，所以这里单独维护 chip 列表 —— 选中即上传到当前
 * 会话工作目录（welcome 页也总有 currentId：useThreads.init 会本地先造
 * UUID,gateway 首次上传/首条消息时懒建会话目录），发送时把附件文件名
 * 拼进消息文本（gateway 会把用户文本放进 agent prompt,agent 据此到会话
 * 工作目录读文件）。
 */

export interface WelcomeAttachment {
  id: string
  name: string
  size: number
  status: 'uploading' | 'ready' | 'error'
  /** P-J: 上传失败原因(chip 悬停展示,报错不静默) */
  errorMessage?: string
}

/** 与 gateway WorkspaceFileService NAME_PATTERN 对齐（[A-Za-z0-9][A-Za-z0-9._-]{0,127}）。 */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

/** 由 ATTACH_ACCEPT 派生允许的扩展名集合。 */
const ALLOWED_EXTS = new Set(
  ATTACH_ACCEPT.split(',').map((s) => s.trim().replace(/^\./, '').toLowerCase()),
)

let seq = 0

export function useWelcomeAttachments(deps: {
  /** 上传到当前会话工作目录（抛错 = 失败）。 */
  upload: (file: File) => Promise<void>
  /** 失败提示（toast 等），入参为用户可读消息。 */
  onFailed: (message: string) => void
  /** 当前会话 id；切换会话时清空暂存（附件已落在旧会话目录）。 */
  threadId?: Ref<string>
}) {
  const items = ref<WelcomeAttachment[]>([])

  const hasReady = computed(() => items.value.some((i) => i.status === 'ready'))
  const hasUploading = computed(() => items.value.some((i) => i.status === 'uploading'))

  function validate(file: File): string | null {
    if (!NAME_PATTERN.test(file.name)) {
      return `「${file.name}」文件名不支持：仅允许字母/数字/点/下划线/连字符且以字母数字开头`
    }
    const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : ''
    if (!ALLOWED_EXTS.has(ext)) {
      return `「${file.name}」类型不支持，允许：${ATTACH_ACCEPT}`
    }
    // P-J: 0 字节文件 gateway 也会拒("empty file"),前端提前明确拦截
    if (file.size === 0) {
      return `「${file.name}」是空文件，没有可分析的内容`
    }
    if (file.size > ATTACH_MAX_SIZE) {
      return `「${file.name}」超过 50MB 上限`
    }
    return null
  }

  async function addFiles(list: FileList | File[]): Promise<void> {
    for (const file of Array.from(list ?? [])) {
      const problem = validate(file)
      if (problem) {
        deps.onFailed(problem)
        continue
      }
      const item: WelcomeAttachment = {
        id: `wa-${++seq}`,
        name: file.name,
        size: file.size,
        status: 'uploading',
      }
      items.value = [...items.value, item]
      try {
        await deps.upload(file)
        items.value = items.value.map((i) => (i.id === item.id ? { ...i, status: 'ready' } : i))
      } catch (e: any) {
        const reason = e?.message ?? '未知错误'
        items.value = items.value.map((i) =>
          i.id === item.id ? { ...i, status: 'error', errorMessage: reason } : i,
        )
        deps.onFailed(`「${file.name}」上传失败：${reason}`)
      }
    }
  }

  function remove(id: string): void {
    items.value = items.value.filter((i) => i.id !== id)
  }

  /**
   * 发送时消费：把 ready 附件名拼进文本（纯附件时回退引导语），并清掉已
   * 消费的 chip（error chip 保留供用户处置）。返回 null = 当前不可发送
   * （空内容，或仍有 chip 在上传中）。
   */
  function consumeForSubmit(text: string): string | null {
    if (hasUploading.value) return null
    const ready = items.value.filter((i) => i.status === 'ready')
    const trimmed = text.trim()
    if (!ready.length && !trimmed) return null

    let msg = trimmed || '请分析我上传的数据文件'
    if (ready.length) {
      const names = ready.map((i) => i.name).join('、')
      msg += `\n\n（随消息上传的附件：${names}，已保存到当前会话工作目录，可直接读取分析）`
    }
    items.value = items.value.filter((i) => i.status === 'error')
    return msg
  }

  if (deps.threadId) {
    watch(deps.threadId, () => {
      items.value = []
    })
  }

  return { items, hasReady, hasUploading, addFiles, remove, consumeForSubmit }
}
