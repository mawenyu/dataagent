import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { h, nextTick } from 'vue'
import { A2UISurfaceActivityRenderer, CopilotKitProvider } from '@copilotkit/vue'
import { HttpAgent } from '@ag-ui/client'
import { DATA_AGENT_CATALOG_ID, dataAgentCatalog } from './dataAgentCatalog'

/**
 * vision-P4: A2UI 协议边界与异常健壮性（spec 附录: a2ui-component-matrix.md）。
 * 每种畸形 payload 一个用例，断言：不白屏（组件树存活 + 正常组件照渲染）+
 * 降级提示可见（占位/警示文案）+ console.warn 留痕。
 */
function mountSurface(components: any[], data?: Record<string, any>) {
  const operations: any[] = [
    { version: 'v0.9', createSurface: { surfaceId: 'edge', catalogId: DATA_AGENT_CATALOG_ID } },
    { version: 'v0.9', updateComponents: { surfaceId: 'edge', components } },
  ]
  if (data) {
    operations.push({ version: 'v0.9', updateDataModel: { surfaceId: 'edge', path: '/', value: data } })
  }
  const agent = new HttpAgent({ url: '/unused-in-test' })
  return mount(CopilotKitProvider as any, {
    props: {
      directAgents: { default: agent },
      a2ui: { catalog: dataAgentCatalog, includeSchema: true },
    },
    slots: {
      default: () =>
        h(A2UISurfaceActivityRenderer as any, {
          activityType: 'a2ui-surface',
          content: { operations },
          message: { id: 'a2ui-edge', role: 'activity', activityType: 'a2ui-surface', content: { operations } },
          catalog: dataAgentCatalog,
          theme: {},
          agent,
        }),
    },
  })
}

describe('A2UI 边界/异常健壮性（vision-P4）', () => {
  it('未知 component type：渲染降级占位 + console.warn，其余组件正常', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const wrapper = mountSurface([
      { component: 'Column', id: 'root', children: ['ok', 'ghost'] },
      { component: 'Text', id: 'ok', text: '正常内容存活' },
      { component: 'Gauge', id: 'ghost', value: 42 },  // 不在 catalog
    ])
    await nextTick(); await nextTick()
    expect(wrapper.text()).toContain('正常内容存活')
    expect(wrapper.text()).toMatch(/Unknown component.*Gauge/)
    expect(warn.mock.calls.some((c) => String(c[0]).includes('Gauge'))).toBe(true)
    warn.mockRestore()
  })

  it('缺失必填 prop（MetricCard 无 value）：不崩，空值降级渲染', async () => {
    const wrapper = mountSurface([
      { component: 'Column', id: 'root', children: ['m', 'ok'] },
      { component: 'MetricCard', id: 'm', title: '只有标题' },  // 缺 value
      { component: 'Text', id: 'ok', text: '页面存活' },
    ])
    await nextTick(); await nextTick()
    expect(wrapper.text()).toContain('只有标题')
    expect(wrapper.text()).toContain('页面存活')
  })

  it('children 深层嵌套（8 层 Column）：正常渲染到最深处', async () => {
    const comps: any[] = [{ component: 'Column', id: 'root', children: ['l1'] }]
    for (let i = 1; i <= 7; i++) {
      comps.push({ component: 'Column', id: `l${i}`, children: [i === 7 ? 'deep' : `l${i + 1}`] })
    }
    comps.push({ component: 'Text', id: 'deep', text: '第八层深处的文字' })
    const wrapper = mountSurface(comps)
    await nextTick(); await nextTick()
    expect(wrapper.text()).toContain('第八层深处的文字')
  })

  it('bind 指向不存在的数据路径：解析为 undefined 降级，不抛错', async () => {
    const wrapper = mountSurface([
      { component: 'Column', id: 'root', children: ['t', 'ok'] },
      { component: 'Text', id: 't', text: { path: 'not.exist' } },
      { component: 'Text', id: 'ok', text: '绑定异常但页面存活' },
    ], { some: { other: 1 } })
    await nextTick(); await nextTick()
    expect(wrapper.text()).toContain('绑定异常但页面存活')
  })

  it('children cycle 引用（A↔B）：渲染终止于 cycle 占位 + console.warn，不死循环', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const wrapper = mountSurface([
      { component: 'Column', id: 'root', children: ['a', 'ok'] },
      { component: 'Column', id: 'a', children: ['b'] },
      { component: 'Column', id: 'b', children: ['a'] },  // cycle!
      { component: 'Text', id: 'ok', text: 'cycle 之外的正常内容' },
    ])
    await nextTick(); await nextTick()
    expect(wrapper.text()).toContain('cycle 之外的正常内容')
    expect(wrapper.text()).toMatch(/[Cc]ycle/)
    expect(warn.mock.calls.some((c) => String(c[0]).toLowerCase().includes('cycle'))).toBe(true)
    warn.mockRestore()
  }, 5000)
})
