import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { h, nextTick } from 'vue'
import { A2UISurfaceActivityRenderer, CopilotKitProvider } from '@copilotkit/vue'
import { HttpAgent } from '@ag-ui/client'
import { DATA_AGENT_CATALOG_ID, dataAgentCatalog } from './dataAgentCatalog'

/**
 * P22: 图表组件真实数据边界 —— 空数据集 / 单点 / 1000+ 点。
 * 断言：不抛错 + 无 NaN/undefined 泄漏进 SVG 属性 + 大数据集在时限内完成。
 */
function mountCharts(components: any[]) {
  const operations: any[] = [
    { version: 'v0.9', createSurface: { surfaceId: 'charts', catalogId: DATA_AGENT_CATALOG_ID } },
    { version: 'v0.9', updateComponents: { surfaceId: 'charts', components } },
  ]
  const agent = new HttpAgent({ url: '/unused-in-test' })
  return mount(CopilotKitProvider as any, {
    props: { directAgents: { default: agent }, a2ui: { catalog: dataAgentCatalog, includeSchema: true } },
    slots: {
      default: () =>
        h(A2UISurfaceActivityRenderer as any, {
          activityType: 'a2ui-surface',
          content: { operations },
          message: { id: 'a2ui-charts', role: 'activity', activityType: 'a2ui-surface', content: { operations } },
          catalog: dataAgentCatalog, theme: {}, agent,
        }),
    },
  })
}

function assertNoNaN(html: string) {
  expect(html).not.toContain('NaN')
  expect(html).not.toContain('undefined')
  expect(html).not.toContain('Infinity')
}

describe('P22 图表边界', () => {
  it('空数据集：三图种优雅空态（标题在，无 NaN 路径）', async () => {
    const wrapper = mountCharts([
      { component: 'Column', id: 'root', children: ['bar', 'line', 'pie'] },
      { component: 'BarChart', id: 'bar', title: '空柱状', xField: 'x', yField: 'y', data: [] },
      { component: 'LineChart', id: 'line', title: '空折线', xField: 'x', yField: 'y', data: [] },
      { component: 'PieChart', id: 'pie', title: '空饼图', labelField: 'l', valueField: 'v', data: [] },
    ])
    await nextTick(); await nextTick()
    expect(wrapper.text()).toContain('空柱状')
    expect(wrapper.text()).toContain('空折线')
    expect(wrapper.text()).toContain('空饼图')
    assertNoNaN(wrapper.html())
  })

  it('单点数据：折线单点/单条柱/单瓣饼（整圆）无 NaN', async () => {
    const wrapper = mountCharts([
      { component: 'Column', id: 'root', children: ['bar', 'line', 'pie'] },
      { component: 'BarChart', id: 'bar', title: '单柱', xField: 'x', yField: 'y', data: [{ x: '唯一', y: 42 }] },
      { component: 'LineChart', id: 'line', title: '单点', xField: 'x', yField: 'y', data: [{ x: '08-01', y: 7 }] },
      { component: 'PieChart', id: 'pie', title: '单瓣', labelField: 'l', valueField: 'v', data: [{ l: '全部', v: 100 }] },
    ])
    await nextTick(); await nextTick()
    expect(wrapper.text()).toContain('42')
    expect(wrapper.text()).toContain('全部 (100%)')
    assertNoNaN(wrapper.html())
  })

  it('全零数据集（值全 0）：不产生 NaN（除零防护）', async () => {
    const wrapper = mountCharts([
      { component: 'Column', id: 'root', children: ['pie', 'bar'] },
      { component: 'PieChart', id: 'pie', title: '零饼', labelField: 'l', valueField: 'v', data: [{ l: 'A', v: 0 }, { l: 'B', v: 0 }] },
      { component: 'BarChart', id: 'bar', title: '零柱', xField: 'x', yField: 'y', data: [{ x: 'A', y: 0 }, { x: 'B', y: 0 }] },
    ])
    await nextTick(); await nextTick()
    assertNoNaN(wrapper.html())
  })

  it('1000+ 点：渲染完成且不卡死（限时）', async () => {
    const big = Array.from({ length: 1200 }, (_, i) => ({ x: `p${i}`, y: (i * 7919) % 100 }))
    const t0 = performance.now()
    const wrapper = mountCharts([
      { component: 'Column', id: 'root', children: ['line', 'bar'] },
      { component: 'LineChart', id: 'line', title: '千点折线', xField: 'x', yField: 'y', data: big },
      { component: 'BarChart', id: 'bar', title: '千点柱状', xField: 'x', yField: 'y', data: big },
    ])
    await nextTick(); await nextTick()
    const ms = performance.now() - t0
    console.log(`[PERF-P22] 2×1200 点图表 jsdom 渲染: ${ms.toFixed(1)}ms`)
    expect(wrapper.text()).toContain('千点折线')
    assertNoNaN(wrapper.html())
    expect(ms).toBeLessThan(15000)
  }, 30000)

  it('大数据集标签抽取：1200 点折线/柱状的 x 标签 ≤12、折线圆点省略', async () => {
    const big = Array.from({ length: 1200 }, (_, i) => ({ x: `p${i}`, y: i % 50 }))
    const wrapper = mountCharts([
      { component: 'Column', id: 'root', children: ['line', 'bar'] },
      { component: 'LineChart', id: 'line', title: 'L', xField: 'x', yField: 'y', data: big },
      { component: 'BarChart', id: 'bar', title: 'B', xField: 'x', yField: 'y', data: big },
    ])
    await nextTick(); await nextTick()
    const svgs = wrapper.findAll('svg')
    expect(svgs.length).toBe(2)
    // 折线只有 x 标签（≤12）；柱状是 x 标签 + 数值标签（各 ≤12）
    expect(svgs[0].findAll('text').length, '折线标签抽取').toBeLessThanOrEqual(12)
    expect(svgs[1].findAll('text').length, '柱状标签+数值抽取').toBeLessThanOrEqual(24)
    // 折线 1200 点不画圆点（>200 省略 markers）
    expect(svgs[0].findAll('circle').length).toBe(0)
  })
})
