/**
 * vision-P2: A2UI 组件画廊 —— 5 个批次覆盖全部 28 个组件的 surface 定义。
 *
 * 用途：a2ui-gallery.html?batch=<key> 直接渲染对应 surface（chromium headless
 * 截图留证 /tmp/screenshots/READY-VISION-*.png）；每批组件清单与
 * docs/spec/a2ui-component-matrix.md 对应。wire 格式与 gateway ACTIVITY_SNAPSHOT
 * content.a2ui_operations 完全一致（证据: 2026-08-15-a2ui-form-surface.sse）。
 *
 * galleryGuard.test.ts 守护：所有组件名必须在 catalog 白名单内。
 */

export interface GalleryBatch {
  label: string
  components: string[]
  operations: any[]
}

const CAT = 'https://opencode-agui-app.local/a2ui/data-agent-catalog.json'

function ops(surfaceId: string, components: any[], data?: Record<string, unknown>) {
  const out: any[] = [
    { version: 'v0.9', createSurface: { surfaceId, catalogId: CAT } },
    { version: 'v0.9', updateComponents: { surfaceId, components } },
  ]
  if (data) out.push({ version: 'v0.9', updateDataModel: { surfaceId, path: '/', value: data } })
  return out
}

const SALES_ROWS = [
  { region: '华北', sales: 388082, pct: 28 },
  { region: '华东', sales: 412530, pct: 30 },
  { region: '华南', sales: 296410, pct: 21 },
  { region: '西南', sales: 189220, pct: 14 },
]
const TREND = [
  { day: '08-01', v: 42100 }, { day: '08-05', v: 51200 }, { day: '08-09', v: 38800 },
  { day: '08-13', v: 63500 }, { day: '08-15', v: 58900 },
]

// ① 布局容器类：Card Row Column List Tabs Divider Modal（+Text 辅助）
// 注意：Card 契约是单 child（fork catalog.ts 实现），不是 children
const layout = ops('g-layout', [
  { component: 'Column', id: 'root', children: ['t-title', 'card-1', 'tabs-1', 'modal-1'] },
  { component: 'Text', id: 't-title', text: '布局组件画廊', variant: 'h3' },
  { component: 'Card', id: 'card-1', child: 'card-col' },
  { component: 'Column', id: 'card-col', children: ['row-1', 'div-1', 'list-1'] },
  { component: 'Row', id: 'row-1', children: ['row-t1', 'row-t2'], justify: 'spaceBetween' },
  { component: 'Text', id: 'row-t1', text: 'Row 左（spaceBetween）' },
  { component: 'Text', id: 'row-t2', text: 'Row 右', variant: 'caption' },
  { component: 'Divider', id: 'div-1' },
  { component: 'List', id: 'list-1', children: ['li-1', 'li-2', 'li-3'] },
  { component: 'Text', id: 'li-1', text: '• List 项一' },
  { component: 'Text', id: 'li-2', text: '• List 项二' },
  { component: 'Text', id: 'li-3', text: '• List 项三' },
  {
    component: 'Tabs', id: 'tabs-1',
    tabs: [
      { title: '概览', child: 'tab-c1' },
      { title: '明细', child: 'tab-c2' },
    ],
  },
  { component: 'Text', id: 'tab-c1', text: 'Tabs 页签一内容（概览）' },
  { component: 'Text', id: 'tab-c2', text: 'Tabs 页签二内容（明细）' },
  { component: 'Modal', id: 'modal-1', trigger: 'modal-btn', content: 'modal-body' },
  { component: 'Button', id: 'modal-btn', child: 'modal-btn-t', variant: 'primary', action: { event: { name: 'open_modal' } } },
  { component: 'Text', id: 'modal-btn-t', text: '打开 Modal' },
  { component: 'Text', id: 'modal-body', text: '这是 Modal 弹层内容（点击遮罩关闭）' },
])

// ② 表单交互类：TextField CheckBox ChoicePicker Slider DateTimeInput Button
const form = ops('g-form', [
  { component: 'Column', id: 'root', children: ['f-title', 'f-kw', 'f-region', 'f-ret', 'f-slider', 'f-date', 'f-btn'] },
  { component: 'Text', id: 'f-title', text: '表单组件画廊', variant: 'h3' },
  { component: 'TextField', id: 'f-kw', label: '品类关键词', value: { path: 'keyword' } },
  {
    component: 'ChoicePicker', id: 'f-region', label: '区域（chips 多选）', displayStyle: 'chips',
    options: [
      { value: '华北', label: '华北' }, { value: '华东', label: '华东' },
      { value: '华南', label: '华南' }, { value: '西南', label: '西南' },
    ],
    value: { path: 'regions' },
  },
  { component: 'CheckBox', id: 'f-ret', label: '包含退货单', value: { path: 'includeReturns' } },
  { component: 'Slider', id: 'f-slider', label: '销售额阈值（万元）', min: 0, max: 50, value: { path: 'threshold' } },
  { component: 'DateTimeInput', id: 'f-date', label: '统计截止日期', enableDate: true, enableTime: false, value: { path: 'until' } },
  { component: 'Button', id: 'f-btn', child: 'f-btn-t', variant: 'primary', action: { event: { name: 'apply_filter', context: { regions: { path: 'regions' } } } } },
  { component: 'Text', id: 'f-btn-t', text: '应用筛选' },
], { keyword: '钢笔', regions: ['华北', '华东'], includeReturns: true, threshold: 20, until: '2026-08-15' })

// ③ 媒体展示类：Text Image Icon Video AudioPlayer
const media = ops('g-media', [
  { component: 'Column', id: 'root', children: ['m-title', 'm-icon-row', 'm-img', 'm-video', 'm-audio'] },
  { component: 'Text', id: 'm-title', text: '媒体组件画廊', variant: 'h3' },
  { component: 'Row', id: 'm-icon-row', children: ['m-icon', 'm-icon-t'] },
  { component: 'Icon', id: 'm-icon', name: 'bar_chart' },
  { component: 'Text', id: 'm-icon-t', text: 'Icon（material symbols）+ Text caption', variant: 'caption' },
  { component: 'Image', id: 'm-img', url: 'https://picsum.photos/seed/dataagent/640/200', description: '示例图片', variant: 'header' },
  { component: 'Video', id: 'm-video', url: 'https://www.w3schools.com/html/mov_bbb.mp4' },
  { component: 'AudioPlayer', id: 'm-audio', url: 'https://www.w3schools.com/html/horse.mp3', description: '示例音频（AudioPlayer）' },
])

// ④ 自定义图表/数据类：MetricCard BarChart LineChart PieChart DataTable
const charts = ops('g-charts', [
  { component: 'Column', id: 'root', children: ['c-title', 'c-metrics', 'c-bar', 'c-line', 'c-pie', 'c-table'] },
  { component: 'Text', id: 'c-title', text: '图表组件画廊（chart-1~5 色板）', variant: 'h3' },
  { component: 'Row', id: 'c-metrics', children: ['c-m1', 'c-m2', 'c-m3'] },
  { component: 'MetricCard', id: 'c-m1', title: '总销售额', value: '¥1,286,242', delta: '+12.4% 环比', trend: 'up' },
  { component: 'MetricCard', id: 'c-m2', title: '订单量', value: 8642, delta: '-2.1% 环比', trend: 'down' },
  { component: 'MetricCard', id: 'c-m3', title: '客单价', value: '¥148.8', delta: '持平', trend: 'flat' },
  { component: 'BarChart', id: 'c-bar', title: '区域销售额', xField: 'region', yField: 'sales', data: { path: 'sales' } },
  { component: 'LineChart', id: 'c-line', title: '按日销售趋势', xField: 'day', yField: 'v', data: { path: 'trend' } },
  { component: 'PieChart', id: 'c-pie', title: '区域占比', labelField: 'region', valueField: 'pct', data: { path: 'sales' } },
  {
    component: 'DataTable', id: 'c-table', title: '区域明细',
    columns: [{ key: 'region', label: '区域' }, { key: 'sales', label: '销售额' }, { key: 'pct', label: '占比%' }],
    rows: { path: 'sales' },
  },
], { sales: SALES_ROWS, trend: TREND })

// ⑤ 自定义内容类：Badge Markdown InsightCard WarningCard ActionButton
const content = ops('g-content', [
  { component: 'Column', id: 'root', children: ['x-title', 'x-badges', 'x-md', 'x-insight', 'x-warning', 'x-action'] },
  { component: 'Text', id: 'x-title', text: '内容组件画廊', variant: 'h3' },
  { component: 'Row', id: 'x-badges', children: ['x-b1', 'x-b2', 'x-b3', 'x-b4'] },
  { component: 'Badge', id: 'x-b1', text: '默认' },
  { component: 'Badge', id: 'x-b2', text: '成功', variant: 'success' },
  { component: 'Badge', id: 'x-b3', text: '警告', variant: 'warning' },
  { component: 'Badge', id: 'x-b4', text: '危险', variant: 'danger' },
  { component: 'Markdown', id: 'x-md', text: '## 分析结论\n- 华东领跑，占比 **30%**\n- 西南增速最快\n\n建议补货华南仓。' },
  { component: 'InsightCard', id: 'x-insight', title: '洞察', text: '08-13 销售额 6.35 万为半月峰值，与促销活动重合。', variant: 'success' },
  { component: 'WarningCard', id: 'x-warning', title: '库存预警', text: '华南仓钢笔库存低于安全水位（42 < 100）。' },
  { component: 'ActionButton', id: 'x-action', label: '刷新看板', variant: 'primary', action: { event: { name: 'refresh_dashboard', context: { surfaceId: 'g-content' } } } },
])


// ⑥ HITL 确认卡片（vision-P3：request_user_confirm interrupt 形态，与 gateway HitlConfirmHandler 同构）
const hitl = ops('g-hitl', [
  { component: 'Column', id: 'root', children: ['warn', 'actions'] },
  { component: 'WarningCard', id: 'warn', title: '删除确认', text: '将删除 region-sales-2026-08-result.csv，此操作不可恢复。' },
  { component: 'Row', id: 'actions', children: ['confirm', 'cancel'] },
  { component: 'ActionButton', id: 'confirm', label: '确认删除', variant: 'primary', action: { event: { name: 'hitl_confirm', context: { actionId: 'del-region-sales-csv' } } } },
  { component: 'ActionButton', id: 'cancel', label: '取消', action: { event: { name: 'hitl_cancel', context: { actionId: 'del-region-sales-csv' } } } },
])


// ⑦ 边界/异常（vision-P4）：未知组件占位 / 缺必填 prop / 8 层嵌套 / 坏路径绑定 / cycle 防护
const edge = ops('g-edge', [
  { component: 'Column', id: 'root', children: ['e-title', 'e-unknown', 'e-noprop', 'e-deep1', 'e-badpath', 'e-cycle-a', 'e-ok'] },
  { component: 'Text', id: 'e-title', text: '边界/异常健壮性画廊', variant: 'h3' },
  { component: 'Gauge', id: 'e-unknown', value: 42 } as any,  // 不在 catalog → 红字占位 + console.warn
  { component: 'MetricCard', id: 'e-noprop', title: '缺 value 的指标卡' } as any,  // 缺必填 prop
  { component: 'Column', id: 'e-deep1', children: ['e-deep2'] },
  { component: 'Column', id: 'e-deep2', children: ['e-deep3'] },
  { component: 'Column', id: 'e-deep3', children: ['e-deep4'] },
  { component: 'Column', id: 'e-deep4', children: ['e-deep5'] },
  { component: 'Column', id: 'e-deep5', children: ['e-deep6'] },
  { component: 'Column', id: 'e-deep6', children: ['e-deep7'] },
  { component: 'Column', id: 'e-deep7', children: ['e-deep-text'] },
  { component: 'Text', id: 'e-deep-text', text: '↳ 第八层深处正常渲染', variant: 'caption' },
  { component: 'Text', id: 'e-badpath', text: { path: 'nonexistent.field' } },  // 不存在的数据路径
  { component: 'Column', id: 'e-cycle-a', children: ['e-cycle-b'] },  // cycle A↔B
  { component: 'Column', id: 'e-cycle-b', children: ['e-cycle-a'] },
  { component: 'Text', id: 'e-ok', text: '✓ 页面存活：所有异常均被降级处理', variant: 'caption' },
])

export const GALLERY_BATCHES: Record<string, GalleryBatch> = {
  layout: { label: '布局容器类', components: ['Card', 'Row', 'Column', 'List', 'Tabs', 'Divider', 'Modal'], operations: layout },
  form: { label: '表单交互类', components: ['TextField', 'CheckBox', 'ChoicePicker', 'Slider', 'DateTimeInput', 'Button'], operations: form },
  media: { label: '媒体展示类', components: ['Text', 'Image', 'Icon', 'Video', 'AudioPlayer'], operations: media },
  charts: { label: '图表/数据类', components: ['MetricCard', 'BarChart', 'LineChart', 'PieChart', 'DataTable'], operations: charts },
  content: { label: '内容类', components: ['Badge', 'Markdown', 'InsightCard', 'WarningCard', 'ActionButton'], operations: content },
  hitl: { label: 'HITL 确认卡片', components: ['WarningCard', 'ActionButton'], operations: hitl },
  edge: { label: '边界/异常（vision-P4）', components: ['MetricCard', 'Text', 'Column'], operations: edge },
}
