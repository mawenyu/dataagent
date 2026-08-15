import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { useGlobalShortcuts } from './useGlobalShortcuts'

/** P-O: 全局快捷键(Ctrl+K 聚焦搜索 / Ctrl+N 新建会话)。 */

function mountHarness(cbs: { onFocusSearch?: () => void; onNewThread?: () => void }) {
  const Harness = defineComponent({
    setup() {
      useGlobalShortcuts(cbs)
      return {}
    },
    template: '<div />',
  })
  return mount(Harness)
}

describe('useGlobalShortcuts (P-O)', () => {
  it('Ctrl+K → onFocusSearch(preventDefault);Ctrl+N → onNewThread', () => {
    const onFocusSearch = vi.fn()
    const onNewThread = vi.fn()
    const w = mountHarness({ onFocusSearch, onNewThread })

    const k = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true })
    window.dispatchEvent(k)
    expect(onFocusSearch).toHaveBeenCalledTimes(1)
    expect(k.defaultPrevented).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, cancelable: true }))
    expect(onNewThread).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('Cmd 键(Mac)同样生效;裸按键不触发', () => {
    const onFocusSearch = vi.fn()
    const w = mountHarness({ onFocusSearch })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
    expect(onFocusSearch).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }))
    expect(onFocusSearch).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('输入框/textarea 内的按键不劫持(用户打字不受影响),Ctrl+K 除外', () => {
    const onFocusSearch = vi.fn()
    const onNewThread = vi.fn()
    const w = mountHarness({ onFocusSearch, onNewThread })
    const ta = document.createElement('textarea')
    document.body.appendChild(ta)
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true, cancelable: true }))
    // 输入框内 Ctrl+N 不触发新建(避免误触),Ctrl+K 仍可(聚焦搜索是安全的)
    expect(onNewThread).not.toHaveBeenCalled()
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }))
    expect(onFocusSearch).toHaveBeenCalledTimes(1)
    ta.remove()
    w.unmount()
  })

  it('卸载后移除监听', () => {
    const onFocusSearch = vi.fn()
    const w = mountHarness({ onFocusSearch })
    w.unmount()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
    expect(onFocusSearch).not.toHaveBeenCalled()
  })
})
