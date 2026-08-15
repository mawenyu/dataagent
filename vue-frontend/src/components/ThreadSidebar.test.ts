import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ThreadSidebar from './ThreadSidebar.vue'

/** 需求1/F2: 侧边栏交互 —— 列表 / 新建 / 切换 / 删除确认 modal / 重命名 modal(自绘,非原生弹窗)。 */

const threads = [
  { id: 'a', title: '销售分析', sessionId: null, createdAt: '', updatedAt: '' },
  { id: 'b', title: '库存盘点', sessionId: null, createdAt: '', updatedAt: '' },
]

function dialog() {
  return document.body.querySelector('[data-testid="thread-dialog"]')
}

describe('ThreadSidebar (需求1/F2)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('渲染会话列表并高亮当前会话', () => {
    const w = mount(ThreadSidebar, { props: { threads, currentId: 'b' } })
    const items = w.findAll('.thread-item')
    expect(items).toHaveLength(2)
    expect(items[0].text()).toContain('销售分析')
    expect(items[1].classes()).toContain('active')
  })

  it('点击切换 / 新建按钮各自发事件', async () => {
    const w = mount(ThreadSidebar, { props: { threads, currentId: 'a' } })
    await w.findAll('.thread-item')[1].trigger('click')
    expect(w.emitted('switch')).toEqual([['b']])
    await w.find('[data-testid="new-thread"]').trigger('click')
    expect(w.emitted('new')).toHaveLength(1)
  })

  it('删除点确认按钮先弹 modal(不发事件),点"删除"才发 remove', async () => {
    const w = mount(ThreadSidebar, { props: { threads, currentId: 'a' }, attachTo: document.body })
    await w.find('[data-testid="del-a"]').trigger('click')
    expect(w.emitted('remove')).toBeUndefined()
    const dlg = dialog()
    expect(dlg).toBeTruthy()
    expect(dlg!.textContent).toContain('销售分析')
    ;(dlg!.querySelector('[data-testid="dialog-confirm"]') as HTMLButtonElement).click()
    await nextTick()
    expect(w.emitted('remove')).toEqual([['a']])
    expect(dialog()).toBeNull()
    w.unmount()
  })

  it('删除 modal 点"取消"或遮罩 → 关闭且不发事件', async () => {
    const w = mount(ThreadSidebar, { props: { threads, currentId: 'a' }, attachTo: document.body })
    await w.find('[data-testid="del-a"]').trigger('click')
    ;(dialog()!.querySelector('[data-testid="dialog-cancel"]') as HTMLButtonElement).click()
    await nextTick()
    expect(w.emitted('remove')).toBeUndefined()
    expect(dialog()).toBeNull()

    await w.find('[data-testid="del-b"]').trigger('click')
    ;(document.body.querySelector('[data-testid="dialog-overlay"]') as HTMLElement).click()
    await nextTick()
    expect(w.emitted('remove')).toBeUndefined()
    expect(dialog()).toBeNull()
    w.unmount()
  })

  it('双击标题弹重命名 modal(预填原标题),改标题确认后发 rename', async () => {
    const w = mount(ThreadSidebar, { props: { threads, currentId: 'a' }, attachTo: document.body })
    await w.findAll('.thread-item')[0].trigger('dblclick')
    const dlg = dialog()
    expect(dlg).toBeTruthy()
    const input = dlg!.querySelector('input') as HTMLInputElement
    expect(input.value).toBe('销售分析')
    input.value = '新标题'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    ;(dlg!.querySelector('[data-testid="dialog-confirm"]') as HTMLButtonElement).click()
    await nextTick()
    expect(w.emitted('rename')).toEqual([['a', '新标题']])
    expect(dialog()).toBeNull()
    w.unmount()
  })

  it('重命名: 回车提交; 空白或标题未变不发事件', async () => {
    const w = mount(ThreadSidebar, { props: { threads, currentId: 'a' }, attachTo: document.body })
    // 标题未变 → 确认不发事件
    await w.findAll('.thread-item')[0].trigger('dblclick')
    ;(dialog()!.querySelector('[data-testid="dialog-confirm"]') as HTMLButtonElement).click()
    await nextTick()
    expect(w.emitted('rename')).toBeUndefined()

    // 清空为空白 → 确认按钮禁用
    await w.findAll('.thread-item')[0].trigger('dblclick')
    const input = dialog()!.querySelector('input') as HTMLInputElement
    input.value = '   '
    input.dispatchEvent(new Event('input'))
    await nextTick()
    const confirmBtn = dialog()!.querySelector('[data-testid="dialog-confirm"]') as HTMLButtonElement
    expect(confirmBtn.disabled).toBe(true)

    // 回车提交
    input.value = '回车标题'
    input.dispatchEvent(new Event('input'))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await nextTick()
    expect(w.emitted('rename')).toEqual([['a', '回车标题']])
    w.unmount()
  })

  it('ESC 关闭弹窗', async () => {
    const w = mount(ThreadSidebar, { props: { threads, currentId: 'a' }, attachTo: document.body })
    await w.find('[data-testid="del-a"]').trigger('click')
    expect(dialog()).toBeTruthy()
    dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(dialog()).toBeNull()
    expect(w.emitted('remove')).toBeUndefined()
    w.unmount()
  })

  it('空列表显示占位', () => {
    const w = mount(ThreadSidebar, { props: { threads: [], currentId: '' } })
    expect(w.text()).toContain('暂无会话')
  })
})
