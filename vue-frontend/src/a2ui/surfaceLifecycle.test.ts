import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { h, nextTick, ref } from 'vue'
import { A2UISurfaceActivityRenderer, CopilotKitProvider } from '@copilotkit/vue'
import { HttpAgent } from '@ag-ui/client'
import { DATA_AGENT_CATALOG_ID, dataAgentCatalog } from './dataAgentCatalog'

/**
 * P10: A2UI surface 生命周期 —— 更新/替换/关闭的协议边界与渲染正确性。
 * harness 用响应式 operations 驱动（与真实链路 content 变化触发 reprocess 一致）。
 */
function mountLifecycle(initialOps: any[]) {
  const opsRef = ref<any[]>(initialOps)
  const agent = new HttpAgent({ url: '/unused-in-test' })
  const wrapper = mount(CopilotKitProvider as any, {
    props: { directAgents: { default: agent }, a2ui: { catalog: dataAgentCatalog, includeSchema: true } },
    slots: {
      default: () =>
        h(A2UISurfaceActivityRenderer as any, {
          activityType: 'a2ui-surface',
          content: { operations: opsRef.value },
          message: { id: 'a2ui-life', role: 'activity', activityType: 'a2ui-surface', content: {} },
          catalog: dataAgentCatalog,
          theme: {},
          agent,
        }),
    },
  })
  return {
    wrapper,
    /** 推送新一批 ops（模拟新 ACTIVITY_SNAPSHOT 到达）。 */
    async push(ops: any[]) {
      opsRef.value = [...opsRef.value, ...ops]
      await nextTick(); await nextTick(); await nextTick()
    },
  }
}

const create = (sid: string) => ({ version: 'v0.9', createSurface: { surfaceId: sid, catalogId: DATA_AGENT_CATALOG_ID } })
const update = (sid: string, components: any[]) => ({ version: 'v0.9', updateComponents: { surfaceId: sid, components } })
const del = (sid: string) => ({ version: 'v0.9', deleteSurface: { surfaceId: sid } })

describe('P10 surface 生命周期', () => {
  it('更新：同 surface 二次 updateComponents → DOM 就地更新', async () => {
    const { wrapper, push } = mountLifecycle([
      create('s1'),
      update('s1', [
        { component: 'Column', id: 'root', children: ['t'] },
        { component: 'Text', id: 't', text: '第一版' },
      ]),
    ])
    await nextTick(); await nextTick()
    expect(wrapper.text()).toContain('第一版')

    await push([update('s1', [{ component: 'Text', id: 't', text: '第二版' }])])
    expect(wrapper.text()).toContain('第二版')
    expect(wrapper.text()).not.toContain('第一版')
  })

  it('同 id 重发（完全相同的 ops 再到一帧）：去重跳过，DOM 不变不报错', async () => {
    const ops = [
      create('s1'),
      update('s1', [
        { component: 'Column', id: 'root', children: ['t'] },
        { component: 'Text', id: 't', text: '稳定内容' },
      ]),
    ]
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { wrapper, push } = mountLifecycle(ops)
    await nextTick(); await nextTick()
    expect(wrapper.text()).toContain('稳定内容')

    // 模拟同快照重发（网络重放/历史回放）：渲染器 lastOpsHash 去重
    await push([])
    expect(wrapper.text()).toContain('稳定内容')
    expect(wrapper.text()).not.toContain('render error')
    warn.mockRestore()
  })

  it('缺失 target：对不存在 surface 的 update → 跳过该 op + console.warn，正常 surface 不受影响，不出错误框', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { wrapper } = mountLifecycle([
      update('ghost-surface', [{ component: 'Text', id: 'root', text: '幽灵' }]),
      create('s1'),
      update('s1', [
        { component: 'Column', id: 'root', children: ['t'] },
        { component: 'Text', id: 't', text: '正常 surface 存活' },
      ]),
    ])
    await nextTick(); await nextTick()
    expect(wrapper.text()).toContain('正常 surface 存活')
    expect(wrapper.text()).not.toContain('render error')
    expect(warn.mock.calls.some((c) => String(c[0]).includes('ghost-surface'))).toBe(true)
    warn.mockRestore()
  })

  it('关闭：deleteSurface → 整面从 DOM 移除；后续再发该面 update → 跳过不崩', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { wrapper, push } = mountLifecycle([
      create('s1'),
      update('s1', [
        { component: 'Column', id: 'root', children: ['t'] },
        { component: 'Text', id: 't', text: '将被关闭的面板' },
      ]),
      create('s2'),
      update('s2', [
        { component: 'Column', id: 'root', children: ['t'] },
        { component: 'Text', id: 't', text: '保留面板' },
      ]),
    ])
    await nextTick(); await nextTick()
    expect(wrapper.text()).toContain('将被关闭的面板')

    await push([del('s1')])
    expect(wrapper.text()).not.toContain('将被关闭的面板')
    expect(wrapper.text()).toContain('保留面板')

    // 已关闭面的迟到 update → 跳过 + warn，不崩
    await push([update('s1', [{ component: 'Text', id: 't', text: '迟到更新' }])])
    expect(wrapper.text()).not.toContain('迟到更新')
    expect(wrapper.text()).toContain('保留面板')
    warn.mockRestore()
  })

  it('嵌套关闭：深层嵌套 + 数据绑定的 surface 整体关闭，无残留无报错', async () => {
    const errors: unknown[] = []
    const errSpy = vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a))
    const { wrapper, push } = mountLifecycle([
      create('deep'),
      update('deep', [
        { component: 'Column', id: 'root', children: ['a', 'metric'] },
        { component: 'Column', id: 'a', children: ['b'] },
        { component: 'Column', id: 'b', children: ['c'] },
        { component: 'Text', id: 'c', text: { path: '/deep/value' } },  // 嵌套路径必须 JSON-pointer（实测点号不解析）
        { component: 'MetricCard', id: 'metric', title: 'KPI', value: { path: 'kpi' } },
      ]),
      { version: 'v0.9', updateDataModel: { surfaceId: 'deep', path: '/', value: { deep: { value: '深层绑定文本' }, kpi: 42 } } },
    ])
    await nextTick(); await nextTick()
    expect(wrapper.text()).toContain('深层绑定文本')
    expect(wrapper.text()).toContain('42')

    await push([del('deep')])
    expect(wrapper.text()).not.toContain('深层绑定文本')
    expect(errors, '关闭过程无 Vue 报错').toHaveLength(0)
    errSpy.mockRestore()
  })

  it('P19 更新流：updateDataModel 改绑定值 → DOM 随之更新（数据驱动渲染闭环）', async () => {
    const { wrapper, push } = mountLifecycle([
      create('dash'),
      update('dash', [
        { component: 'Column', id: 'root', children: ['m'] },
        { component: 'MetricCard', id: 'm', title: '总销售额', value: { path: 'total' } },
      ]),
      { version: 'v0.9', updateDataModel: { surfaceId: 'dash', path: '/', value: { total: 100 } } },
    ])
    await nextTick(); await nextTick()
    expect(wrapper.text()).toContain('100')

    await push([{ version: 'v0.9', updateDataModel: { surfaceId: 'dash', path: '/', value: { total: 999 } } }])
    expect(wrapper.text()).toContain('999')
    expect(wrapper.text()).not.toContain('100')
  })
})
