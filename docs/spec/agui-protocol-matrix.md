# AG-UI 协议事件覆盖矩阵（vision 任务 · 目标2）

> 基准：`@ag-ui/core@0.0.57` 官方 EventType 枚举 32 种 + RAW（见 packages/copilotkit-vue/node_modules/@ag-ui/core/dist/index.d.mts）。
> 状态图例：✅ 已产生+已实测 ｜ 🔶 已产生待实测 ｜ ⬜ 未实现（计划中）｜ ➖ 官方可选/被取代，明确不用（附理由）
> gateway 侧翻译单一真源：`AguiEventTranslator`（OpenCode SSE 方言 → AG-UI）；
> 前端消费：fork core 标准处理 + `RenderA2uiToolCall`（ACTIVITY_SNAPSHOT）+ `useAgentState`/`useContextUsage`（STATE/CUSTOM）。

## 生命周期事件（5）

| 事件 | gateway 产生 | 前端消费 | 实测证据 | 状态 |
|---|---|---|---|---|
| RUN_STARTED | ✅ AguiEventTranslator | ✅ fork core | docs/evidence/2026-08-15-text-stream-fixed.sse 等 | ✅ |
| RUN_FINISHED | ✅ | ✅ | 同上（每个 .sse 样本尾部） | ✅ |
| RUN_ERROR | ✅（校验失败/空闲超时/abort） | ✅ onError → toast | docs/evidence/2026-08-15-run-error.txt（非法 threadId/空消息实测） | ✅ |
| STEP_STARTED | ✅ session.step.started | ✅ | 已有样本 | ✅ |
| STEP_FINISHED | ✅ session.step.ended | ✅ | 已有样本 | ✅ |

## 文本消息事件（4）

| 事件 | gateway | 前端 | 证据 | 状态 |
|---|---|---|---|---|
| TEXT_MESSAGE_START | ✅ | ✅ | 已有样本 | ✅ |
| TEXT_MESSAGE_CONTENT | ✅ | ✅ | 已有样本 | ✅ |
| TEXT_MESSAGE_END | ✅ | ✅ | 已有样本 | ✅ |
| TEXT_MESSAGE_CHUNK | 未产生 | fork 支持 | — | ➖ 官方"便捷合并事件"，与 START/CONTENT/END 二选一；我们用细粒度三件套（spec 允许），不重复产 |

## 工具调用事件（5）

| 事件 | gateway | 前端 | 证据 | 状态 |
|---|---|---|---|---|
| TOOL_CALL_START | ✅ | ✅ | 已有样本 | ✅ |
| TOOL_CALL_ARGS | ✅ | ✅ | 已有样本 | ✅ |
| TOOL_CALL_END | ✅ | ✅ | 已有样本 | ✅ |
| TOOL_CALL_RESULT | ✅（含 tool.failed 透传错误） | ✅ | AguiEventTranslatorTest + 样本 | ✅ |
| TOOL_CALL_CHUNK | 未产生 | fork 支持 | — | ➖ 同 TEXT_MESSAGE_CHUNK，细粒度三件套已覆盖 |

## 状态事件（3）

| 事件 | gateway | 前端 | 证据 | 状态 |
|---|---|---|---|---|
| STATE_SNAPSHOT | ✅（initialState 非空时紧随 RUN_STARTED） | ✅ useAgentState → 顶栏徽章 | docs/evidence/2026-08-15-state-events.sse | ✅ |
| STATE_DELTA | ✅（token 用量 JSON Patch replace /contextSize） | ✅ useAgentState | 同上 | ✅ |
| MESSAGES_SNAPSHOT | ✅ RUN_FINISHED 前发权威全量（OpenCode 历史转换；空历史跳过防误清客户端） | ✅ fork core 按 id 归并、保留 activity 消息 | docs/evidence/2026-08-15-messages-snapshot-raw.sse | ✅ |

## Reasoning 事件（8）

| 事件 | gateway | 前端 | 证据 | 状态 |
|---|---|---|---|---|
| REASONING_START | ✅ | ✅ | 已有样本（deepseek-reasoner） | ✅ |
| REASONING_MESSAGE_START | ✅（assistantMessageID+ordinal 合成 id） | ✅ | 已有样本 | ✅ |
| REASONING_MESSAGE_CONTENT | ✅ | ✅ | 已有样本 | ✅ |
| REASONING_MESSAGE_END | ✅ | ✅ | 已有样本 | ✅ |
| REASONING_END | ✅ | ✅ | 已有样本 | ✅ |
| REASONING_MESSAGE_CHUNK | 未产生 | fork 支持 | — | ➖ 便捷合并事件，同 TEXT_MESSAGE_CHUNK 理由 |
| REASONING_ENCRYPTED_VALUE | 不产生 | — | — | ➖ OpenAI 加密推理专用；DeepSeek via OpenCode 明文 reasoning，无此数据源 |
| THINKING_START / THINKING_END / THINKING_TEXT_MESSAGE_* (5) | 不产生 | fork 兼容 | — | ➖ 旧版命名，官方已由 REASONING_* 取代（向后兼容保留）；新实现不应再产 |

## Activity 事件（2，A2UI surface 载体）

| 事件 | gateway | 前端 | 证据 | 状态 |
|---|---|---|---|---|
| ACTIVITY_SNAPSHOT | ✅ A2UiBridgeService（a2ui-surface） | ✅ RenderA2uiToolCall | docs/evidence/2026-08-15-native-render-a2ui.sse 等 | ✅ |
| ACTIVITY_DELTA | 未产生 | fork 支持 | — | ➖ 设计选择：surface 更新走同名 SNAPSHOT replace（A2UiSurfaceRegistry），数据量小无需增量 |

## 其他（2）

| 事件 | gateway | 前端 | 证据 | 状态 |
|---|---|---|---|---|
| CUSTOM | ✅ context_usage（每 step token 用量） | ✅ useContextUsage → 顶栏徽章 | docs/evidence/2026-08-15-state-events.sse | ✅ |
| RAW | ✅ forwardedProps.debugRaw=true 时每原始事件回显（source=opencode） | debug 通道（debug 页/抓包可见） | 同上证据（单次 run RAW×53） | ✅ |

## 规范外事件

| 事件 | 说明 | 状态 |
|---|---|---|
| AGENT_*（handoff/sub-agent） | 本版 @ag-ui/core 0.0.57 枚举中**不存在**（新版草案方向）；OpenCode 单 agent 架构无 handoff 数据源 | ➖ 本协议版本不适用；multi-agent 协作见 extensions 文档（目标3） |

## 统计

- 官方 33 种：✅ 22 ｜ ➖ 11（官方可选或本栈无数据源，逐项附理由）—— **目标2 全部闭环（2026-08-15）**
