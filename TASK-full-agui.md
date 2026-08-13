# TASK: 完整 AG-UI + A2UI + CopilotKit Vue 直连 Java 架构实现

> 目标：在现有项目（/home/ubuntu/opencode-agui-app）中实现：
> Vue 3 + CopilotKit Vue + AG-UI + A2UI + Java/Spring Boot Agent Backend
>
> ⚠️ 重要背景：本项目当前**没有真实登录认证**（无 Spring Security 用户体系）。
> 第十六节的安全要求按"接口预留 + 简化实现"处理：
> - **先不要开启任何认证/鉴权，方便测试**（用户明确要求）
> - 保留 userId 参数位（先用固定值如 "anonymous" 或请求头透传）
> - threadId 鉴权逻辑写成可插拔接口，当前默认放行
> - 不引入 Spring Security 完整配置，留 TODO 注释
> - 输入校验（message size、A2UI payload 白名单等）照常实现但宽松阈值

## 明确约束（红线）

1. 不允许部署 Node.js CopilotKit Runtime
2. 不允许引入 @copilotkit/runtime
3. 不使用 runtimeUrl
4. 不使用 Copilot Cloud
5. 生产代码不要使用官方标记为 Enterprise 的 selfManagedAgents
6. 应用业务代码不要直接使用 agents__unsafe_dev_only
7. Agent 后端必须继续是现有 Java / Spring Boot 应用
8. 前端直接通过 AG-UI HttpAgent 与 Java 后端通信
9. 尽可能完整保留 CopilotKit Vue：CopilotChat / streaming / reasoning / frontend tools / tool rendering / HITL / agent state / A2UI renderer / A2UI interactive actions
10. 不自己重新实现聊天 UI

## 一、先检查当前项目（以 lockfile 实际版本为基准）

- package.json / lockfile
- 当前 Vue 版本、@copilotkit/vue 版本、@copilotkit/core 版本、@ag-ui/client / @ag-ui/core 版本
- Spring Boot 版本
- 现有 /opencode/api/event 实现、OpenCode session 创建和管理逻辑
- 记录并 pin 这些版本，不要用 ^ 或自动升级 CopilotKit

## 二、总体架构（终态）

```
Vue Browser
  | @ag-ui/client HttpAgent
  | POST RunAgentInput / Accept: text/event-stream
  v
Spring Boot  /opencode/ag-ui
  | 内部转换
  v
OpenCode / DataAgent
  | AG-UI events
  v
Vue CopilotKit (CopilotChat / tool renderer / frontend tools / HITL / A2UI renderer)
```

不要出现 Vue -> Copilot Runtime -> Java，不要任何 Node sidecar。

## 三、CopilotKit Vue：增加 directAgents（极小内部 fork）

当前 Provider 已支持 agents__unsafe_dev_only / selfManagedAgents，二者合并后作为本地 AbstractAgent 注册给 CopilotKitCoreVue。
基于 MIT 版本创建极小内部 fork/package（如 @company/copilotkit-vue，基于当前项目使用的精确版本 tag，保留 MIT LICENSE 和版权声明），只改 Provider 层：

- CopilotKitProvider.types.ts: 增加 `directAgents?: Record<string, AbstractAgent>`
- CopilotKitProvider.vue 默认值 `directAgents: () => ({})`
- 合并：`{ ...agents__unsafe_dev_only, ...selfManagedAgents, ...directAgents }`
- 业务应用只使用 directAgents，key 即 agentId（如 `{ default: dataAgent }`）
- 确保：无 runtimeUrl 且 directAgents 非空时不报配置错误；useAgent("default") 能找到；CopilotChat agentId="default" 正常运行；provider headers 合并到 HttpAgent；frontendTools / renderToolCalls / renderActivityMessages / A2UI renderer / HITL 均继续工作
- 给 fork 加单元测试，极小 diff 方便升级
- 参考实现已存在：/home/ubuntu/opencode-agui-app/ref/copilotkit-fork/packages/vue 里有现有 patch 可参考

## 四、创建 Direct AG-UI Agent

前端 `src/agents/dataAgent.ts`：
```ts
import { HttpAgent } from "@ag-ui/client";
export const dataAgent = new HttpAgent({ url: "/opencode/ag-ui" });
```
- same-origin URL，开发走 Vite proxy，生产走 nginx 转发到 Spring Boot（8090）
- 不要把敏感 API key 放浏览器

## 五、Vue 页面

```vue
<CopilotKitProvider :direct-agents="agents" :a2ui="a2uiConfig">
  <CopilotChat agent-id="default" />
</CopilotKitProvider>
```
- `const agents = { default: dataAgent }`
- 第一阶段 A2UI 用 vueBasicCatalog + `includeSchema: true`
- main.ts 导入 `@copilotkit/vue/styles.css`
- 不设 runtime-url；Network 里不应出现 /api/copilotkit/*，正常请求直接是 POST /opencode/ag-ui

## 六、Spring Boot 实现标准 AG-UI endpoint

- 新增 `POST /opencode/ag-ui`，请求 application/json，响应 text/event-stream
- 请求 DTO 按标准 AG-UI RunAgentInput：threadId / runId / state / messages / tools / context / forwardedProps
- sessionId 不作为公开必填字段，新增 OpenCodeSessionRegistry：`AG-UI threadId -> OpenCode sessionId`，`getOrCreateSession(userId, threadId)`
- ⚠️ 当前无真实认证：userId 先用固定值/请求头透传，threadId->session 绑定逻辑保留 userId 维度但默认放行，留 TODO
- 旧 /opencode/api/event 不删，逐渐迁移：/opencode/ag-ui -> AgUiController -> DataAgentService -> OpenCodeSessionService

## 七、AG-UI SSE 输出

标准事件：RUN_STARTED / TEXT_MESSAGE_START / TEXT_MESSAGE_CONTENT / TEXT_MESSAGE_END / RUN_FINISHED / RUN_ERROR / TOOL_CALL_START / TOOL_CALL_ARGS / TOOL_CALL_END / STATE_SNAPSHOT / STATE_DELTA / ACTIVITY_SNAPSHOT / ACTIVITY_DELTA
- SSE 格式 `data: {...json}\n\n`，SseEmitter 或 Flux 均可，不改项目 reactive stack
- Cache-Control: no-cache；nginx 关 buffering（X-Accel-Buffering: no）

## 八~九、阶段验证（按顺序，不成功不往下走）

1. 纯 AG-UI 文本：hello -> 完整生命周期事件，CopilotChat 正常显示、streaming、多轮、threadId、session 复用
2. Frontend tool roundtrip：Vue 注册 showNotification，Java 透传 input.tools 给 LLM，TOOL_CALL_* 回浏览器执行，Java 能处理新一轮 RunAgentInput

## 十、第一阶段 A2UI：Java 硬编码一个 Surface（v0.9）

A2UiService 提供 createSurface / updateComponents / updateDataModel，包装为：
```json
{ "type": "ACTIVITY_SNAPSHOT", "messageId": "a2ui-xxx", "activityType": "a2ui-surface",
  "content": { "a2ui_operations": [...] }, "replace": true }
```
先做极简界面：Column + Text "销售概览" + Text "今日销售额：123,456"，目标是 CopilotChat 里渲染真正 surface 而非 JSON 文本。

## 十一~十二、Java 版 A2UI Bridge + Dynamic A2UI

- A2UiBridgeService：OpenCode/LLM -> A2UI operations -> AG-UI ACTIVITY_SNAPSHOT/DELTA（参考 @ag-ui/a2ui-middleware MIT 行为，只实现需要的部分）
- CopilotKit Vue 配置 a2ui.catalog 后会把 catalog/schema/guidelines 放进 RunAgentInput.context，Java 透传给 Agent
- server-side tool `render_a2ui(surfaceId, components, data?, catalogId?)`，components 必填，catalogId 缺省用 basic catalog id
- 执行时转 createSurface/updateComponents/updateDataModel -> ACTIVITY_SNAPSHOT；同时输出 TOOL_CALL_*（toolCallName=render_a2ui）触发内置 progress renderer
- 不返回 HTML

## 十三、A2UI Action 回传（必须实现）

- 用户点 Button -> CopilotKit 把 action 放进 forwardedProps.a2uiAction 再次 runAgent
- Java 增加 A2UiActionHandler：v1 打日志；v2 读 event.name / event.context / surfaceId，确定性业务 action（refresh_sales / filter_region / open_order / approve_query）Java 直接路由；需 Agent 判断的转成 `A2UI_ACTION: <json>` 上下文继续跑 Agent

## 十四、Surface 状态

A2UiSurfaceRegistry（thread scoped）：userId / threadId / surfaceId / activityMessageId / catalogId / currentState；surfaceId -> activityMessageId 映射；同一 Surface 更新复用 messageId + ACTIVITY_SNAPSHOT replace=true；ACTIVITY_DELTA（RFC6902）稳定后再做。

## 十五、DataAgent 自定义组件（basic catalog 全通后）

MetricCard / DataTable / BarChart / LineChart / PieChart(按需) / InsightCard / WarningCard / ActionButton
- 禁止 Agent 返回 HTML/JS/Vue template/iframe，只能 declarative schema + data，前端白名单注册
- 图表组件优先接 `{ title, xField, yField, data }`，不让 LLM 生成任意 ECharts option

## 十六、安全（简化版，当前无真实认证）

- /opencode/ag-ui 预留认证入口；当前放行 + TODO
- 每次请求校验：runId 格式、message size、消息数量、tool definitions、A2UI payload size
- 不信任 threadId / runId / forwardedProps / a2uiAction / frontend tools
- OpenCode session 只能服务端创建绑定；A2UI component type 白名单校验

## 十七、测试

集成测试至少覆盖：text streaming / multi-turn / threadId->sessionId / 两用户隔离（当前用 mock userId 模拟）/ frontend tool roundtrip / tool renderer / fixed A2UI surface / 多 surface / button click / forwardedProps.a2uiAction / surface update / dynamic render_a2ui / client disconnect / RUN_ERROR / malformed SSE / auth failure（mock）
开发 debug 页面 /dataagent/copilotkit-test：显示 threadId / agentId / 最后 RunAgentInput / 最近 event types / 是否收到 a2uiAction（生产关闭）

## 十八、最终验收场景

用户："分析本月销售情况" -> Java DataAgent 查数据 -> Agent 输出文字 + 调 render_a2ui -> ACTIVITY_SNAPSHOT -> Vue A2UI renderer 显示销售卡片/图表 -> 用户点"查看华东区" -> forwardedProps.a2uiAction 回 Java -> DataAgent 执行 -> 更新 Surface -> Vue 界面更新。Network 只有 POST /opencode/ag-ui，无 Node Runtime。

## 执行要求

- 按阶段顺序执行，每个阶段完成后构建 + 部署到 nginx（/var/www/blog/agui/）验证，再进下一阶段
- 阶段八未完成前不做 A2UI；阶段十未完成前不做 dynamic A2UI
- 每完成一个阶段向我汇报，包含实测证据
- 参考文件：/home/ubuntu/opencode-agui-app/ARCHITECTURE.md、TASK-ui-polish.md、ref/adk-dashboard、ref/copilotkit-fork
