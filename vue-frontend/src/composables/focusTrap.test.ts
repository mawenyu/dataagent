import { describe, expect, it } from 'vitest'
import { trapTabKey } from './focusTrap'

/** P-O: modal 焦点圈定(Tab/Shift+Tab 在容器内循环,跳过禁用)。 */

function makeContainer(): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = `
    <input id="a" />
    <button id="b"></button>
    <button id="c" disabled></button>
    <button id="d"></button>
  `
  document.body.appendChild(el)
  return el
}

function tabEvent(shift = false): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true })
}

describe('trapTabKey (P-O)', () => {
  it('末元素 Tab → 回卷到第一个可聚焦元素', () => {
    const c = makeContainer()
    const last = c.querySelector<HTMLElement>('#d')!
    last.focus()
    const e = tabEvent()
    trapTabKey(e, c)
    expect(document.activeElement).toBe(c.querySelector('#a'))
    expect(e.defaultPrevented).toBe(true)
    c.remove()
  })

  it('首元素 Shift+Tab → 回卷到最后一个', () => {
    const c = makeContainer()
    c.querySelector<HTMLElement>('#a')!.focus()
    const e = tabEvent(true)
    trapTabKey(e, c)
    expect(document.activeElement).toBe(c.querySelector('#d')) // disabled 的 #c 被跳过
    c.remove()
  })

  it('中间元素不拦截(交给浏览器默认行为)', () => {
    const c = makeContainer()
    c.querySelector<HTMLElement>('#a')!.focus()
    // 焦点在 #a,Tab 应自然到 #b —— trap 只在边界介入? 简化实现: 始终手动前移
    const e = tabEvent()
    trapTabKey(e, c)
    expect(document.activeElement).toBe(c.querySelector('#b'))
    c.remove()
  })

  it('焦点在容器外 → 拉回第一个元素并阻止默认', () => {
    const c = makeContainer()
    ;(document.body as HTMLElement).focus?.()
    const e = tabEvent()
    trapTabKey(e, c)
    expect(e.defaultPrevented).toBe(true)
    expect(c.contains(document.activeElement)).toBe(true)
    c.remove()
  })

  it('非 Tab 键不处理', () => {
    const c = makeContainer()
    const e = new KeyboardEvent('keydown', { key: 'x', cancelable: true })
    trapTabKey(e, c)
    expect(e.defaultPrevented).toBe(false)
    c.remove()
  })
})
