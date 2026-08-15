# A2UI 组件覆盖矩阵（vision 任务 · 目标1）

> catalog 单一真源：`vue-frontend/src/a2ui/dataAgentCatalog.ts` = fork `vueBasicCatalog`（18 标准组件）+ 10 自定义。
> 白名单三处同源：本文件 / gateway `A2UiBridgeService.ALLOWED_COMPONENTS` / 插件 `a2ui-tools.ts CATALOG_COMPONENTS`（2026-08-15 已补齐 Video/AudioPlayer/Modal）。
> 状态图例：✅ 实测渲染通过（SSE 证据 + 截图）｜ 🔶 已注册待实测 ｜ ❌ 有 bug（附说明）
> 截图命名：/tmp/screenshots/READY-VISION-<批次>-<组件>.png（Hermes vision 识别验证）

## 布局容器类（7）

| 组件 | 契约要点 | SSE 证据 | 截图 | 状态 |
|---|---|---|---|---|
| Card | 容器卡片，child 单个（children 由 gateway 归一） | docs/evidence/2026-08-15-vision-b-layout.sse | READY-VISION-layout.png | ✅ |
| Row | 水平布局，justify/align | docs/evidence/2026-08-15-vision-b-layout.sse | READY-VISION-layout.png | ✅ |
| Column | 垂直布局 | docs/evidence/2026-08-15-vision-b-layout.sse | READY-VISION-layout.png | ✅ |
| List | 列表容器 | docs/evidence/2026-08-15-vision-b-layout.sse | READY-VISION-layout.png | ✅ |
| Tabs | 页签容器 | docs/evidence/2026-08-15-vision-b-layout.sse | READY-VISION-layout.png | ✅ |
| Divider | 分隔线 | docs/evidence/2026-08-15-vision-b-layout.sse | READY-VISION-layout.png | ✅ |
| Modal | 弹层（触发器+内容） | docs/evidence/2026-08-15-vision-b-layout.sse | READY-VISION-layout.png | ✅（弹层为交互态，截图含 trigger） |

## 表单交互类（6）

| 组件 | 契约要点 | SSE 证据 | 截图 | 状态 |
|---|---|---|---|---|
| TextField | 文本输入，bind 数据模型 | docs/evidence/2026-08-15-vision-b-form.sse | READY-VISION-form.png | ✅ |
| CheckBox | 勾选 | docs/evidence/2026-08-15-vision-b-form.sse | READY-VISION-form.png | ✅ |
| ChoicePicker | 单选/多选 | docs/evidence/2026-08-15-vision-b-form.sse | READY-VISION-form.png | ✅ |
| Slider | 滑杆 | docs/evidence/2026-08-15-vision-b-form.sse | READY-VISION-form.png | ✅ |
| DateTimeInput | 日期时间 | docs/evidence/2026-08-15-vision-b-form.sse | READY-VISION-form.png | ✅ |
| Button | 按钮 + action 回传 | docs/evidence/2026-08-15-vision-b-form.sse | READY-VISION-form.png | ✅ |

## 媒体展示类（5）

| 组件 | 契约要点 | SSE 证据 | 截图 | 状态 |
|---|---|---|---|---|
| Text | 文本（含 markdown 变体） | docs/evidence/2026-08-15-vision-b-media.sse | READY-VISION-media.png | ✅ |
| Image | 图片 url | docs/evidence/2026-08-15-vision-b-media.sse | READY-VISION-media.png | ✅ |
| Icon | 图标 | docs/evidence/2026-08-15-vision-b-media.sse | READY-VISION-media.png | ✅ |
| Video | 视频 | docs/evidence/2026-08-15-vision-b-media.sse | READY-VISION-media.png | ✅ |
| AudioPlayer | 音频 | docs/evidence/2026-08-15-vision-b-media.sse | READY-VISION-media.png | ✅ |

## 自定义图表/数据类（5）

| 组件 | 契约要点 | SSE 证据 | 截图 | 状态 |
|---|---|---|---|---|
| MetricCard | title/value/delta/trend | docs/evidence/2026-08-15-vision-b-charts.sse | READY-VISION-charts.png | ✅ |
| BarChart | title/xField/yField/data，chart-1~5 色板 | docs/evidence/2026-08-15-vision-b-charts.sse | READY-VISION-charts.png | ✅ |
| LineChart | 同上 | docs/evidence/2026-08-15-vision-b-charts.sse | READY-VISION-charts.png | ✅ |
| PieChart | 同上 | docs/evidence/2026-08-15-vision-b-charts.sse | READY-VISION-charts.png | ✅ |
| DataTable | columns/rows（数组或对象行） | docs/evidence/2026-08-15-vision-b-charts.sse | READY-VISION-charts.png | ✅ |

## 自定义内容类（5）

| 组件 | 契约要点 | SSE 证据 | 截图 | 状态 |
|---|---|---|---|---|
| Badge | 标签 | docs/evidence/2026-08-15-vision-b-content.sse | READY-VISION-content.png | ✅ |
| Markdown | 手写轻量 markdown 渲染 | docs/evidence/2026-08-15-vision-b-content.sse | READY-VISION-content.png | ✅ |
| InsightCard | 洞察卡片 | docs/evidence/2026-08-15-vision-b-content.sse | READY-VISION-content.png | ✅ |
| WarningCard | 警告卡片 | docs/evidence/2026-08-15-vision-b-content.sse | READY-VISION-content.png | ✅ |
| ActionButton | 按钮 + A2UI action → 真实 agent 续跑 | docs/evidence/2026-08-15-vision-b-content.sse | READY-VISION-content.png | ✅（action 回传实测见 a2ui-action.sse） |

## 统计

- 28 个组件（18 标准 + 10 自定义）：**✅ 28 / 28（2026-08-15 全部闭环）**。
- 实测过程修复的真实缺陷：① 插件漏列 Video/AudioPlayer/Modal（P0）；② 模型自创契约导致整面拒渲染 —— gateway 新增 normalizeComponents 确定性归一（Tabs items / Text value / Row justifyContent / Modal children / Button label / Card children，7 个单测）；③ Icon 缺 material symbols 字体（index.html + gallery 引入）；④ 画廊守卫测试锁定 28 组件全覆盖。
- 画廊页：/agui/a2ui-gallery.html?batch=layout|form|media|charts|content（与聊天区同渲染链路）。
- 实测批次：① 布局 ② 表单 ③ 媒体 ④ 图表 ⑤ 内容（每批一次真实 agent run + 整面截图）。
