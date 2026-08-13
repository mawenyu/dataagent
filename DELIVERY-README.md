# DataAgent — AG-UI + A2UI 数据智能体（交付版 v1.0）

基于 **Vue 3 + CopilotKit(Vue fork) + AG-UI + A2UI + OpenCode + DeepSeek** 的数据分析 Agent 应用。无 Node Runtime 全链路：前端直连 Java Spring Cloud Gateway，由 Java 桥接 OpenCode agent server。

## 架构

```
浏览器 (Vue3 + @copilotkit/vue fork + @ag-ui/client)
   │  AG-UI over SSE (POST /opencode/ag-ui)
   ▼
Java Gateway (Spring Cloud Gateway, :8090)
   │  事件翻译 / A2UI surface 注册 / a2uiAction 路由 / frontend tool 桥接
   ▼
OpenCode server (:4096, bun)  →  DeepSeek LLM
```

## 目录

| 目录 | 说明 |
|---|---|
| `gateway/` | Java Spring Boot 网关（AG-UI 协议端点 + A2UI 桥），Java 17 + Maven |
| `vue-frontend/` | **现行前端**（Vue 3 + Vite），部署到 `/agui/` |
| `packages/copilotkit-vue` | @copilotkit/vue 1.67.1 内部 fork（`directAgents` 支持），详见其 `FORK.md` |
| `vendor/copilotkit-src` | CopilotKit 上游 monorepo（tag v1.67.1，含 .git），fork 的溯源基线 |
| `frontend/` | 旧 React 前端，**已废弃**，仅存档参考 |
| `ref/` | 参考源码（CopilotKit adk-dashboard 官方示例、ag-ui 上游），不参与构建 |
| `scripts/` | 实测脚本（连续对话 test-multi-turn.sh、需求7 UI 事件 test-ui-req7.py） |
| `docs/` | 设计文档（design.md / ARCHITECTURE.md / VERSIONS.md）与实测证据 screenshots/ |
| `opencode.json` | OpenCode server 项目配置（模型 = deepseek/deepseek-chat） |

## 依赖版本

- JDK 17 + Maven 3.8+（gateway）
- Node 20+（vue-frontend 构建；fork 包为 `file:` 本地依赖，无需发布 npm）
- bun 1.x（运行 OpenCode server，https://bun.sh）
- DeepSeek API key

## 重建与运行

### 1. OpenCode server（agent 后端）

OpenCode 源码：https://github.com/anomalyco/opencode （本部署用其 `packages/opencode`，以 bun 跑源码方式启动）。

```bash
# 安装 bun 后：
git clone https://github.com/anomalyco/opencode.git opencode-src
export DEEPSEEK_API_KEY='sk-...'   # 见 .env.example
cd /path/to/本工程                  # cwd 必须是本工程根（opencode.json 所在处）
bun run /path/to/opencode-src/packages/opencode/src/index.ts serve --port 4096 --hostname 127.0.0.1
```

参考生产启动脚本（key 不落库，自行注入）：

```bash
#!/bin/bash
cd /path/to/本工程
unset OPENCODE_MODELS_PATH
export DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY"
exec bun run /path/to/opencode-src/packages/opencode/src/index.ts serve --port 4096 --hostname 127.0.0.1
```

### 2. Java gateway

```bash
cd gateway
mvn test          # 22+ 协议/桥接单测
mvn spring-boot:run   # 或 mvn package 后 java -jar target/*.jar
# 监听 :8090，健康检查 curl localhost:8090/actuator/health
```

### 3. 前端

```bash
cd vue-frontend
npm install       # 自动通过 file:../packages/copilotkit-vue 安装 fork
npm run build     # 产物在 dist/，vite base 已配置为 /agui/
# 部署：cp -r dist/* /var/www/<站点根>/agui/
```

### 4. nginx 参考配置

```nginx
location /agui/ { alias /var/www/blog/agui/; try_files $uri $uri/ /agui/index.html; }
location /agui-api/ { proxy_pass http://127.0.0.1:8090/;   # 注意尾部斜杠：/agui-api/opencode/ag-ui → /opencode/ag-ui
    proxy_http_version 1.1; proxy_set_header Connection "";
    proxy_buffering off; proxy_read_timeout 600s; }         # SSE 必须关缓冲
```

### 5. 验证

```bash
curl -s http://<host>/agui/ | head -1                        # 页面 200
bash scripts/test-multi-turn.sh http://127.0.0.1:8090        # 连续对话 5 轮实测（7 passed, 0 failed）
```

## 开源修改溯源

唯一修改过的开源组件是 **@copilotkit/vue**：

- 基线：上游 `CopilotKit/CopilotKit` **tag v1.67.1**（`vendor/copilotkit-src` 为含 .git 的完整溯源副本，remote = github.com/CopilotKit/CopilotKit.git）
- fork 产物：`packages/copilotkit-vue`（前端以 `file:` 依赖）
- **完整 diff 清单与原因**：`packages/copilotkit-vue/FORK.md`（共 6 项：directAgents prop、mergeAgents、a2ui adapter 导出修复、打包名等）
- 上游 MIT License 已保留

其余组件（ag-ui client、A2UI、OpenCode、Spring）均为未修改的上游版本，按版本号从官方渠道获取。

## 安全注意

- 仓库内**不含任何 API key**。DeepSeek key 通过环境变量 `DEEPSEEK_API_KEY` 注入 OpenCode server。
- `docs/screenshots/` 内为实测日志/截图，可删。

## 当前版本状态

- ✅ 全链路无 Node Runtime：Vue → Java gateway → OpenCode → DeepSeek
- ✅ A2UI surface 流式渲染 + a2uiAction 回传确定性路由 + 组件白名单
- ✅ frontend tool 桥接、双用户隔离、auth deny 策略
- ✅ 需求7（进行中交付）：连续对话实测通过（上下文记忆验证）、run 超时兜底、SSE 事件（reasoning/tool/context usage）后端就绪
- 🚧 进行中：多会话管理 UI、API 语义化重命名（/opencode → /agent）、UI 绚丽化、context 用量前端展示
- 详见 `TASK-v2.md`（任务书，含逐项 [DONE] 实测证据）与 `docs/design.md`
