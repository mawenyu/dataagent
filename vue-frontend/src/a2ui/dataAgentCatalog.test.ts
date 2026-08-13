import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { h, nextTick } from 'vue'
import { A2UISurfaceActivityRenderer, CopilotKitProvider } from '@copilotkit/vue'
import { HttpAgent } from '@ag-ui/client'
import { DATA_AGENT_CATALOG_ID, dataAgentCatalog } from './dataAgentCatalog'

/**
 * DataAgent custom catalog render test (TASK §15): drive the real A2UI
 * processor path with declarative operations using every custom component
 * and assert real DOM output.
 */
function mountSurface(components: any[], data?: Record<string, any>) {
  const operations: any[] = [
    { version: 'v0.9', createSurface: { surfaceId: 'custom-demo', catalogId: DATA_AGENT_CATALOG_ID } },
    { version: 'v0.9', updateComponents: { surfaceId: 'custom-demo', components } },
  ]
  if (data) {
    operations.push({ version: 'v0.9', updateDataModel: { surfaceId: 'custom-demo', path: '/', value: data } })
  }
  // the renderer needs the provider context (useCopilotKit); no run is
  // started, so the dummy direct agent never touches the network
  return mount(CopilotKitProvider as any, {
    props: {
      directAgents: { default: new HttpAgent({ url: '/unused-in-test' }) },
      a2ui: { catalog: dataAgentCatalog, includeSchema: true },
    },
    slots: {
      default: () =>
        h(A2UISurfaceActivityRenderer as any, {
          activityType: 'a2ui-surface',
          content: { operations },
          message: {
            id: 'a2ui-custom-demo',
            role: 'activity',
            activityType: 'a2ui-surface',
            content: { operations },
          },
          catalog: dataAgentCatalog,
          theme: {},
        }),
    },
  })
}

const salesData = [
  { region: '华东', sales: 86400 },
  { region: '华北', sales: 72150 },
  { region: '华南', sales: 65980 },
]

describe('DataAgent custom catalog (TASK §15)', () => {
  it('renders MetricCard / DataTable / BarChart / LineChart / InsightCard / WarningCard / ActionButton', async () => {
    const wrapper = mountSurface([
      { component: 'Column', id: 'root', children: ['metric', 'table', 'bar', 'line', 'insight', 'warning', 'action'] },
      { component: 'MetricCard', id: 'metric', title: '本月销售额', value: '1,234,567', delta: '+12%', trend: 'up' },
      {
        component: 'DataTable', id: 'table', title: '区域明细',
        columns: ['区域', '销售额'],
        rows: [['华东', 86400], ['华北', 72150]],
      },
      { component: 'BarChart', id: 'bar', title: '区域销售', xField: 'region', yField: 'sales', data: salesData },
      { component: 'LineChart', id: 'line', title: '月度趋势', xField: 'region', yField: 'sales', data: salesData },
      { component: 'InsightCard', id: 'insight', title: '洞察', text: '华东区领跑，环比增长 12%' },
      { component: 'WarningCard', id: 'warning', title: '库存预警', text: 'SKU-1024 库存低于安全线' },
      {
        component: 'ActionButton', id: 'action', label: '查看华东区', variant: 'primary',
        action: { event: { name: 'filter_region', context: { region: '华东' } } },
      },
    ])
    await nextTick()
    await nextTick()

    const text = wrapper.text()
    // MetricCard
    expect(text).toContain('本月销售额')
    expect(text).toContain('1,234,567')
    expect(text).toContain('+12%')
    // DataTable
    expect(text).toContain('区域明细')
    expect(wrapper.findAll('th').length).toBe(2)
    expect(wrapper.findAll('td').length).toBe(4)
    expect(text).toContain('72150')
    // BarChart: one rect per datum
    expect(wrapper.findAll('rect').length).toBe(3)
    // LineChart: polyline + one circle per datum
    expect(wrapper.findAll('polyline').length).toBe(1)
    expect(wrapper.findAll('circle').length).toBe(3)
    // Insight / Warning
    expect(text).toContain('华东区领跑，环比增长 12%')
    expect(text).toContain('SKU-1024 库存低于安全线')
    // ActionButton renders a clickable button bound to the A2UI action
    const btn = wrapper.find('button')
    expect(btn.exists()).toBe(true)
    expect(text).toContain('查看华东区')
    // declarative only: no script/iframe ever rendered
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.find('iframe').exists()).toBe(false)
  })

  it('resolves data-model bindings in custom components', async () => {
    const wrapper = mountSurface(
      [
        { component: 'MetricCard', id: 'root', title: '本月销售额', value: { path: 'total' }, delta: { path: 'delta' } },
      ],
      { total: '987,654', delta: '-3%' },
    )
    await nextTick()
    await nextTick()
    expect(wrapper.text()).toContain('987,654')
    expect(wrapper.text()).toContain('-3%')
  })
})
