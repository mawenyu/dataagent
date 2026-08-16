# 架构决策文档：CopilotKit Vue + Spring Boot AG-UI/A2UI（无 Node Runtime）

> 来源：架构分析（基于 CopilotKit main 分支、Vue Provider、A2UI Renderer、AG-UI Java SDK，CopilotKit v1.67.x / 2026-08-10）
> 结论：**完全不需要 Node Runtime**。

> ⚠️ **时效注记（2026-08-16 补）**：本文是 2026-08-10 的*决策记录*，其中两处计划与最终实现不同，勿按本文接入：
> 1. 文中 `POST /opencode/ag-ui` 计划端点未采用 —— 现行实现是 gateway **`POST /agent/run`**（前端经 `/agui-api/agent/run` 代理）。
> 2. 文中「当前阶段用 `agents__unsafe_dev_only`」已被 fork 新增的 **`directAgents`** prop 取代（业务代码不碰 `agents__unsafe_dev_only`，见 `packages/copilotkit-vue/FORK.md` 条目 1）。
>
> 现行事实以 `docs/CURRENT_ARCHITECTURE.md` 为准。

## 最终架构

```
┌─────────────────────────────────────┐
│ Vue                                 │
│   @copilotkit/vue                   │
│   ├─ CopilotChat                    │
│   ├─ useAgent                       │
│   ├─ frontendTools                  │
│   ├─ HITL                           │
│   ├─ tool rendering                 │
│   └─ A2UI renderer                  │
│   @ag-ui/client                     │
│   └─ HttpAgent                      │
└─────────────────┬───────────────────┘
                  │ POST RunAgentInput
                  │ ← AG-UI SSE
                  ▼
┌─────────────────────────────────────┐
│ Spring Boot（现有）                  │
│   /opencode/ag-ui                   │
│   DataAgent / OpenCode              │
│   ├─ 普通文本                        │
│   ├─ tool calls                     │
│   ├─ state                          │
│   └─ A2UI activity                  │
└─────────────────────────────────────┘
```

没有 Node。没有 Copilot Runtime sidecar。也不自己写 SSE Chat UI。

## 技术边界（用户拍板）

- **CopilotKit** = Vue 端 Agent UX / Generative UI 框架
- **AG-UI** = Vue ↔ Java 通信协议
- **A2UI** = Java Agent → Vue 的声明式 UI 协议
- **Spring Boot** = Agent backend + auth + session + tools + A2UI generation
- **OpenCode** = Java 后端内部真正执行 Agent 的引擎

## 为什么无 Runtime 成立（源码证据）

### 1. Vue Provider 不依赖 runtimeUrl

```ts
runtimeUrl?: string;
agents__unsafe_dev_only?: Record<string, AbstractAgent>;
selfManagedAgents?: Record<string, AbstractAgent>;

const mergedAgents = computed(() => ({
  ...props.agents__unsafe_dev_only,
  ...props.selfManagedAgents,
}));

// 判断逻辑：有本地 agent 就不要求 endpoint
if (endpoint || publicKey || localAgents) return;
```

官方文档：可以直接把 AG-UI agent instance 交给 frontend provider，从而 skip the runtime。
生产 = `selfManagedAgents`；开发 = `agents__unsafe_dev_only`。

### 2. A2UI 也不要求 Runtime 渲染

Vue Provider 源码：

```ts
// A catalog passed to the provider is enough to turn A2UI on:
// render the surfaces locally ... no runtime-side `a2ui` config required.
const a2uiCatalogProvided = computed(() => !!props.a2ui?.catalog);
const a2uiActive = computed(() => runtimeA2UIEnabled.value || a2uiCatalogProvided.value);
```

前端传 `:a2ui="{ catalog: myCatalog }"` 即激活本地 A2UI renderer：

```ts
createA2UIMessageRenderer({
  theme: props.a2ui?.theme,
  catalog: props.a2ui?.catalog,
  loadingComponent: props.a2ui?.loadingComponent,
})
```

整个 renderer 运行在 Vue 浏览器端。

## Java 端要发什么

CopilotKit Vue A2UI renderer 匹配：

- `activityType = "a2ui-surface"`
- 从 `content.a2ui_operations` 取 A2UI v0.9 operations

Java 只需产生标准 AG-UI Activity event：

```json
{
  "type": "ACTIVITY_SNAPSHOT",
  "messageId": "ui-001",
  "activityType": "a2ui-surface",
  "content": {
    "a2ui_operations": [
      { "version": "v0.9", "createSurface": { "surfaceId": "sales-dashboard", "catalogId": "your-catalog-id" } },
      { "version": "v0.9", "updateComponents": { "surfaceId": "sales-dashboard", "components": [ ... ] } },
      { "version": "v0.9", "updateDataModel": { "surfaceId": "sales-dashboard", "data": { ... } } }
    ]
  }
}
```

组件结构约定（来自官方 DemoButtonAgent 源码）：
- root 组件 id 必须为 `"root"`
- `Column` 用 `children`（数组）；`Button`/`Card` 用 `child`（单个 id）
- `Button` 交互：`action: { event: { name: "confirm" } }`
- catalogId 标准值：`https://a2ui.org/specification/v0_9/basic_catalog.json`

## AG-UI Java SDK

```xml
<groupId>com.ag-ui</groupId>
<artifactId>core</artifactId>
<groupId>com.ag-ui</groupId>
<artifactId>client</artifactId>
```

官方仓库有 Spring server 实现（SseEmitter 序列化 BaseEvent 为 SSE）+ Spring AI Agent integration。

标准 `RunAgentInput`：

```java
public record RunAgentInput(
  String threadId,
  String runId,
  State state,
  List<BaseMessage> messages,
  List<Tool> tools,
  List<Context> context,
  Object forwardedProps
) {}
```

**注意：没有 sessionId**。endpoint 规范：

```
POST /opencode/ag-ui
Content-Type: application/json
Accept: text/event-stream

{ "threadId": "...", "runId": "...", "messages": [...], "state": {}, "tools": [...], "context": [...], "forwardedProps": {} }
```

OpenCode 的 sessionId 在 Java 内部做映射（AG-UI threadId → session mapping service → OpenCode sessionId），不泄露到 public contract。

## A2UI 按钮交互回环

```
Java ──ACTIVITY_SNAPSHOT(a2ui-surface)──> Vue 渲染 Button
用户点击 → A2UI Renderer: setProperties({a2uiAction: message}) + runAgent()
→ CopilotKit Core: properties 作为 RunAgentInput.forwardedProps 发出
→ Java 收到 forwardedProps.a2uiAction → 处理 → 返回新 ACTIVITY_SNAPSHOT / ACTIVITY_DELTA
```

Java 侧：

```java
if (forwardedProps.containsKey("a2uiAction")) {
  // 处理按钮点击
}
```

## Frontend Tool / HITL 同样可用

本地 agent 模式下 Vue Provider 仍创建完整 CopilotKitCoreVue，注册 tools / renderToolCalls / renderActivityMessages / renderCustomMessages。streaming、reasoning UI、tool-call rendering、frontend tools、HITL、shared state、A2UI、自定义 activity renderer 都不需要 Node Runtime——关键是 Java 后端遵守 AG-UI event lifecycle。

## 授权注意

- `selfManagedAgents` = 生产直连正式方式，但属于 **Enterprise Intelligence** 授权
- `agents__unsafe_dev_only` = 官方明确的本地开发路径（不启动 runtime）
- 当前阶段用 `agents__unsafe_dev_only` 验证；生产再决定买授权或在 Spring Boot 内实现薄 facade（`GET /api/copilotkit/info` + `POST /api/copilotkit/agent/:agentId/run`，body = RunAgentInput，response = AG-UI SSE）

## A2UI 第一版：Fixed Schema

不要一开始让 LLM 生成任意 UI。预定义组件集：

`MetricCard / DataTable / BarChart / LineChart / InsightCard / WarningCard / ActionButton`

Agent 只决定：用哪个组件 + 什么数据 + 怎么排列。跑稳后再做 Java 版 `generate_a2ui` tool（Dynamic Schema）。

## 落地路线（第一阶段）

```vue
import { HttpAgent } from "@ag-ui/client";

const agents = {
  default: new HttpAgent({ url: "/opencode/ag-ui" }),
};
```

```vue
<CopilotKitProvider
  :agents__unsafe_dev_only="agents"
  :a2ui="{ catalog: dataAgentCatalog }"
>
  <CopilotChat agent-id="default" />
</CopilotKitProvider>
```

验证四件事：
1. 文字 streaming
2. Tool call
3. A2UI card（硬编码 MetricCard ACTIVITY_SNAPSHOT）
4. A2UI button → forwardedProps.a2uiAction → Java → 更新 UI

## 前端参考源码位置

- `/home/ubuntu/opencode-agui-app/ref/copilotkit-a2ui-vue/a2ui-catalog.vue` — 官方 Vue A2UI 入口（`:a2ui="{ catalog: vueBasicCatalog }"`，注意 `vueBasicCatalog` 从 `@copilotkit/vue/v2` 导入）
- `/home/ubuntu/opencode-agui-app/ref/copilotkit-a2ui-vue/server-runtime.ts` — 官方 DemoButtonAgent（A2UI operations 完整构造 + a2uiAction 回环处理）
- `/home/ubuntu/opencode-agui-app/ref/adk-dashboard/` — Apple 风格 B2B SaaS dashboard 样式参考（浅色 `#f8fafc` 背景、白卡片、靛蓝 `#6366f1` accent）
