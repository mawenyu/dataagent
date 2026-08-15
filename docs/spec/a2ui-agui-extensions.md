# AG-UI / A2UI 扩展能力（vision 任务 · 目标3）

> 状态：已实现并实测（2026-08-15）。本文盘点两协议的官方扩展机制，记录 DataAgent
> 已落地的扩展点与实测证据，并给出未采纳项的理由。

## 一、官方扩展机制盘点

### AG-UI 协议层
| 机制 | 说明 | DataAgent 状态 |
|---|---|---|
| CUSTOM 事件 | `{type:"CUSTOM", name, value}` 自由通道，客户端按 name 消费 | ✅ `context_usage`（每 step token 用量 → 顶栏徽章）。证据: 2026-08-15-state-events.sse |
| RAW 事件 | 透传底层系统原始事件（debug/审计） | ✅ `forwardedProps.debugRaw=true` 回显 OpenCode 原始事件（source=opencode）。证据: 2026-08-15-messages-snapshot-raw.sse |
| STATE_SNAPSHOT/DELTA | 共享状态（JSON Patch 增量） | ✅ model/provider/workspace/contextSize 快照 + delta 续更 → useAgentState |
| MESSAGES_SNAPSHOT | 权威全量消息对账 | ✅ RUN_FINISHED 前发送（vision-P1 新增；空历史跳过防误清） |
| forwardedProps | RunAgentInput 自由字段，穿透到 agent 实现 | ✅ 承载 a2uiAction（A2UI 回传）与 debugRaw |
| tools（RunAgentInput） | 客户端声明 browser 执行工具 | ✅ frontend tool 契约（showNotification / applySpreadsheetEdits） |

### A2UI 协议层
| 机制 | 说明 | DataAgent 状态 |
|---|---|---|
| 自定义 component catalog | catalogId 命名空间 + 白名单组件 | ✅ data-agent catalog = basic 18 + 自定义 10（矩阵: a2ui-component-matrix.md） |
| surface（createSurface/updateComponents/updateDataModel） | 声明式 UI 增量 ops；同名 surface 就地更新 | ✅ ACTIVITY_SNAPSHOT 载体；A2UiSurfaceRegistry 管理版本/replace |
| action 回传（event） | 组件 action → 客户端 → agent 续跑 | ✅ a2uiAction → A2UI_ACTION prompt → 真实 agent（证据: 2026-08-15-a2ui-action.sse） |
| 数据绑定 {path} | props 绑定 data model | ✅ 表单组件实测（vision-b-form） |
| ACTIVITY_DELTA | surface 增量更新 | ➖ 未用：更新走同名 SNAPSHOT replace，数据量小（矩阵有注） |

## 二、本期新实现：HITL interrupt/resume（request_user_confirm）

AG-UI 的 HITL 模式（interrupt → 用户决策 → resume 为新 run）落地：

1. **interrupt**：agent 对不可逆操作（删文件/覆盖数据）调用 `request_user_confirm`
   （opencode 插件注册，codemode:false；契约要求调用后立即结束本轮）。
   gateway `HitlConfirmHandler`（ServerToolHandler 扩展点）确定性渲染确认卡片：
   WarningCard(title/message) + Row[ActionButton 确认(primary) / 取消]，
   两按钮 action event context 携带 actionId。run 随即 RUN_FINISHED。
2. **resume**：用户点击 → 前端 a2uiAction 通道 → gateway 译为 A2UI_ACTION prompt
   → **真实 agent 新 run** 续跑（无任何 Java if/else 假分支），按 hitl_confirm/
   hitl_cancel 决定执行或放弃。

**实测**（全链路真实 DeepSeek）：
- interrupt: `docs/evidence/2026-08-15-vision-hitl-interrupt.sse` —— "删除
  region-sales-2026-08-result.csv" → agent 先 shell 确认文件存在 → 调
  request_user_confirm → 确认卡片 ACTIVITY_SNAPSHOT（surfaceId=hitl-del-region-sales-csv）
  → run 结束，**文件未删**
- resume(cancel): `docs/evidence/2026-08-15-vision-hitl-resume.sse` —— 模拟点击
  "取消"（a2uiAction hitl_cancel + actionId）→ agent 答"已取消，文件未删除"，
  文件系统核实仍在
- 渲染截图: /tmp/screenshots/READY-VISION-hitl.png（画廊 batch=hitl 同构 surface）
- 单测: HitlConfirmHandlerTest 4 + translator HITL 用例 1

### 既有的另一种 HITL：frontend tool 确认
`applySpreadsheetEdits`（task5-B4）走的是另一条官方路径 —— frontend tool 调用
中断 run，浏览器 handler 弹 confirm，结果作为 tool result 消息续跑。
两条路径互补：A2UI action 适合渲染式确认卡片；frontend tool 适合需要浏览器
上下文（读写本地状态）的操作。

## 三、未采纳项（附理由）

| 候选项 | 理由 |
|---|---|
| multi-agent 协作（AGENT_* handoff） | 本版 @ag-ui/core 0.0.57 无 AGENT_* 事件；OpenCode 单 agent 架构无 handoff 数据源。未来协议版本落地后再评估 |
| OpenGenerativeUI（iframe HTML 生成） | fork 提供 OpenGenerativeUIActivityType，但生成任意 HTML/JS 与 A2UI 白名单安全模型冲突（TASK §15 决策），不启用 |
| ACTIVITY_DELTA | 见上，surface replace 已够 |
| MCP Apps activity | fork 有 MCPAppsActivityType；本栈无 MCP 应用源，无实际用例 |

## 四、扩展点索引（二次开发指引）

- 新服务端工具（确定性展开为 surface）：实现 `AguiEventTranslator.ServerToolHandler`
  + `@Service` 自动注入 + opencode 插件注册同名工具（codemode:false）
- 新前端工具：`App.vue frontendTools` + CopilotKitProvider frontend-tools
- 新 CUSTOM 事件：translator 内 emit + 前端 composable 订阅（参照 useContextUsage）
- 新 catalog 组件：dataAgentCatalog.ts（createVueComponent + zod schema）+
  gateway ALLOWED_COMPONENTS + 插件 CATALOG_COMPONENTS 三处同源（galleryGuard 测试守护）

## 五、场景模式（vision-P6，2026-08-15 实测）

### 场景 A：表单校验错误卡（A2UI checks 协议）
- 能力：表单组件 schema 原生 `checks:[{call,args,message}]`（strict），binder
  CHECKABLE 行为逐条求值并注入 isValid/validationErrors —— **前端即时校验，
  零网络往返**；可用函数 required/regex/length/numeric/email/greaterThan 等；
  Button 带 checks 时校验不过自动 disabled（无视觉弱化，fork 已知样式边界）
- 插件 render_a2ui 契约已补 checks 用法（模型可正确产出，实测见证据）
- 实测：2026-08-15-p6-form-checks.sse（TextField required+regex 双规则 +
  Button 关联校验）；截图 READY-VISION-p6-formcheck.png（初始空值红框+
  "关键词必填"错误文案）；vitest formChecks.test.ts 3 例（输入合法值错误
  消除/按钮解禁/清空回归）
- 顺带修复：真实 run 发现模型偶发漏 root 容器（前端永远 shimmer）——
  gateway validate/execute 收口统一并新增 root 必填校验，拒绝原因经 P5-1
  通道回执模型自纠

### 场景 B：多步确认向导（wizard）
- 模式：step1（WarningCard + "下一步" ActionButton）→ a2uiAction resume →
  同 surfaceId replace 为 step2（文件明细 Card + 上一步/确认删除）→ 确认
  触发 request_user_confirm HITL 卡 → hitl_confirm resume → 执行删除 +
  "向导流程完成"。**agent 自主组合了向导 + HITL 两种模式**
- 实测 4 段真实 run：2026-08-15-p6-wizard-{step1,step2,hitl,done}.sse；
  截图 READY-VISION-p6-wizard.png（双步同框画廊 batch=wizard）
- 无新增代码 —— 纯既有协议能力组合（action 回传 + surface replace + HITL）
