# DataAgent — AG-UI + A2UI 数据智能体（交付版 v1.0）

基于 **Vue 3 + CopilotKit(Vue fork) + AG-UI + A2UI + OpenCode + DeepSeek** 的数据分析 Agent 应用。无 Node Runtime 全链路：前端直连 Java Spring Cloud Gateway，由 Java 桥接 OpenCode agent server。

## 架构

```
浏览器 (Vue3 + @copilotkit/vue fork + @ag-ui/client)
   │  AG-UI over SSE (POST /agui-api/agent/run)
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
| `agents/` | **OpenCode2 定制层**：plugins/tool/skills/command/agent + `build-opencode.sh` 一键构建部署（上游样例隔离在 `upstream-examples/`，不部署；配合 fork [`mawenyu/opencode@dataagent-v2`](https://github.com/mawenyu/opencode/tree/dataagent-v2)） |
| `packages/copilotkit-vue` | @copilotkit/vue 1.67.1 内部 fork（`directAgents` 支持），详见其 `FORK.md` 与 `patches/copilotkit-vue-fork.patch` |
| `vendor/copilotkit-src` | CopilotKit 上游 monorepo 的 submodule 指针（gitlink @ bee3913，内容未入库、本地未检出）；fork 溯源以 `patches/copilotkit-vue-fork.patch` + 上游 tag v1.67.1 为准 |
| `ref/` | 参考源码（CopilotKit adk-dashboard 官方示例、ag-ui 上游），不参与构建 |
| `scripts/` | 运维与实测脚本：`up.sh`（opencode+gateway+vite 三件套幂等拉起）、`restart-gateway.sh`（gateway 重启纪律）、`test-multi-turn.sh`（5 轮连续对话）、`test-attachment-e2e.sh`（附件全链路）、`test-frontend-tool.sh`、`test-a2ui-form.sh`、`test-a2ui-all-components.sh`、`test-event-order-e2e.py`（乱序重排）、`test-ui-req7.py`（需求7 UI 事件） |
| `docs/` | 权威文档（PRODUCT_REQUIREMENTS / CURRENT_ARCHITECTURE / TARGET_ARCHITECTURE / DEVELOPMENT_STATUS / ACCEPTANCE_TESTS）+ design.md / ARCHITECTURE.md / VERSIONS.md / spec/ 与实测证据 evidence/·screenshots/ |
| `opencode.json` | OpenCode server 项目配置（模型 = deepseek/deepseek-chat） |

## 依赖版本

- JDK 17 + Maven 3.8+（gateway）
- Node 20+（vue-frontend 构建；fork 包为 `file:` 本地依赖，无需发布 npm）
- bun 1.x（运行 OpenCode server，https://bun.sh）
- DeepSeek API key

## 重建与运行

### 1. OpenCode server（agent 后端）

OpenCode 源码：**fork [`mawenyu/opencode@dataagent-v2`](https://github.com/mawenyu/opencode/tree/dataagent-v2)**（= 上游 v2 + MCP Tool Bridge 等定制）。

```bash
# 安装 bun 后：
git clone --depth 50 --branch dataagent-v2 https://github.com/mawenyu/opencode.git opencode-fork
cd opencode-fork && bun install
# 部署扩展到本工程 .opencode/（plugins/tools/skills/commands + opencode.jsonc）
bash /path/to/本工程/agents/build-opencode.sh --target /path/to/本工程 --skip-build
# 在本工程根创建 tsconfig.json（bun 转译 fork 内 tsx 需要）：
echo '{"compilerOptions":{"jsx":"preserve","jsxImportSource":"@opentui/solid"}}' > /path/to/本工程/tsconfig.json
# 启动（cwd 必须是本工程根，读取 .opencode/opencode.jsonc 里的 deepseek provider）：
cd /path/to/本工程
echo 'OPENCODE_SERVER_PASSWORD=<同 gateway application.yml 的 opencode.server.password>' > .env.opencode && chmod 600 .env.opencode
set -a; . ./.env.opencode; set +a
bun run --conditions=browser /path/to/opencode-fork/packages/cli/src/index.ts serve --port 4096 --hostname 127.0.0.1
```

> 注意：DeepSeek key 在 `.opencode/opencode.jsonc` 的 `provider.deepseek.apiKey`（不入库，参考 `agents/opencode.jsonc.example`）；serve 密码只认环境变量 `OPENCODE_SERVER_PASSWORD`。

### 1.1 生产启动方式（tmux 常驻，本服务器现行方式）

```bash
tmux new-session -d -s opencode2-4096 -x 220 -y 50 \
  "cd /home/ubuntu/dataagent && unset OPENCODE_MODELS_PATH \
   && set -a && . ./.env.opencode && set +a \
   && bun run --conditions=browser /home/ubuntu/opencode-fork/packages/cli/src/index.ts \
        serve --port 4096 --hostname 127.0.0.1 2>&1 | tee /tmp/opencode2.log"
```

要点：
- **cwd 必须是本工程根**（读 `.opencode/opencode.jsonc` 的 provider + `tsconfig.json` 的 jsxImportSource，否则 bun 转译 fork 内 tsx 时报 `Cannot find module 'react/jsx-dev-runtime'`）
- 密码通过 `.env.opencode` 注入（`chmod 600`），不要写进 tmux 命令行（`ps` 可见）
- 健康检查：`curl -u opencode:<pw> http://127.0.0.1:4096/api/health` 返回 200

### 2. Java gateway

```bash
# 推荐(P-P 固化): 一键拉起/重启三件套(opencode :4096 + gateway :8090 + vite :3001,幂等)
scripts/up.sh            # 缺啥起啥;已健康的服务跳过
scripts/up.sh --build    # 强制重新打包 gateway

# gateway 重启纪律(kill → package → 拷贝 /tmp 副本 → 从副本启动):
scripts/restart-gateway.sh           # 跳过测试快速重启
scripts/restart-gateway.sh --tests   # 先 mvn test 全绿再重启
```

要点：
- **gateway 从 `/tmp/agui-gateway-run.jar` 副本运行**，不直接 `java -jar target/*.jar` —— 否则下次 `mvn package` 原地覆盖运行中的 jar，热路径类加载可能 wedge（实测踩过）；副本即"正在运行的制品"，可审计
- 重启顺序必须是 **先 kill 再 package 后启动**（restart-gateway.sh 已固化）
- 启动 cwd = 仓库根（workspace 落点 `./workspace/`，与现行一致）
- 监听 :8090，健康检查 `curl localhost:8090/actuator/health`

### 3. 前端

```bash
cd vue-frontend
npm install       # 自动通过 file:../packages/copilotkit-vue 安装 fork
npm run build     # prebuild 钩子（scripts/build-fork.mjs）自动先构建 fork，无需手动
                  # 产物在 dist/；vite base 已配置为 /agui/（dev server 为 /）
# 部署：cp -r dist/* /var/www/<站点根>/agui/
```

### 4. nginx 参考配置

```nginx
location /agui/ { alias /var/www/blog/agui/; try_files $uri $uri/ /agui/index.html; }
location /agui-api/ { proxy_pass http://127.0.0.1:8090/;   # 注意尾部斜杠：/agui-api/agent/run → /agent/run
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

- 基线：上游 `CopilotKit/CopilotKit` **tag v1.67.1**；`vendor/copilotkit-src` 仅为 submodule 指针（gitlink，内容未入库），逐行溯源以下方的 `patches/copilotkit-vue-fork.patch` 为准（patch 即完整 unified diff）
- fork 产物：`packages/copilotkit-vue`（前端以 `file:` 依赖）
- 上游 MIT License 已保留

### 如何查看 fork 改动（逐行可见）

1. **patch 文件**：`patches/copilotkit-vue-fork.patch` —— 上游 v1.67.1 `packages/vue` → 本 fork 的完整 unified diff（src 全部修改 + 新增文件 + package.json/tsconfig.json/package-lock.json 变动），git 生成、含 `a/` `b/` 前缀。
2. **复现 fork**：
   ```bash
   # 在任意干净目录：
   git clone --depth 1 --branch v1.67.1 https://github.com/CopilotKit/CopilotKit.git
   cd CopilotKit && mv packages/vue packages/copilotkit-vue   # patch 的目标路径
   git init -q . && git add -A && git commit -qm base          # git apply 需要索引
   git apply /path/to/patches/copilotkit-vue-fork.patch
   # 得到的 packages/copilotkit-vue 与本仓库内的 fork 完全一致（已实测 diff -rq 无差异）
   ```
3. **改动摘要（9 项）**：
   1. `CopilotKitProvider` 新增 `directAgents` prop（业务代码不碰 `agents__unsafe_dev_only`）
   2. `mergeAgents.ts`（新文件，directAgents 合并优先级）
   3. directAgents 单测（新文件）
   4. `v2/index.ts` 显式导出 a2ui adapter 的 `createVueComponent`/`createBinderlessVueComponent`（上游 barrel 遮蔽）
   5. `use-agent.ts` `toRaw` 修复：core 注册表的 reactive 代理导致 clone() 的 structuredClone 炸 DataCloneError
   6. `hooks/index.ts` 导出 `getThreadClone`（多会话历史写入 per-thread clone）
   7. `CopilotChatView.vue` welcome 屏去掉 `!hasExplicitThreadId` 门控（direct-agent 下显式 threadId 也是新会话）
   8. `java-wire-contract.test.ts`（新文件，AG-UI 事件契约回归）
   9. 打包：`package.json`（file: 依赖钉版）/ `tsconfig.json` / `package-lock.json`、新增 `FORK.md`/`LICENSE`
   
   逐条原因见 `packages/copilotkit-vue/FORK.md`。

其余组件（ag-ui client、A2UI、OpenCode、Spring）均为未修改的上游版本，按版本号从官方渠道获取。

## 安全注意

- 仓库内**不含任何 API key**。DeepSeek key 写在 `.opencode/opencode.jsonc` 的 `provider.deepseek.apiKey`（gitignore 不入库，占位结构见 `agents/opencode.jsonc.example`）；OpenCode serve 密码经 `.env.opencode` 的环境变量 `OPENCODE_SERVER_PASSWORD` 注入。
- `docs/screenshots/` 内为实测日志/截图，可删。

## 当前版本状态

- ✅ 全链路无 Node Runtime：Vue → Java gateway → OpenCode → DeepSeek（无 mock，唯一 agent 入口 POST /agui-api/agent/run）
- ✅ 需求1 多会话管理（gateway 持久化 + 侧边栏 + 历史回放 + session 失效自动重建）
- ✅ 需求2/3 去 mock + API 语义化（/agent/run + /chat/threads，无历史残留）
- ✅ 需求7 对话完整性与可观测性（reasoning/工具调用/context 用量可见 + run 超时兜底）
- ✅ OpenCode basic 认证支持（opencode.server.username/password）
- ✅ 需求4 UI 绚丽化：浅色 B2B SaaS 主题 + READY-VISION 系列打磨（骨架屏/会话分支/消息级操作/HITL 质感/图表真实数据边界/错误恢复 UI），证据见 `docs/READY-FRONTEND.md` 与 `docs/screenshots/`
- ✅ 需求5 文档体系：PRODUCT_REQUIREMENTS / CURRENT_ARCHITECTURE / TARGET_ARCHITECTURE / DEVELOPMENT_STATUS / ACCEPTANCE_TESTS 五文档已建（`docs/`）
- ✅ P0 安全修复：opencode 密码移出 `application.yml`（`.env.opencode` 环境变量注入）；SSE RUN_ERROR/RAW 帧手写 escape 改 Jackson 序列化（反斜杠非法 JSON 修复）
- ✅ 全仓原生弹窗清零：applySpreadsheetEdits 的原生 confirm 改自绘确认 modal
- **权威问题清单与下一步见 `docs/DEVELOPMENT_STATUS.md`**；端到端验收场景见 `docs/ACCEPTANCE_TESTS.md`
- 早期任务书与逐项 [DONE] 实测证据：`TASK-v2.md`、`docs/design.md`
