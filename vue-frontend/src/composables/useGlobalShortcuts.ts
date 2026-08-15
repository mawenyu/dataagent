import { onMounted, onUnmounted } from 'vue'

/**
 * P-O: 全局快捷键。
 * - Ctrl/Cmd+K → onFocusSearch(聚焦会话搜索;输入框内也可用,聚焦搜索是安全操作)
 * - Ctrl/Cmd+N → onNewThread(输入框/textarea 内不劫持,避免误触;
 *   注意: Chrome 桌面版保留 Ctrl+N 新建窗口不可 preventDefault,Electron/部分
 *   浏览器可生效 —— 尽力而为)
 */
export function useGlobalShortcuts(deps: {
  onFocusSearch?: () => void
  onNewThread?: () => void
}) {
  function isEditableTarget(t: EventTarget | null): boolean {
    if (!(t instanceof HTMLElement)) return false
    const tag = t.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable
  }

  function onKeydown(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey
    if (!mod) return
    const key = e.key.toLowerCase()
    if (key === 'k') {
      e.preventDefault()
      deps.onFocusSearch?.()
      return
    }
    if (key === 'n' && !isEditableTarget(e.target)) {
      e.preventDefault()
      deps.onNewThread?.()
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onUnmounted(() => window.removeEventListener('keydown', onKeydown))
}
