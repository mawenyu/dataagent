import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ConfirmDialog from './ConfirmDialog.vue'

/** P1: 通用确认弹窗(替代原生 confirm)。 */

describe('ConfirmDialog (P1)', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('渲染标题/消息/自定义按钮文案;确认与取消分别 emit', async () => {
    const w = mount(ConfirmDialog, {
      props: { title: '确认变更', message: 'agent 要修改 x.csv：2 处变更', confirmLabel: '应用', danger: true },
      attachTo: document.body,
    })
    await nextTick()
    const dlg = document.body.querySelector('[data-testid="confirm-dialog"]')!
    expect(dlg.textContent).toContain('确认变更')
    expect(dlg.textContent).toContain('2 处变更')
    expect(dlg.getAttribute('role')).toBe('alertdialog')
    ;(dlg.querySelector('[data-testid="confirm-ok"]') as HTMLButtonElement).click()
    expect(w.emitted('confirm')).toHaveLength(1)
    ;(dlg.querySelector('[data-testid="confirm-cancel"]') as HTMLButtonElement).click()
    expect(w.emitted('cancel')).toHaveLength(1)
    w.unmount()
  })

  it('Esc 与遮罩点击 = 取消', async () => {
    const w = mount(ConfirmDialog, {
      props: { title: 't', message: 'm' },
      attachTo: document.body,
    })
    await nextTick()
    ;(document.body.querySelector('[data-testid="confirm-overlay"]') as HTMLElement)
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(w.emitted('cancel')).toHaveLength(1)
    w.unmount()
  })
})
