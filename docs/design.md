# DataAgent 设计文档：CopilotKit Vue + Spring Boot AG-UI/A2UI（无 Node Runtime）

> 更新：2026-08-15（全能力演示版）。取代早期 React + Kimi 草案 —— 现行栈是
> **Vue 3 + @copilotkit/vue（fork）+ DeepSeek（经 OpenCode2 v2）**。
> 架构决策与"为什么无 Node Runtime"见 docs/ARCHITECTURE.md。

## 1. 总体架构

```
┌──────────────────────────────────────────────────────────┐
│ 浏览器  Vue 3 + @copilotkit/vue 1.67.1-fork.1             │
│  ├─ CopilotChat（消息流 / reasoning 折叠 / 工具卡 / 欢迎页）│
│  ├─ HttpAgent（@ag-ui/client）POST /agui-api/agent/run    │
│  ├─ frontendTools: showNotification（浏览器侧执行）        │
│  ├─ renderToolCalls: render_a2ui 命名渲染器(generative UI) │
│  │   + "*" 通配可折叠渲染器(DefaultToolRender)             │
│  ├─ A2UI renderer（本地 catalog = basic + 7 个业务组件）    │
│  └─ ThreadSidebar（多会话）+ context 徽章 + toast           │
└──────────────────────┬───────────────────────────────────┘
                       │ AG-UI（SSE）
┌──────────────────────▼───────────────────────────────────┐
│ Spring Boot gateway :8090（WebFlux）                      │
│  ├─ AgentRunController   POST /agent/run                  │
│  ├─ AgUiProtocolService  session 解析/prompt 组装/超时兜底 │
│  ├─ AguiEventTranslator  OpenCode v2 事件 → AG-UI 事件    │
│  │   （fold by id/ordinal 定序，按事件流种类隔离锚点）      │
│  ├─ FrontendToolBridge   <tool_call> prompt 契约           │
│  ├─ A2UiBridgeService    render_a2ui → ACTIVITY_SNAPSHOT  │
│  │   （嵌套组件拍平 + null 属性剥离 + 白名单校验）          │
│  ├─ A2UiActionHandler    a2uiAction → A2UI_ACTION 续跑     │
│  ├─ ChatThreadStore      会话持久化（threads.json 原子写）  │
│  └─ ChatThreadsController /chat/threads REST              │
└──────────────────────┬───────────────────────────────────┘
                       │ HTTP/SSE（basic 认证）
┌──────────────────────▼───────────────────────────────────┐
│ OpenCode2 server :4096（v2 分支源码, bun, cwd=项目根）     │
│  新方言事件: session.text.*/tool.*/reasoning.*/step.*/    │
│  execution.succeeded|failed（全局 volatile 流, 按 sessionID│
│  客户端过滤; 订阅先于 prompt, replay 缓冲）                │
└──────────────────────┬───────────────────────────────────┘
                       │ DeepSeek API（deepseek-reasoner）
```

## 2. 能力矩阵（全部实测，证据在 docs/evidence/ 与 scripts/）

### AG-UI

| 能力 | 实现 | 实测 |
|---|---|---|
| text streaming | translator TEXT_MESSAGE_START/CONTENT/END，tool_call marker lookahead | 单次 run 46 delta（公网 curl） |
| reasoning 思考流 | session.reasoning.* → REASONING_* 全生命周期；归并键 assistantMessageID+ordinal，复用去重 | reasoning 102 delta/次 |
| tool call 渲染 | TOOL_CALL_START/ARGS/END/RESULT；前端通配渲染器可折叠（名称/参数/结果/状态） | glob/shell/read 全链路 |
| 多轮连续对话 | threadId→sessionId 持久映射，上下文完整 | scripts/test-multi-turn.sh 5 轮 7 断言（记得暗号） |
| run 超时兜底 | agui.run-idle-timeout(默认120s) 空闲判挂起 → RUN_ERROR + interrupt/abort | 单测 hungRunTimesOutWithRunError + 实测 |
| context/token 用量 | step.ended tokens → CUSTOM context_usage（input+cacheRead）；顶栏徽章 | 多轮 6089→10613 逐轮增长 |
| shared state | RUN_STARTED 后 STATE_SNAPSHOT{threadId,model,provider,workspace,contextSize}；step 结算发 STATE_DELTA（JSON Patch replace /contextSize）；顶栏模型徽章 | docs/evidence/2026-08-15-state-events.sse |
| frontend tools | RunAgentInput.tools → <client_tools> prompt 契约 → TOOL_CALL_* 结束 run → 浏览器执行 → role=tool 续跑 | scripts/test-frontend-tool.sh 5 断言 |
| generative UI | useRenderTool 命名渲染器 render_a2ui（surface 构建卡：shimmer→组件徽标），优先于通配 * | RenderA2uiToolCall.test.ts + bundle grep |

### A2UI

| 能力 | 实现 | 实测 |
|---|---|---|
| render_a2ui surface | <server_tools> prompt 契约 → A2UiBridgeService 校验/拍平 → ACTIVITY_SNAPSHOT(a2ui-surface) | docs/evidence/2026-08-15-a2ui-dashboard-flat.sse（7 组件看板） |
| a2uiAction 回传 | 前端 action → forwardedProps.a2uiAction → A2UI_ACTION prompt → 真实 agent 续跑 + 同名 surfaceId 就地更新 | docs/evidence/2026-08-15-a2ui-action.sse |
| 组件库 | basic catalog 18 组件 + 业务组件 MetricCard/DataTable/BarChart/LineChart/PieChart/InsightCard/WarningCard/ActionButton/Badge/Markdown | scripts/test-a2ui-all-components.sh 31 断言（4 组真实 agent 渲染） |
| 表单组件 | TextField/ChoicePicker/CheckBox/Slider/DateTimeInput，输入绑定 data model，提交 action context 引用 {path} 绑定 | scripts/test-a2ui-form.sh 8 断言 |
| 数据绑定 | {path} 绑定由 GenericBinder 按 schema 解析；chart data / table rows / metric value 均可绑定 | catalog 测试 + 实测 |

## 3. API 一览

| 端点 | 方法 | 说明 |
|---|---|---|
| /agui-api/agent/run | POST | AG-UI RunAgentInput → SSE 事件流（gateway :8090 /agent/run） |
| /agui-api/chat/threads | GET/POST | 会话列表 / 新建 |
| /agui-api/chat/threads/{id} | PATCH/DELETE | 重命名 / 删除 |
| /agui-api/chat/threads/{id}/messages | GET | 历史消息（OpenCode session → AG-UI Message[]） |
| /actuator/health | GET | 健康检查 |

nginx：/agui/ → /var/www/blog/agui/（vite 构建产物）；/agui-api/ → 127.0.0.1:8090（SSE 关 buffering）。

## 4. 关键协议契约

### 4.1 OpenCode v2 事件方言（gateway 唯一消费方言，2026-08-15 起旧方言已删）

- text: session.text.started/delta/ended（assistantMessageID）
- reasoning: session.reasoning.started/delta/ended（无 id → assistantMessageID+ordinal 合成归并键）
- tool: session.tool.input.started/delta/ended、session.tool.called/success/failed（调用 id 字段名是 `id`；tool.called 不带名字，从 input.started 注册表取）
- step: session.step.started/ended/failed（finish=tool-calls 表示 agent loop 继续）
- run 终止: session.execution.succeeded/failed（终止 step.ended 的兜底）
- 定序: durable.seq 连续前缀下发；delta 锚定同种类+id 的最近 seq 事件；缺口 3s 超时强 flush（agui.event-reorder-timeout）

### 4.2 <tool_call> prompt 契约（frontend tools + render_a2ui 共用）

OpenCode v2 core runner 只暴露内置工具，自定义工具走 prompt 契约：
模型输出 `<tool_call>{"name":...,"arguments":{...}}</tool_call>`，translator 在流起始 lookahead +
流中 holdback 检测，转成标准 TOOL_CALL_* 事件。frontend tool → RUN_FINISHED 等浏览器执行；
server tool（render_a2ui）→ 立即执行产生 ACTIVITY_SNAPSHOT，run 继续。

### 4.3 A2UI surface 协议（v0.9）

ACTIVITY_SNAPSHOT，activityType="a2ui-surface"，content.a2ui_operations =
createSurface/updateComponents/updateDataModel。组件扁平列表 + children 为 id 数组 +
root id="root"。gateway 拍平嵌套 children、剥 null 属性、白名单校验（25 个组件）。
surface 快照按 thread 持久化（历史回放重放看板）。

### 4.4 a2uiAction 回环

```
Java ACTIVITY_SNAPSHOT → Vue 渲染 → 用户点击/提交表单
→ renderer setProperties({a2uiAction}) + runAgent()
→ RunAgentInput.forwardedProps.a2uiAction {version, action:{name,surfaceId,sourceComponentId,context}}
→ gateway A2UI_ACTION prompt → agent 续跑 → render_a2ui 同名 surfaceId 就地更新
```

## 5. 多会话模型

- threadId（AG-UI）↔ sessionId（OpenCode）映射存 ChatThreadStore（data/threads.json 原子写）
- 复用前 GET /api/session/{id} 存活校验，失效自动重建 rebind
- 标题 = 首条用户消息截断 30 字；run 结束自动命名
- 前端 useThreads：API 权威 + localStorage 兜底；切换会话把历史写入 per-thread clone 渲染
- userId 参数位保留（当前匿名放行，ThreadAccessPolicy 可插拔；TODO: 真实认证）

## 6. UI 设计系统

浅色 B2B SaaS（对齐 adk-dashboard）：#f8fafc 底、白卡、#6366f1 靛蓝 accent、
chart-1~5 色板（#6366f1/#10b981/#f59e0b/#ef4444/#8b5cf6）。左侧可折叠会话栏
（窄屏抽屉化）、空会话欢迎页（logo + 建议问题卡）、消息气泡、reasoning 折叠区、
工具卡可折叠、A2UI 卡片悬停阴影过渡、toast 栈（showNotification）、context 徽章。

## 7. 端口与部署

| 组件 | 端口 | 说明 |
|---|---|---|
| OpenCode server | 4096 (127.0.0.1) | bun 源码运行，basic 认证，cwd=/home/ubuntu/dataagent |
| gateway | 8090 | java -jar target/opencode-agui-gateway-1.0.0.jar |
| vite dev | 3001 | 开发（predev 自动构建 fork） |
| nginx | 80 | /agui/ 静态 + /agui-api/ 代理 |

公网验证：http://101.34.246.179/agui/ （200）；SSE 实测见 docs/evidence/。

## 8. 已知边界

- render_a2ui 依赖 prompt 契约，LLM 有小概率只答文字不调工具（已通过 prompt 硬化 +
  测试脚本重试缓解；根治需 opencode v2 core runner 支持自定义工具）
- 旧实例 session 重启后可能 wedge（空闲超时覆盖）；session 失效重建后旧历史不可读
- generative UI 的 render_a2ui 卡是工具调用的语义化呈现，真实 surface 由 A2UI renderer 渲染
