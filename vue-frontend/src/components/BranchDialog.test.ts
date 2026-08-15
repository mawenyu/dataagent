import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import BranchDialog from './BranchDialog.vue'

/** P-Q: 分叉弹窗 —— 消息列表 / 点选 / 空态 / Esc·遮罩关闭 / aria。 */

const messages = [
  { id: 'u1', role: 'user', text: '分析本月销售情况' },
  { id: 'a1', role: 'assistant', text: '本月总销售额 120 万，华东最高。' },
  { id: 'u2', role: 'user', text: '那华北呢？' },
]

function dlg() {
  return document.body.querySelector('[data-testid="branch-dialog"]')
}

describe('BranchDialog (P-Q)', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('渲染消息列表(角色图标+预览),点选 emit select(messageId)', async () => {
    const w = mount(BranchDialog, { props: { messages }, attachTo: document.body })
    await nextTick()
    const list = dlg()!.querySelector('[data-testid="branch-list"]')!
    expect(list.textContent).toContain('分析本月销售情况')
    expect(list.textContent).toContain('那华北呢？')
    ;(list.querySelector('[data-testid="branch-at-u2"]') as HTMLButtonElement).click()
    expect(w.emitted('select')).toEqual([['u2']])
    w.unmount()
  })

  it('长文本预览截断为单行 ≤81 字符', async () => {
    const w = mount(BranchDialog, {
      props: { messages: [{ id: 'x', role: 'user', text: '长'.repeat(200) }] },
      attachTo: document.body,
    })
    await nextTick()
    const text = dlg()!.querySelector('.br-text')!.textContent!
    expect(text.length).toBeLessThanOrEqual(81)
    expect(text.endsWith('…')).toBe(true)
    w.unmount()
  })

  it('空列表显示占位;busy 禁用点选', async () => {
    const w = mount(BranchDialog, { props: { messages: [], busy: true }, attachTo: document.body })
    await nextTick()
    expect(dlg()!.textContent).toContain('暂无可分叉的消息')
    w.unmount()
  })

  it('aria 齐全;Esc 关闭', async () => {
    const w = mount(BranchDialog, { props: { messages }, attachTo: document.body })
    await nextTick()
    expect(dlg()!.getAttribute('role')).toBe('dialog')
    expect(dlg()!.getAttribute('aria-modal')).toBe('true')
    ;(document.body.querySelector('[data-testid="branch-overlay"]') as HTMLElement)
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(w.emitted('close')).toHaveLength(1)
    w.unmount()
  })
})
