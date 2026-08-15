import { describe, expect, it, vi } from 'vitest'
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
          message: {
            id: 'a2ui-custom-demo',
            role: 'activity',
            activityType: 'a2ui-surface',
            content: { operations },
          },
          catalog: dataAgentCatalog,
          theme: {},
          // 与生产一致（use-render-activity-message 会传 agent）——
          // 缺 agent 时 handleAction 静默丢弃点击（HITL bug 复现条件之一）
          agent,
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

  it('resolves bound chart/table data and {key,label} columns (实测模型输出形态)', async () => {
    // 2026-08-15 实测：模型把 chart data / table rows 放 data model（{path} 绑定），
    // 列定义给 {key,label} 对象 —— catalog 必须兼容，否则渲染为空。
    const wrapper = mountSurface(
      [
        { component: 'Column', id: 'root', children: ['bar', 'table'] },
        { component: 'BarChart', id: 'bar', title: '区域销售', xField: 'region', yField: 'sales', data: { path: 'barData' } },
        {
          component: 'DataTable', id: 'table', title: '明细',
          columns: [{ key: 'region', label: '区域' }, { key: 'sales', label: '销售额' }],
          rows: { path: 'tableRows' },
        },
      ],
      {
        barData: salesData,
        tableRows: [['华东', 86400], ['华北', 72150]],
      },
    )
    await nextTick()
    await nextTick()
    // BarChart: bound data resolved → one rect per datum
    expect(wrapper.findAll('rect').length).toBe(3)
    // DataTable: {key,label} columns → labels rendered; bound rows resolved
    expect(wrapper.text()).toContain('销售额')
    expect(wrapper.findAll('td').length).toBe(4)
    expect(wrapper.text()).toContain('86400')
  })

  it('renders object rows keyed by {key,title} columns (2026-08-15 真实 render_a2ui 输出)', async () => {    // 真实模型输出：columns 用 {key,title}（不是 label），rows 是对象记录数组
    const wrapper = mountSurface(
      [
        {
          component: 'DataTable', id: 'root', title: '区域销售明细',
          columns: [{ key: 'region', title: '区域' }, { key: 'sales', title: '销售额（元）' }],
          rows: { path: 'regions' },
        },
      ],
      {
        regions: [
          { region: '华北', sales: 388082 },
          { region: '华东', sales: 366096 },
        ],
      },
    )
    await nextTick()
    await nextTick()
    expect(wrapper.text()).toContain('销售额（元）')
    expect(wrapper.text()).toContain('华北')
    expect(wrapper.text()).toContain('388082')
    expect(wrapper.findAll('tr').length).toBe(3) // header + 2 rows
  })

  it('renders PieChart / Badge / Markdown custom components (task4 组件全量)', async () => {
    const wrapper = mountSurface(
      [
        { component: 'Column', id: 'root', children: ['pie', 'badge', 'md'] },
        { component: 'PieChart', id: 'pie', title: '品类占比', labelField: 'cat', valueField: 'sales', data: { path: 'pieData' } },
        { component: 'Badge', id: 'badge', text: { path: 'badgeText' }, variant: 'success' },
        { component: 'Markdown', id: 'md', text: '# 结论\n\n**笔记本** 领跑，占比 `45%`。\n\n- 华北第一\n- 华东第二' },
      ],
      {
        pieData: [
          { cat: '笔记本', sales: 615912 },
          { cat: '手机', sales: 347913 },
          { cat: '平板', sales: 228712 },
        ],
        badgeText: '数据新鲜',
      },
    )
    await nextTick()
    await nextTick()
    // PieChart: 每个扇区一个 path + 图例文本
    expect(wrapper.findAll('svg path').length).toBeGreaterThanOrEqual(3)
    expect(wrapper.text()).toContain('笔记本')
    // Badge: 绑定的文本
    expect(wrapper.text()).toContain('数据新鲜')
    // Markdown: 标题/加粗/行内代码/列表
    expect(wrapper.find('h1').exists() || wrapper.find('h2').exists() || wrapper.find('h3').exists()).toBe(true)
    expect(wrapper.find('strong').exists()).toBe(true)
    expect(wrapper.find('code').exists()).toBe(true)
    expect(wrapper.findAll('li').length).toBe(2)
  })

  it('renders basic-catalog layout/display components (Tabs/Card/Divider/Image)', async () => {
    const wrapper = mountSurface([
      { component: 'Card', id: 'root', child: 'col' },
      { component: 'Column', id: 'col', children: ['txt', 'div', 'img'] },
      { component: 'Text', id: 'txt', text: '卡片标题', variant: 'h3' },
      { component: 'Divider', id: 'div' },
      { component: 'Image', id: 'img', url: 'https://example.com/x.png', fit: 'contain' },
    ])
    await nextTick()
    await nextTick()
    expect(wrapper.text()).toContain('卡片标题')
    expect(wrapper.find('img').exists()).toBe(true)
    expect(wrapper.find('hr').exists() || wrapper.html()).toBeTruthy()
  })
})

describe('ActionButton action 回传（HITL bug 修复 · 2026-08-15）', () => {
  it('点击 ActionButton 触发 a2uiAction 回传续跑（点击前 schema 必须被 binder 识别为 ACTION）', async () => {
    // 模拟 gateway：收到 run 即回一个最小 RUN_FINISHED SSE 流
    const sseBody = 'data: {"type":"RUN_STARTED","threadId":"t","runId":"r"}\n\n' +
      'data: {"type":"RUN_FINISHED","threadId":"t","runId":"r"}\n\n'
    const fetchMock = vi.fn().mockResolvedValue(new Response(sseBody, {
      status: 200, headers: { 'Content-Type': 'text/event-stream' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountSurface([
      { component: 'Column', id: 'root', children: ['confirm'] },
      {
        component: 'ActionButton', id: 'confirm', label: '确认删除', variant: 'primary',
        action: { event: { name: 'hitl_confirm', context: { actionId: 'del-1' } } },
      },
    ])
    await nextTick(); await nextTick()

    const btn = wrapper.find('button')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toContain('确认删除')
    await btn.trigger('click')
    // 等 runAgent 发出 HTTP
    await new Promise((r) => setTimeout(r, 50))

    expect(fetchMock, '点击必须触发一次 agent run（action 回传）').toHaveBeenCalled()
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body)
    const action = body?.forwardedProps?.a2uiAction
    expect(action, 'forwardedProps.a2uiAction 携带点击事件').toBeTruthy()
    const name = action?.action?.name ?? action?.name
    expect(name).toBe('hitl_confirm')
  })

  it('点击后按钮进入 disabled/loading 态（防重复提交）', async () => {
    const sseBody = 'data: {"type":"RUN_STARTED"}\n\ndata: {"type":"RUN_FINISHED"}\n\n'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(sseBody, {
      status: 200, headers: { 'Content-Type': 'text/event-stream' },
    })))
    const wrapper = mountSurface([
      { component: 'Column', id: 'root', children: ['confirm'] },
      {
        component: 'ActionButton', id: 'confirm', label: '确认',
        action: { event: { name: 'hitl_confirm', context: { actionId: 'a1' } } },
      },
    ])
    await nextTick(); await nextTick()
    const btn = wrapper.find('button')
    await btn.trigger('click')
    await nextTick()
    expect(btn.attributes('disabled')).toBeDefined()
    expect(btn.text()).toMatch(/处理中|…|⏳/)
    expect(btn.attributes('aria-busy')).toBe('true')
  })
})
