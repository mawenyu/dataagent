/**
 * P-O: modal 焦点圈定 —— Tab/Shift+Tab 在容器内循环。
 * 边界/越界时手动迁移焦点并 preventDefault；中间位置也手动前移
 * （实现简单且行为确定，jsdom 可测）。
 */

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'

export function trapTabKey(e: KeyboardEvent, container: HTMLElement): void {
  if (e.key !== 'Tab') return
  const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((el) => el.style.display !== 'none' && !el.hidden)
  if (items.length === 0) {
    e.preventDefault()
    return
  }
  const active = document.activeElement as HTMLElement | null
  const idx = active ? items.indexOf(active) : -1
  e.preventDefault()
  if (idx === -1) {
    items[0].focus()
    return
  }
  const next = e.shiftKey
    ? (idx - 1 + items.length) % items.length
    : (idx + 1) % items.length
  items[next].focus()
}
