# TARGET_ARCHITECTURE — DataAgent 目标架构

> 与 CURRENT_ARCHITECTURE 对照阅读。原则：DataAgent ⇅ AG-UI ⇅ CopilotKit ⇅ A2UI Renderer，减少 glue code；每一跳有明确价值。

## 分层职责（保持现状的正确骨架）

| 层 | 职责 | 不做 |
|---|---|---|
| CopilotKit(fork) | Chat UX / 消息与工具渲染 / HITL UI / shared state 客户端 | 不当 agent 后端 |
| AG-UI | 唯一实时协议(streaming/tool/state/lifecycle/action) | 不自创 JSON 流协议 |
| A2UI | agent 结构化 UI 描述 + 白名单 Catalog 渲染 | 不输出任意 HTML/JSX |
| Java gateway | BFF/网关:协议边界、会话/文件持久化、服务端工具确定性展开、可观测、鉴权(预留 ThreadAccessPolicy) | 不做分析逻辑 |
| OpenCode/DataAgent | Agent Loop:理解→规划→工具→观察→推理→洞察→UI | 不直接碰 UI 渲染 |

## 与现状的 Gap → 目标态

> 2026-08-16 复审：1-5 已全部落地（各条内标注证据）；6 部分落地。

1. **配置/密钥管理**：所有 secret 只走环境变量/不入库文件（`.env.opencode` 单一来源）；application.yml 全部 `${ENV:default}`；文档只描述机制不描述值。`agents/opencode.jsonc.example` 给出真实可参照的 provider 结构（脱敏）。✅ 已落地（application.yml `password: ${OPENCODE_SERVER_PASSWORD:}`、`data-workspace: ${AGUI_DATA_WORKSPACE:workspace}`）
2. **协议健壮性**：SSE 输出统一走 Jackson 序列化（消灭手写 escape 拼 JSON）；统一 REST 错误映射为结构化 `{error, message, code}`；RUN_ERROR 带结构化 code 字段（前端 P-I 的 parseRunError 直接消费）。✅ 已落地（translator `MAPPER.writeValueAsString`；实现为 `ApiExceptionHandler` @RestControllerAdvice 而非 ErrorWebExceptionHandler，c209fa0；RUN_ERROR code = UPSTREAM_ERROR/RUN_TIMEOUT，ebfb4aa + 前端 b5f138f）
3. **gateway 内部**：AguiEventTranslator 按事件族拆分 handler（text/tool/step/reasoning/lifecycle），translate 只剩分派 ✅；历史消息拉取合并为一处（Controller 与 ProtocolService 共享 ThreadMessagesService 的拉取+转换）✅（AgUiProtocolService 与 ChatThreadsController 均注入 ThreadMessagesService）；workspace 文件端点全局/会话级收进同一 WorkspaceFilesController 共享实现 ✅；ChatThreadStore 抽出 ThreadRepository 接口（现 JSON 实现 → 可换 SQLite）✅（23f4397），写操作移下 event loop（boundedElastic）✅（393319f）。
4. **agents/ 部署面**：只保留业务必需的 `plugins/a2ui-tools.ts` ✅；上游样例（github 工具/命令/技能/TUI smoke）移到 `agents/upstream-examples/`（不部署）✅；插件注释与工具数同步 ✅（build-opencode.sh 注释与 a2ui-tools.ts 均为 5 工具）；构建脚本无写死绝对路径（FORK_REPO/WORK_DIR 均可环境覆盖）✅。
5. **可观测**：run-metrics 已有 JSONL+gauge；MDC(traceId=runId) 已进 SLF4J 日志模式 ✅（8002a27，application.yml logging.pattern.console `%X{traceId}`）；`/actuator/metrics` 已在,后续接 Prometheus 只是配置事。
6. **前端**：现状健康（composables 分层清晰、fork patch 全部 FORK.md 登记）。目标补强：fork 套件既有失败基线随并行线收尾归零（修复在途，计数以实跑为准）；root 陈旧 dist/ 已删除 ✅。

## 明确的非目标

- 不引入 Node runtime / CopilotKit Cloud / 微服务拆分
- 不把消息正文搬回 gateway 落盘（OpenCode 已是事实源）
- 不做多租户/auth 实现（保留扩展点即可，TASK §16）
