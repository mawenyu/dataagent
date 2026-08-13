# OpenCode2 + AG-UI + Spring Boot Gateway 项目设计文档

## 1. 项目目标

构建一个三层架构的 AI Agent 应用：

- **Agent 引擎层**：OpenCode2（`opencode serve` headless server），模型使用 Kimi K3（用户的 Kimi API key，provider: `kimi-for-coding`）
- **Agent Gateway 层**：Java Spring Boot，作为前端与 OpenCode server 之间的协议网关
- **前端层**：基于 AG-UI 协议的聊天界面，支持流式输出（SSE）

## 2. 总体架构

```
┌─────────────┐   HTTP/SSE    ┌──────────────────────┐   HTTP/SSE   ┌─────────────────┐    Anthropic API    ┌──────────┐
│  AG-UI      │ ────────────▶ │  Spring Boot         │ ───────────▶ │  OpenCode2      │ ─────────────────▶ │  Kimi K3 │
│  Frontend   │ ◀──────────── │  Agent Gateway       │ ◀─────────── │  Server (:4096) │ ◀───────────────── │  API     │
│  (Nginx)    │   AG-UI 事件流 │  (:8090)             │  opencode    │  (headless)     │   (api.kimi.com)   │          │
└─────────────┘               └──────────────────────┘   SSE 事件    └─────────────────┘                    └──────────┘
```

## 3. 各层职责

### 3.1 OpenCode2 Server（Agent 引擎）
- 来源：GitHub 官方仓库 `anomalyco/opencode`（原 sst/opencode）`dev` 分支源码（v2 架构，monorepo：`packages/opencode` 为 CLI+server 主包，`packages/server` 为 HTTP API 层）
- 编译方式：bun 1.3.14，`bun install` + 从 `packages/opencode` 只构建 server 相关产物（`--skip-embed-web-ui` 跳过前端嵌入）
- 启动命令：`opencode serve --port 4096 --hostname 127.0.0.1`
- 模型配置：`kimi-for-coding/k3`，通过 `~/.local/share/opencode/auth.json` 注入 KIMI_API_KEY
- 工作目录：`/home/ubuntu/opencode-agui-app/workspace`
- 能力：会话管理、消息流式生成、工具调用（文件读写、bash 等）

### 3.2 Spring Boot Agent Gateway（:8090）
职责：
- 接收前端的 agent 运行请求（POST `/agent/run`，AG-UI RunAgentInput 格式）
- 在 OpenCode server 上创建/复用 session，发送用户消息
- 订阅 OpenCode 的 SSE 事件流，翻译成 **AG-UI 协议事件**（RUN_STARTED / TEXT_MESSAGE_START / TEXT_MESSAGE_CONTENT / TEXT_MESSAGE_END / RUN_FINISHED / RUN_ERROR / TOOL_CALL_* 等）
- 以 SSE 方式推送给前端
- 附带：健康检查 `/actuator/health`、会话列表 `/agent/sessions`

技术栈：Spring Boot 3.x + WebFlux（响应式 SSE）+ Java 17

### 3.3 AG-UI Frontend
- 框架：React + Vite + TypeScript
- 依赖：`@ag-ui/core` + `@ag-ui/client`（或手写 AG-UI SSE 客户端，取决于包可用性）
- 功能：聊天窗口、流式消息渲染（Markdown）、工具调用过程展示、会话管理
- 构建产物部署到 Nginx，子路径 `/agui/` 对外访问

## 4. 关键协议

### AG-UI 事件（网关 → 前端，SSE）
- `RUN_STARTED` { threadId, runId }
- `TEXT_MESSAGE_START` / `TEXT_MESSAGE_CONTENT`(delta) / `TEXT_MESSAGE_END`
- `TOOL_CALL_START` / `TOOL_CALL_ARGS` / `TOOL_CALL_END`
- `RUN_FINISHED` / `RUN_ERROR`

### OpenCode Server API（网关 → opencode）
- `POST /session` 创建会话
- `POST /session/:id/message` 发送消息（流式）
- `GET /event` 全局事件订阅（SSE）
- 实际端点以 `opencode serve` 暴露的为准，开发时先探测再适配

## 5. 端口与部署

| 组件 | 端口 | 说明 |
|------|------|------|
| OpenCode server | 4096 (127.0.0.1) | 仅本机 |
| Spring Gateway | 8090 (127.0.0.1) | 仅本机 |
| Nginx | 80 | `/agui/` → 前端静态文件；`/agui-api/` → gateway 代理（SSE 需关 buffering） |

访问地址：http://101.34.246.179/agui/

## 6. 目录结构

```
/home/ubuntu/opencode-agui-app/
├── docs/                  # 设计/过程/总结文档
├── gateway/               # Spring Boot agent gateway
├── frontend/              # AG-UI React 前端
├── workspace/             # opencode 的工作目录（agent 实验沙箱）
├── scripts/               # 启动/停止脚本
└── opencode.json          # opencode 项目配置（model: kimi-for-coding/k3）
```

## 7. 风险与备选

1. OpenCode server 的事件 API 细节未知 → 开发网关前先 curl 探测实际端点
2. `@ag-ui/*` npm 包可能拉取失败 → 备选手写极简 AG-UI SSE 客户端
3. Kimi API 大请求体 400 问题 → 网关侧限制历史长度
