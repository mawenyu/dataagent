/**
 * DataAgent custom A2UI catalog (TASK §15).
 *
 * Extends the CopilotKit Vue basic catalog with whitelisted, declarative
 * business components. The agent can only pick a component and supply
 * schema-conforming props/data — never HTML/JS/Vue templates/iframes.
 * Charts take { title, xField, yField, data } and render hand-rolled SVG;
 * the LLM never produces chart library options.
 */
import { h, ref, type VNode } from 'vue'
import { z } from 'zod'
import { Catalog } from '@a2ui/web_core/v0_9'
import { BASIC_FUNCTIONS } from '@a2ui/web_core/v0_9/basic_catalog'
import { createVueComponent, vueBasicCatalog } from '@copilotkit/vue'

export const DATA_AGENT_CATALOG_ID = 'https://opencode-agui-app.local/a2ui/data-agent-catalog.json'

/** prop idiom shared with the basic catalog: literal or data-model binding */
const bindable = (t: z.ZodTypeAny) => z.union([t, z.object({ path: z.string() })])
const boundString = bindable(z.string())
const rowData = z.array(z.record(z.string(), z.any()))
/** 列定义：纯文本或 {key,label?/title?}（模型实测几种都会产出，2026-08-15） */
const columnDef = z.union([
  z.string(),
  z.object({ key: z.string(), label: z.string().optional(), title: z.string().optional() }),
])

// chart-1~5 色板（对齐 ref/adk-dashboard 设计系统）
export const CHART_PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']

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
    return h('div', { class: 'da-card', style: cardStyle }, [
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
      columns: z.array(columnDef),
      // rows 常来自 data model —— 允许 {path} 绑定；行可以是数组或对象记录
      // （{region:"华北",sales:388082} 按列 key 取值，2026-08-15 实测模型行为）
      rows: bindable(z.array(z.union([
        z.array(z.union([z.string(), z.number()])),
        z.record(z.string(), z.any()),
      ]))),
    }),
  } as any,
  ({ props }: any) => {
    const cols: { key: string; label: string }[] = (props.columns ?? []).map((c: any) =>
      typeof c === 'string' ? { key: c, label: c } : { key: String(c?.key ?? ''), label: String(c?.label ?? c?.title ?? c?.key ?? '') })
    const rows: any[] = (props.rows ?? []).map((r: any) =>
      Array.isArray(r) ? r : cols.map((c) => r?.[c.key] ?? ''))
    const th = { textAlign: 'left' as const, fontSize: '12px', color: '#6b7280', padding: '6px 10px', borderBottom: '1px solid #e5e7eb' }
    const td = { fontSize: '13px', color: '#374151', padding: '6px 10px', borderBottom: '1px solid #f1f5f9' }
    return h('div', { class: 'da-card', style: { ...cardStyle, overflowX: 'auto' } }, [
      props.title ? h('p', { style: titleStyle }, String(props.title)) : null,
      h('table', { style: { width: '100%', borderCollapse: 'collapse' } }, [
        h('thead', [h('tr', cols.map((c) => h('th', { style: th, key: c.key }, c.label)))]),
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
  return h('div', { class: 'da-card', style: cardStyle }, [
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
  // P22: 标签抽取步长（最多 ~12 个）
  const labelEvery = Math.max(1, Math.ceil(data.length / 12))
  const bars = data.map((d, i) => {
    const v = Number(d[props.yField]) || 0
    const bh = (v / max) * (H - 30)
    const x = padL + i * barW + barW * 0.15
    return [
      h('rect', {
        key: 'b' + i, x, y: H - 20 - bh, width: barW * 0.7, height: bh, rx: 3, fill: CHART_PALETTE[i % CHART_PALETTE.length],
      }),
      // P22: 大数据集标签抽取（>24 条时最多 12 个标签，防糊成一片）
      (labelEvery === 1 || i % labelEvery === 0) ? h('text', {
        key: 'l' + i, x: x + barW * 0.35, y: H - 6, 'text-anchor': 'middle',
        style: 'font-size:10px;fill:#6b7280',
      }, String(d[props.xField] ?? '')) : null,
      // P22: 数值标签同样抽取（大数据集不逐柱标值）
      (labelEvery === 1 || i % labelEvery === 0) ? h('text', {
        key: 'v' + i, x: x + barW * 0.35, y: H - 24 - bh, 'text-anchor': 'middle',
        style: 'font-size:10px;fill:#374151',
      }, String(v)) : null,
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
  // P22: 大数据集抽取 —— 点标记与 x 标签限量（>60 点不画圆点，标签 ≤12 个）
  const markerEvery = Math.max(1, Math.ceil(data.length / 60))
  const labelEvery = Math.max(1, Math.ceil(data.length / 12))
  const showMarkers = data.length <= 200
  const children: VNode[] = [
    h('polyline', {
      points: points.map((p) => `${p.x},${p.y}`).join(' '),
      fill: 'none', stroke: '#6366f1', 'stroke-width': 2,
    }),
    ...points.filter((_p, i) => showMarkers && i % markerEvery === 0)
      .map((p, i) => h('circle', { key: 'c' + i, cx: p.x, cy: p.y, r: 3, fill: '#6366f1' })),
    ...points.filter((_p, i) => i % labelEvery === 0).map((p, i) =>
      h('text', { key: 'x' + i, x: p.x, y: H - 8, 'text-anchor': 'middle', style: 'font-size:10px;fill:#6b7280' }, p.label)),
  ]
  return chartFrame(props.title, h('svg', { viewBox: `0 0 ${W} ${H}`, style: { width: '100%' } }, children))
}

const chartSchema = z.object({
  title: boundString.optional(),
  xField: z.string(),
  yField: z.string(),
  // data 常来自 data model —— 允许 {path} 绑定（2026-08-15 实测模型行为）
  data: bindable(rowData),
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
    h('div', { class: 'da-card', style: { ...cardStyle, borderLeft: '4px solid #6366f1', background: '#eef2ff' } }, [
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
    h('div', { class: 'da-card', style: { ...cardStyle, borderLeft: '4px solid #f59e0b', background: '#fffbeb' } }, [
      h('p', { style: { ...titleStyle, color: '#b45309' } }, String(props.title ?? '')),
      h('p', { style: { fontSize: '13px', color: '#374151', margin: 0 } }, String(props.text ?? '')),
    ]),
)


// ------------------------------------------------------------- PieChart ---
/** 饼图（SVG 扇区 + 图例），data 支持 {path} 绑定（task4 组件全量） */
const PieChart = createVueComponent(
  {
    name: 'PieChart',
    schema: z.object({
      title: boundString.optional(),
      labelField: z.string(),
      valueField: z.string(),
      data: bindable(rowData),
    }),
  } as any,
  ({ props }: any) => {
    const data: Record<string, any>[] = props.data ?? []
    const total = data.reduce((sum, d) => sum + (Number(d[props.valueField]) || 0), 0) || 1
    const CX = 90
    const CY = 90
    const R = 70
    let angle = -Math.PI / 2
    const slices: VNode[] = []
    const legend: VNode[] = []
    data.forEach((d, i) => {
      const v = Number(d[props.valueField]) || 0
      const frac = v / total
      const a0 = angle
      angle += frac * Math.PI * 2
      const a1 = angle
      const large = frac > 0.5 ? 1 : 0
      const x0 = CX + R * Math.cos(a0)
      const y0 = CY + R * Math.sin(a0)
      const x1 = CX + R * Math.cos(a1)
      const y1 = CY + R * Math.sin(a1)
      const color = CHART_PALETTE[i % CHART_PALETTE.length]
      slices.push(h('path', {
        key: 's' + i,
        d: frac >= 0.9999
          ? `M ${CX} ${CY - R} A ${R} ${R} 0 1 1 ${CX - 0.01} ${CY - R} Z`
          : `M ${CX} ${CY} L ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} Z`,
        fill: color,
      }))
      legend.push(h('div', { key: 'lg' + i, style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#374151' } }, [
        h('span', { style: { width: '10px', height: '10px', borderRadius: '2px', background: color, flex: 'none' } }),
        h('span', `${String(d[props.labelField] ?? '')} (${Math.round(frac * 100)}%)`),
      ]))
    })
    return h('div', { class: 'da-card', style: cardStyle }, [
      props.title ? h('p', { style: titleStyle }, props.title) : null,
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' } }, [
        h('svg', { viewBox: '0 0 180 180', style: { width: '160px', flex: 'none' } }, slices),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } }, legend),
      ]),
    ])
  },
)

// ---------------------------------------------------------------- Badge ---
const BADGE_VARIANTS: Record<string, { bg: string; fg: string }> = {
  default: { bg: '#f1f5f9', fg: '#475569' },
  success: { bg: '#ecfdf5', fg: '#047857' },
  warning: { bg: '#fffbeb', fg: '#b45309' },
  danger: { bg: '#fef2f2', fg: '#b91c1c' },
  info: { bg: '#eef2ff', fg: '#4338ca' },
}
const Badge = createVueComponent(
  {
    name: 'Badge',
    schema: z.object({
      text: boundString,
      variant: z.enum(['default', 'success', 'warning', 'danger', 'info']).optional(),
    }),
  } as any,
  ({ props }: any) => {
    const v = BADGE_VARIANTS[props.variant ?? 'default'] ?? BADGE_VARIANTS.default
    return h('span', {
      style: {
        display: 'inline-block', fontSize: '12px', fontWeight: 600, padding: '3px 10px',
        borderRadius: '999px', background: v.bg, color: v.fg, margin: '4px',
      },
    }, String(props.text ?? ''))
  },
)

// ------------------------------------------------------------- Markdown ---
/** 极简 Markdown 渲染（标题/加粗/斜体/行内代码/无序列表/段落）——声明式文本，无 HTML 注入 */
function inlineMd(text: string, keyPrefix: string): VNode[] {
  const out: VNode[] = []
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(h('span', { key: `${keyPrefix}-t${k++}` }, text.slice(last, m.index)))
    if (m[2] != null) out.push(h('strong', { key: `${keyPrefix}-b${k++}` }, m[2]))
    else if (m[3] != null) out.push(h('em', { key: `${keyPrefix}-e${k++}` }, m[3]))
    else if (m[4] != null) {
      out.push(h('code', {
        key: `${keyPrefix}-c${k++}`,
        style: { background: '#f1f5f9', padding: '1px 5px', borderRadius: '4px', fontSize: '12px' },
      }, m[4]))
    }
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(h('span', { key: `${keyPrefix}-t${k++}` }, text.slice(last)))
  return out
}

function renderMarkdown(md: string): VNode[] {
  const lines = String(md ?? '').split('\n')
  const out: VNode[] = []
  let list: VNode[] = []
  const flushList = () => {
    if (list.length) {
      out.push(h('ul', { key: 'ul' + out.length, style: { margin: '4px 0', paddingLeft: '20px' } }, list))
      list = []
    }
  }
  lines.forEach((line, i) => {
    const t = line.trimEnd()
    if (t.startsWith('### ')) { flushList(); out.push(h('h3', { key: 'l' + i, style: { margin: '8px 0 4px', fontSize: '15px', color: '#111827' } }, inlineMd(t.slice(4), 'h3' + i))) }
    else if (t.startsWith('## ')) { flushList(); out.push(h('h2', { key: 'l' + i, style: { margin: '10px 0 4px', fontSize: '16px', color: '#111827' } }, inlineMd(t.slice(3), 'h2' + i))) }
    else if (t.startsWith('# ')) { flushList(); out.push(h('h1', { key: 'l' + i, style: { margin: '10px 0 6px', fontSize: '18px', color: '#111827' } }, inlineMd(t.slice(2), 'h1' + i))) }
    else if (t.startsWith('- ') || t.startsWith('* ')) { list.push(h('li', { key: 'li' + i, style: { fontSize: '13px', color: '#374151' } }, inlineMd(t.slice(2), 'li' + i))) }
    else if (t === '') { flushList() }
    else { flushList(); out.push(h('p', { key: 'l' + i, style: { margin: '4px 0', fontSize: '13px', color: '#374151', lineHeight: 1.6 } }, inlineMd(t, 'p' + i))) }
  })
  flushList()
  return out
}

const Markdown = createVueComponent(
  {
    name: 'Markdown',
    schema: z.object({ text: boundString }),
  } as any,
  ({ props }: any) =>
    h('div', { class: 'da-card', style: cardStyle }, renderMarkdown(String(props.text ?? ''))),
)

// ---------------------------------------------------------- ActionButton ---
// 2026-08-15 HITL bug 修复：action schema 必须是「含 event 对象的 ZodUnion」——
// GenericBinder.getFieldBehavior 只认这个形态为 ACTION（包成 dispatcher 闭包）；
// 之前写纯 z.object 被当静态对象透传，onClick 绑了个普通对象 → 点击零反应。
const ActionButton = createVueComponent(
  {
    name: 'ActionButton',
    schema: z.object({
      label: boundString,
      variant: z.enum(['default', 'primary', 'borderless']).optional(),
      action: z.union([
        z.object({
          event: z.object({
            name: z.string(),
            context: z.record(z.string(), z.any()).optional(),
          }),
        }),
      ]),
    }),
  } as any,
  ({ props, state }: any) =>
    h(
      'button',
      {
        style: {
          margin: '8px', padding: '8px 16px',
          cursor: state.busy.value ? 'not-allowed' : 'pointer',
          opacity: state.busy.value ? 0.6 : 1,
          border: props.variant === 'borderless' ? 'none' : '1px solid #e5e7eb',
          backgroundColor: props.variant === 'primary' ? '#6366f1' : '#ffffff',
          color: props.variant === 'primary' ? '#ffffff' : '#374151',
          borderRadius: '8px', fontSize: '13px',
          transition: 'opacity 0.15s ease',
        },
        disabled: state.busy.value,
        'aria-busy': state.busy.value ? 'true' : undefined,
        // binder（ACTION 行为）把 action 包成 dispatcher 闭包：点击即回传
        // a2uiAction 续跑 agent；busy 态防重复提交，6s 兜底恢复
        onClick: () => {
          if (state.busy.value) return
          state.busy.value = true
          setTimeout(() => { state.busy.value = false }, 6000)
          props.action?.()
        },
      },
      state.busy.value ? `⏳ ${String(props.label ?? 'Action')}…` : String(props.label ?? 'Action'),
    ),
  () => ({ busy: ref(false) }),
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
    PieChart,
    Badge,
    Markdown,
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
  'PieChart',
  'Badge',
  'Markdown',
]
