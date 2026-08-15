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

  it('P-A: 导出按钮发 export 事件且不触发切换', async () => {
    const w = mount(ThreadSidebar, { props: { threads, currentId: 'a' } })
    await w.find('[data-testid="export-b"]').trigger('click')
    expect(w.emitted('export')).toEqual([['b']])
    expect(w.emitted('switch')).toBeUndefined()
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

describe('ThreadSidebar P7（搜索过滤 + 置顶）', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    localStorage.clear()
  })

  const many = [
    { id: 'a', title: '销售分析', sessionId: null, createdAt: '', updatedAt: '' },
    { id: 'b', title: '库存盘点', sessionId: null, createdAt: '', updatedAt: '' },
    { id: 'c', title: '销售周报', sessionId: null, createdAt: '', updatedAt: '' },
    { id: 'd', title: '客户清单', sessionId: null, createdAt: '', updatedAt: '' },
  ]

  it('搜索框按标题模糊过滤（子序列匹配），清空恢复', async () => {
    const w = mount(ThreadSidebar, { props: { threads: many, currentId: 'a' } })
    const box = w.find('[data-testid="thread-search"]')
    expect(box.exists()).toBe(true)

    await box.setValue('销售')
    expect(w.findAll('.thread-item')).toHaveLength(2) // 销售分析/销售周报

    await box.setValue('销分') // 子序列模糊：销…分
    expect(w.findAll('.thread-item')).toHaveLength(1)
    expect(w.text()).toContain('销售分析')

    await box.setValue('不存在的东西')
    expect(w.findAll('.thread-item')).toHaveLength(0)
    expect(w.text()).toContain('无匹配会话')

    await box.setValue('')
    expect(w.findAll('.thread-item')).toHaveLength(4)
  })

  it('置顶：点击 pin 排最前，localStorage 持久化，重挂载仍在', async () => {
    const w = mount(ThreadSidebar, { props: { threads: many, currentId: 'a' } })
    await w.find('[data-testid="pin-c"]').trigger('click')
    let items = w.findAll('.thread-item')
    expect(items[0].text()).toContain('销售周报')
    expect(items[0].classes()).toContain('pinned')
    // 不触发切换
    expect(w.emitted('switch')).toBeUndefined()
    // 持久化
    expect(JSON.parse(localStorage.getItem('dataagent.pinnedThreads') ?? '[]')).toContain('c')

    // 重新挂载（模拟刷新）→ 仍置顶
    const w2 = mount(ThreadSidebar, { props: { threads: many, currentId: 'a' } })
    items = w2.findAll('.thread-item')
    expect(items[0].text()).toContain('销售周报')

    // 再点取消置顶
    await w2.find('[data-testid="pin-c"]').trigger('click')
    expect(w2.findAll('.thread-item')[0].text()).toContain('销售分析')
    expect(JSON.parse(localStorage.getItem('dataagent.pinnedThreads') ?? '[]')).not.toContain('c')
  })

  it('置顶与搜索叠加：置顶项在过滤结果里仍排最前', async () => {
    localStorage.setItem('dataagent.pinnedThreads', JSON.stringify(['c']))
    const w = mount(ThreadSidebar, { props: { threads: many, currentId: 'a' } })
    await w.find('[data-testid="thread-search"]').setValue('销售')
    const items = w.findAll('.thread-item')
    expect(items).toHaveLength(2)
    expect(items[0].text()).toContain('销售周报') // pinned 在前
    expect(items[0].classes()).toContain('pinned')
  })
})

describe('ThreadSidebar P-G（会话归档）', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    localStorage.clear()
  })

  const many = [
    { id: 'a', title: '销售分析', sessionId: null, createdAt: '', updatedAt: '' },
    { id: 'b', title: '库存盘点', sessionId: null, createdAt: '', updatedAt: '' },
    { id: 'c', title: '销售周报', sessionId: null, createdAt: '', updatedAt: '' },
    { id: 'd', title: '客户清单', sessionId: null, createdAt: '', updatedAt: '' },
  ]

  it('归档后从主列表消失,进入底部"已归档"折叠区(默认折叠),不触发切换', async () => {
    const w = mount(ThreadSidebar, { props: { threads: many, currentId: 'a' }, attachTo: document.body })
    await w.find('[data-testid="archive-b"]').trigger('click')

    // 主列表 3 项且无 b
    const items = w.findAll('.thread-list .thread-item')
    expect(items).toHaveLength(3)
    expect(w.find('.thread-list').text()).not.toContain('库存盘点')
    expect(w.emitted('switch')).toBeUndefined()

    // 底部归档区出现,默认折叠(列表不渲染),计数 1
    const toggle = w.find('[data-testid="archive-toggle"]')
    expect(toggle.exists()).toBe(true)
    expect(toggle.text()).toContain('已归档')
    expect(toggle.text()).toContain('1')
    expect(w.find('[data-testid="archive-list"]').isVisible()).toBe(false)

    // 展开后可见
    await toggle.trigger('click')
    const archived = w.find('[data-testid="archive-list"]')
    expect(archived.isVisible()).toBe(true)
    expect(archived.text()).toContain('库存盘点')
  })

  it('取消归档: 会话回到主列表,归档区清空后整区消失', async () => {
    localStorage.setItem('dataagent.archivedThreads', JSON.stringify(['b']))
    const w = mount(ThreadSidebar, { props: { threads: many, currentId: 'a' } })
    await w.find('[data-testid="archive-toggle"]').trigger('click')
    await w.find('[data-testid="unarchive-b"]').trigger('click')

    expect(w.find('.thread-list').text()).toContain('库存盘点')
    expect(w.find('[data-testid="archive-toggle"]').exists()).toBe(false)
    expect(JSON.parse(localStorage.getItem('dataagent.archivedThreads') ?? '[]')).not.toContain('b')
  })

  it('localStorage 持久化: 重挂载后归档态保留', async () => {
    const w = mount(ThreadSidebar, { props: { threads: many, currentId: 'a' } })
    await w.find('[data-testid="archive-c"]').trigger('click')
    expect(JSON.parse(localStorage.getItem('dataagent.archivedThreads') ?? '[]')).toContain('c')

    const w2 = mount(ThreadSidebar, { props: { threads: many, currentId: 'a' } })
    expect(w2.find('.thread-list').text()).not.toContain('销售周报')
    await w2.find('[data-testid="archive-toggle"]').trigger('click')
    expect(w2.find('[data-testid="archive-list"]').text()).toContain('销售周报')
  })

  it('归档当前会话: 在归档区仍保持 active 高亮', async () => {
    localStorage.setItem('dataagent.archivedThreads', JSON.stringify(['a']))
    const w = mount(ThreadSidebar, { props: { threads: many, currentId: 'a' } })
    await w.find('[data-testid="archive-toggle"]').trigger('click')
    const item = w.find('[data-testid="archive-list"] .thread-item')
    expect(item.classes()).toContain('active')
  })

  it('搜索对归档区同样生效', async () => {
    localStorage.setItem('dataagent.archivedThreads', JSON.stringify(['c', 'd']))
    const w = mount(ThreadSidebar, { props: { threads: many, currentId: 'a' } })
    expect(w.find('[data-testid="archive-toggle"]').text()).toContain('2')
    await w.find('[data-testid="thread-search"]').setValue('客户')
    // 归档区只剩"客户清单"
    expect(w.find('[data-testid="archive-toggle"]').text()).toContain('1')
    await w.find('[data-testid="archive-toggle"]').trigger('click')
    const list = w.find('[data-testid="archive-list"]')
    expect(list.text()).toContain('客户清单')
    expect(list.text()).not.toContain('销售周报')
  })
})
