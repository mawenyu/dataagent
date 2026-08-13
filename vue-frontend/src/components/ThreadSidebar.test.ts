import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ThreadSidebar from './ThreadSidebar.vue'

/** 需求1: 侧边栏交互 —— 列表渲染 / 新建 / 切换 / 删除 / 双击重命名。 */

const threads = [
  { id: 'a', title: '销售分析', sessionId: null, createdAt: '', updatedAt: '' },
  { id: 'b', title: '库存盘点', sessionId: null, createdAt: '', updatedAt: '' },
]

describe('ThreadSidebar (需求1)', () => {
  it('渲染会话列表并高亮当前会话', () => {
    const w = mount(ThreadSidebar, { props: { threads, currentId: 'b' } })
    const items = w.findAll('.thread-item')
    expect(items).toHaveLength(2)
    expect(items[0].text()).toContain('销售分析')
    expect(items[1].classes()).toContain('active')
  })

  it('点击切换 / 新建按钮 / 删除按钮各自发事件', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const w = mount(ThreadSidebar, { props: { threads, currentId: 'a' } })
    await w.findAll('.thread-item')[1].trigger('click')
    expect(w.emitted('switch')).toEqual([['b']])
    await w.find('[data-testid="new-thread"]').trigger('click')
    expect(w.emitted('new')).toHaveLength(1)
    await w.find('[data-testid="del-a"]').trigger('click')
    expect(w.emitted('remove')).toEqual([['a']])
  })

  it('删除需确认；取消则不发事件', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const w = mount(ThreadSidebar, { props: { threads, currentId: 'a' } })
    await w.find('[data-testid="del-a"]').trigger('click')
    expect(w.emitted('remove')).toBeUndefined()
  })

  it('双击标题触发重命名', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('新标题')
    const w = mount(ThreadSidebar, { props: { threads, currentId: 'a' } })
    await w.findAll('.thread-item')[0].trigger('dblclick')
    expect(w.emitted('rename')).toEqual([['a', '新标题']])
  })

  it('空列表显示占位', () => {
    const w = mount(ThreadSidebar, { props: { threads: [], currentId: '' } })
    expect(w.text()).toContain('暂无会话')
  })
})
