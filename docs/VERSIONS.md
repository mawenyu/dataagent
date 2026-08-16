# 版本 Pin 记录（2026-08-12，第一节基线）

以 lockfile / pom.xml 实际版本为准，package.json 已去掉 `^`，禁止自动升级 CopilotKit / AG-UI。

## vue-frontend（生产前端，nginx /agui/）

| 包 | pin 版本 | 备注 |
|---|---|---|
| vue | 3.5.41 | |
| @copilotkit/vue | 1.67.1 | 含 v2 Provider / CopilotChat / A2UI renderer / vueBasicCatalog |
| @copilotkit/core | 1.67.1 | 传递依赖，随 @copilotkit/vue 锁定 |
| @copilotkit/shared | 1.67.1 | 传递依赖 |
| @ag-ui/client | 0.0.57 | HttpAgent / AbstractAgent |
| @ag-ui/core | 0.0.57 | 传递依赖 |
| @ag-ui/a2ui-middleware | 未安装 | 仅作 Java 端 A2UiBridgeService 行为参考 |
| @vitejs/plugin-vue | 5.2.1 | dev |
| typescript | 5.6.2 | dev |
| vite | 5.4.10 | dev |

## gateway（Java 后端，端口 8090）

- Spring Boot 3.3.5（spring-boot-starter-parent）
- Java 17
- Spring Cloud Gateway（WebFlux 栈，SSE 用 Flux<ServerSentEvent>，不引 reactive 改动）

## frontend/（旧 React 前端）

React 18.3.1 + Vite 5，已被 vue-frontend 取代，不再演进。

## 现状要点

> ⚠️ 本节是 2026-08-12 第一节基线的当时快照（端点/接入方式此后已变更）：现行 endpoint 是 `POST /agent/run`（SSE 协议，无 `/opencode/ag-ui`），前端走 fork `directAgents`。现行事实见 `docs/CURRENT_ARCHITECTURE.md`。

- `POST /opencode/ag-ui`（AgUiController → AgUiProtocolService → AguiEventTranslator）已存在，
  走 OpenCode /api/session + /api/event，threadId→sessionId 映射在 AguiEventTranslator 内存 Map。
- 旧端点：`POST /agent/run`（AguiController，{message} 简单协议）；任务书提到的
  `/opencode/api/event` 由 GatewayConfig `/**` 路由透传到 OpenCode(4096)。
- App.vue 当前用 `agents__unsafe_dev_only`（红线 6 要求迁移到 fork 的 `directAgents`，第三节处理）。
- 前端 URL 为 `/agui-api/opencode/ag-ui`，vite dev proxy 与 nginx `location /agui-api/` 均已配置。
- 参考目录实为 `ref/copilotkit-a2ui-vue`（任务书中写的 `ref/copilotkit-fork` 不存在，以实际目录为准）。
