/**
 * DataAgent custom A2UI catalog (TASK §15).
 *
 * Extends the CopilotKit Vue basic catalog with whitelisted, declarative
 * business components. The agent can only pick a component and supply
 * schema-conforming props/data — never HTML/JS/Vue templates/iframes.
 * Charts take { title, xField, yField, data } and render hand-rolled SVG;
 * the LLM never produces chart library options.
 */
import { h, type VNode } from 'vue'
import { z } from 'zod'
import { Catalog } from '@a2ui/web_core/v0_9'
import { BASIC_FUNCTIONS } from '@a2ui/web_core/v0_9/basic_catalog'
import { createVueComponent, vueBasicCatalog } from '@copilotkit/vue'

export const DATA_AGENT_CATALOG_ID = 'https://opencode-agui-app.local/a2ui/data-agent-catalog.json'

/** prop idiom shared with the basic catalog: literal or data-model binding */
const bindable = (t: z.ZodTypeAny) => z.union([t, z.object({ path: z.string() })])
const boundString = bindable(z.string())
const rowData = z.array(z.record(z.string(), z.any()))

// ---------------------------------------------------------------- styles ---
const cardStyle = {
  background: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: '10px',
  padding: '14px 16px',
  margin: '8px',
  boxSizing: 'border-box' as const,
}
const titleStyle = { fontSize: '12px', color: '#6b7280', margin: '0 0 4px' }
const valueStyle = { fontSize: '22px', fontWeight: 700, color: '#111827', margin: '0' }

// ------------------------------------------------------------ MetricCard ---
const MetricCard = createVueComponent(
  {
    name: 'MetricCard',
    schema: z.object({
      title: boundString,
      value: bindable(z.union([z.string(), z.number()])),
      delta: boundString.optional(),
      trend: z.enum(['up', 'down', 'flat']).optional(),
    }),
  } as any,
  ({ props }: any) => {
    const trendColor =
      props.trend === 'down' ? '#ef4444' : props.trend === 'flat' ? '#6b7280' : '#10b981'
    return h('div', { style: cardStyle }, [
      h('p', { style: titleStyle }, String(props.title ?? '')),
      h('p', { style: valueStyle }, String(props.value ?? '')),
      props.delta != null
        ? h('p', { style: { ...titleStyle, color: trendColor, margin: '4px 0 0' } }, String(props.delta))
        : null,
    ])
  },
)

// ------------------------------------------------------------ DataTable ---
const DataTable = createVueComponent(
  {
    name: 'DataTable',
    schema: z.object({
      title: boundString.optional(),
      columns: z.array(z.string()),
      rows: z.array(z.array(z.union([z.string(), z.number()]))),
    }),
  } as any,
  ({ props }: any) => {
    const columns: string[] = props.columns ?? []
    const rows: any[][] = props.rows ?? []
    const th = { textAlign: 'left' as const, fontSize: '12px', color: '#6b7280', padding: '6px 10px', borderBottom: '1px solid #e5e7eb' }
    const td = { fontSize: '13px', color: '#374151', padding: '6px 10px', borderBottom: '1px solid #f1f5f9' }
    return h('div', { style: { ...cardStyle, overflowX: 'auto' } }, [
      props.title ? h('p', { style: titleStyle }, String(props.title)) : null,
      h('table', { style: { width: '100%', borderCollapse: 'collapse' } }, [
        h('thead', [h('tr', columns.map((c) => h('th', { style: th, key: c }, c)))]),
        h(
          'tbody',
          rows.map((r, i) =>
            h('tr', { key: i }, r.map((cell, j) => h('td', { style: td, key: j }, String(cell)))),
          ),
        ),
      ]),
    ])
  },
)

// ---------------------------------------------------------- SVG charts ---
interface ChartProps { title?: string; xField: string; yField: string; data: Record<string, any>[] }

function chartFrame(title: string | undefined, plot: VNode) {
  return h('div', { style: cardStyle }, [
    title ? h('p', { style: titleStyle }, title) : null,
    plot,
  ])
}

function renderBarChart(props: ChartProps) {
  const data = props.data ?? []
  const values = data.map((d) => Number(d[props.yField]) || 0)
  const max = Math.max(...values, 1)
  const W = 560
  const H = 180
  const padL = 8
  const barW = data.length ? (W - padL * 2) / data.length : W
  const bars = data.map((d, i) => {
    const v = Number(d[props.yField]) || 0
    const bh = (v / max) * (H - 30)
    const x = padL + i * barW + barW * 0.15
    return [
      h('rect', {
        key: 'b' + i, x, y: H - 20 - bh, width: barW * 0.7, height: bh, rx: 3, fill: '#6366f1',
      }),
      h('text', {
        key: 'l' + i, x: x + barW * 0.35, y: H - 6, 'text-anchor': 'middle',
        style: 'font-size:10px;fill:#6b7280',
      }, String(d[props.xField] ?? '')),
      h('text', {
        key: 'v' + i, x: x + barW * 0.35, y: H - 24 - bh, 'text-anchor': 'middle',
        style: 'font-size:10px;fill:#374151',
      }, String(v)),
    ]
  })
  return chartFrame(props.title, h('svg', { viewBox: `0 0 ${W} ${H}`, style: { width: '100%' } }, bars.flat()))
}

function renderLineChart(props: ChartProps) {
  const data = props.data ?? []
  const values = data.map((d) => Number(d[props.yField]) || 0)
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const W = 560
  const H = 180
  const span = max - min || 1
  const step = data.length > 1 ? (W - 40) / (data.length - 1) : 0
  const points = data.map((d, i) => {
    const x = 20 + i * step
    const y = H - 25 - ((Number(d[props.yField]) || 0) - min) / span * (H - 50)
    return { x, y, label: String(d[props.xField] ?? ''), v: Number(d[props.yField]) || 0 }
  })
  const children: VNode[] = [
    h('polyline', {
      points: points.map((p) => `${p.x},${p.y}`).join(' '),
      fill: 'none', stroke: '#6366f1', 'stroke-width': 2,
    }),
    ...points.map((p, i) => h('circle', { key: 'c' + i, cx: p.x, cy: p.y, r: 3, fill: '#6366f1' })),
    ...points.map((p, i) =>
      h('text', { key: 'x' + i, x: p.x, y: H - 8, 'text-anchor': 'middle', style: 'font-size:10px;fill:#6b7280' }, p.label)),
  ]
  return chartFrame(props.title, h('svg', { viewBox: `0 0 ${W} ${H}`, style: { width: '100%' } }, children))
}

const chartSchema = z.object({
  title: boundString.optional(),
  xField: z.string(),
  yField: z.string(),
  data: rowData,
})

const BarChart = createVueComponent({ name: 'BarChart', schema: chartSchema } as any, ({ props }: any) =>
  renderBarChart(props),
)
const LineChart = createVueComponent({ name: 'LineChart', schema: chartSchema } as any, ({ props }: any) =>
  renderLineChart(props),
)

// ---------------------------------------------------- Insight / Warning ---
const InsightCard = createVueComponent(
  {
    name: 'InsightCard',
    schema: z.object({
      title: boundString,
      text: boundString,
      variant: z.enum(['info', 'success']).optional(),
    }),
  } as any,
  ({ props }: any) =>
    h('div', { style: { ...cardStyle, borderLeft: '4px solid #6366f1', background: '#eef2ff' } }, [
      h('p', { style: { ...titleStyle, color: '#4338ca' } }, String(props.title ?? '')),
      h('p', { style: { fontSize: '13px', color: '#374151', margin: 0 } }, String(props.text ?? '')),
    ]),
)

const WarningCard = createVueComponent(
  {
    name: 'WarningCard',
    schema: z.object({ title: boundString, text: boundString }),
  } as any,
  ({ props }: any) =>
    h('div', { style: { ...cardStyle, borderLeft: '4px solid #f59e0b', background: '#fffbeb' } }, [
      h('p', { style: { ...titleStyle, color: '#b45309' } }, String(props.title ?? '')),
      h('p', { style: { fontSize: '13px', color: '#374151', margin: 0 } }, String(props.text ?? '')),
    ]),
)

// ---------------------------------------------------------- ActionButton ---
const ActionButton = createVueComponent(
  {
    name: 'ActionButton',
    schema: z.object({
      label: boundString,
      variant: z.enum(['default', 'primary', 'borderless']).optional(),
      action: z.object({
        event: z.object({
          name: z.string(),
          context: z.record(z.string(), z.any()).optional(),
        }),
      }),
    }),
  } as any,
  ({ props }: any) =>
    h(
      'button',
      {
        style: {
          margin: '8px', padding: '8px 16px', cursor: 'pointer',
          border: props.variant === 'borderless' ? 'none' : '1px solid #e5e7eb',
          backgroundColor: props.variant === 'primary' ? '#6366f1' : '#ffffff',
          color: props.variant === 'primary' ? '#ffffff' : '#374151',
          borderRadius: '8px', fontSize: '13px',
        },
        // resolved by the A2UI binder into the action dispatcher
        onClick: props.action,
      },
      String(props.label ?? 'Action'),
    ),
)

// -------------------------------------------------------------- catalog ---
export const dataAgentCatalog = new Catalog(
  DATA_AGENT_CATALOG_ID,
  [
    ...Array.from(vueBasicCatalog.components.values()),
    MetricCard,
    DataTable,
    BarChart,
    LineChart,
    InsightCard,
    WarningCard,
    ActionButton,
  ] as any,
  BASIC_FUNCTIONS as any,
)

/** custom component names (for docs/tests; Java mirrors this whitelist) */
export const DATA_AGENT_CUSTOM_COMPONENTS = [
  'MetricCard',
  'DataTable',
  'BarChart',
  'LineChart',
  'InsightCard',
  'WarningCard',
  'ActionButton',
]
