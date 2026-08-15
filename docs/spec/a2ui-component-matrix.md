# A2UI 组件覆盖矩阵（vision 任务 · 目标1）

> catalog 单一真源：`vue-frontend/src/a2ui/dataAgentCatalog.ts` = fork `vueBasicCatalog`（18 标准组件）+ 10 自定义。
> 白名单三处同源：本文件 / gateway `A2UiBridgeService.ALLOWED_COMPONENTS` / 插件 `a2ui-tools.ts CATALOG_COMPONENTS`（2026-08-15 已补齐 Video/AudioPlayer/Modal）。
> 状态图例：✅ 实测渲染通过（SSE 证据 + 截图）｜ 🔶 已注册待实测 ｜ ❌ 有 bug（附说明）
> 截图命名：/tmp/screenshots/READY-VISION-<批次>-<组件>.png（Hermes vision 识别验证）

## 布局容器类（7）

| 组件 | 契约要点 | SSE 证据 | 截图 | 状态 |
|---|---|---|---|---|
| Card | 容器卡片，children | | | 🔶 |
| Row | 水平布局，justify/align | | | 🔶 |
| Column | 垂直布局 | | | 🔶 |
| List | 列表容器 | | | 🔶 |
| Tabs | 页签容器 | | | 🔶 |
| Divider | 分隔线 | | | 🔶 |
| Modal | 弹层（触发器+内容） | | | 🔶 |

## 表单交互类（6）

| 组件 | 契约要点 | SSE 证据 | 截图 | 状态 |
|---|---|---|---|---|
| TextField | 文本输入，bind 数据模型 | | | 🔶 |
| CheckBox | 勾选 | | | 🔶 |
| ChoicePicker | 单选/多选 | | | 🔶 |
| Slider | 滑杆 | | | 🔶 |
| DateTimeInput | 日期时间 | | | 🔶 |
| Button | 按钮 + action 回传 | | | 🔶 |

## 媒体展示类（5）

| 组件 | 契约要点 | SSE 证据 | 截图 | 状态 |
|---|---|---|---|---|
| Text | 文本（含 markdown 变体） | | | 🔶 |
| Image | 图片 url | | | 🔶 |
| Icon | 图标 | | | 🔶 |
| Video | 视频 | | | 🔶 |
| AudioPlayer | 音频 | | | 🔶 |

## 自定义图表/数据类（5）

| 组件 | 契约要点 | SSE 证据 | 截图 | 状态 |
|---|---|---|---|---|
| MetricCard | title/value/delta/trend | 已有（task4/5 样本） | | 🔶 待截图 |
| BarChart | title/xField/yField/data，chart-1~5 色板 | 已有 | | 🔶 待截图 |
| LineChart | 同上 | 已有 | | 🔶 待截图 |
| PieChart | 同上 | 已有 | | 🔶 待截图 |
| DataTable | columns/rows（数组或对象行） | 已有 | | 🔶 待截图 |

## 自定义内容类（5）

| 组件 | 契约要点 | SSE 证据 | 截图 | 状态 |
|---|---|---|---|---|
| Badge | 标签 | | | 🔶 |
| Markdown | 手写轻量 markdown 渲染 | | | 🔶 |
| InsightCard | 洞察卡片 | | | 🔶 |
| WarningCard | 警告卡片 | | | 🔶 |
| ActionButton | 按钮 + A2UI action → 真实 agent 续跑 | 已有（a2ui-action.sse） | | 🔶 待截图 |

## 统计

- 28 个组件（18 标准 + 10 自定义）；当前 ✅ 0 / 🔶 28 —— 目标1 完成时全部 ✅。
- 实测批次：① 布局 ② 表单 ③ 媒体 ④ 图表 ⑤ 内容（每批一次真实 agent run + 整面截图）。
