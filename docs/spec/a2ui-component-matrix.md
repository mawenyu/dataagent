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

## 附录：协议边界与异常健壮性（vision-P4，2026-08-15）

双层防护：gateway（白名单/结构校验，单一真源）+ 前端渲染层（降级占位，不白屏）。

| 异常 | gateway 行为 | 前端行为 | SSE 证据 | 截图 | 测试 |
|---|---|---|---|---|---|
| 未知 component type | 整面拒绝（whitelist）+ warn 日志 | （若绕过 gateway）红字占位 `Unknown component: X` + console.warn，其余组件照渲染 | 2026-08-15-vision-edge-unknown.sse（Gauge 被拒，RUN_FINISHED 正常） | READY-VISION-edge.png | edgeCases.test.ts + A2UiBridgeServiceTest |
| 缺失必填 prop | 放行（白名单只管组件/id） | 空值降级渲染，不抛错 | 2026-08-15-vision-edge-noprop.sse（MetricCard 无 value 正常出 surface） | 同上 | edgeCases.test.ts |
| children 深层嵌套（>5 层） | 放行（8 层实测通过） | 递归 DeferredChild 正常渲染到最深处 | 2026-08-15-vision-edge-deep.sse（7 层嵌套 surface） | 同上（"第八层深处正常渲染"） | 双侧各 1 例 |
| bind 不存在的数据路径 | 放行（路径合法性是数据层语义） | 解析 undefined → 空值降级，不抛错 | 2026-08-15-vision-edge-badpath.sse | 同上 | edgeCases.test.ts |
| children cycle 引用（A↔B/自引用） | **拒绝**（`hasReferenceCycle` DFS 三色标记，含 children/child/trigger/content/tabs.child 引用图） | 双保险：fork VueSurface 祖先链检测 → 虚线占位 `Cycle detected: <id>` + console.warn（此前实测：栈溢出 RangeError 杀整面） | 2026-08-15-vision-edge-cycle.sse（真实模型产出 A↔B 被 gateway 拒绝，RUN_FINISHED 正常） | 同上（Cycle detected 占位可见） | 双侧各 2 例 |

### 修复记录
- fork `VueSurface.ts` DeferredChild：注入祖先 id 链（provide/inject），环检测 → 占位 + warn；未知组件补 console.warn（此前只有红字占位无日志）。
- gateway `A2UiBridgeService.hasReferenceCycle`：引用环整体拒绝（栈溢出风险是真实崩溃，不能放过）。

### 已知边界
- 未知组件被 gateway 拒绝时，opencode 侧插件 execute 已回执 "rendered"，agent 可能声称"已渲染"而实际未渲染（回执与 gateway 裁决不同步）。低风险（仅白名单外组件触发），后续可让插件回执带校验结果。

## 附录 B：恶意/畸形 payload 防护（vision-P13，2026-08-16）

| 向量 | 防护层 | 行为 | 测试/证据 |
|---|---|---|---|
| XSS（Text/Markdown 含 script/iframe/img-onerror） | 前端（构造性免疫：全部经 h() 文本节点转义，无 v-html；渲染路径已无 innerHTML —— shimmer keyframes 2026-08-16 移入共享静态样式表） | 字面文本渲染，无可执行节点 | maliciousPayload.test.ts ×3 |
| 组件名/action 名/图标名带 HTML | 前端 + gateway 白名单 | 按数据处理，无 on* 属性泄漏 | 同上 |
| 非法组件类型（null/数字/对象） | 双修：fork 渲染器 updateComponents **拆到单组件粒度容错**（一条 op 混入坏组件不再拖垮整 op）+ gateway 白名单 | 坏组件跳过+warn，正常组件照渲染 | 同上（先红后绿） |
| 深嵌套 | **gateway 新增 MAX_DEPTH=48**（BFS 分层）+ 前端 50 层实测正常 | 超限整体拒绝，回执带深度原因 | bridge 2 例 + 2026-08-16-p13-depth-reject.sse（61 层被拒 → 模型自纠 10 层成功） |
| 超长字符串 | gateway 64KB payload 上限 + 前端 100KB 实测不崩 | 上限内正常，超限拒绝 | maliciousPayload.test.ts + P5 规模测试 |
| 超大 props（300KB 单 prop） | 前端 | 正常渲染不卡死不白屏 | A2UIBoundaryPayloads.test.ts |
| 畸形 payload：非对象条目混入 / a2ui_operations 为 JSONL 字符串（含坏行） | 前端（fork `sanitizeA2uiOperations` 边界消毒，FORK#18） | 坏条目/坏行丢弃 + console.warn，有效 op 照常渲染；0 条可用 op → `a2ui-payload-error` 警示 chip（不再永久 loading 骨架） | A2UIBoundaryPayloads.test.ts ×6 |
| javascript:/data: URL（Image/Video） | 浏览器语义（img/video src 的 javascript: 不可执行） | 页面存活 | maliciousPayload.test.ts |
| cycle 引用 | P4 双层（gateway 环检测 + 前端祖先链占位） | 拒绝/占位 | 见附录 A |

结论：A2UI 白名单声明式模型 + 全文本节点渲染，注入面构造性封闭；
深度/规模/环/非法类型均有确定性防线与回执自纠闭环。
