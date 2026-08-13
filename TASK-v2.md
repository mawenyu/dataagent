# TASK: DataAgent 会话管理 + 真实 Agent 化 + UI 绚丽化 + API 语义化 + 交付打包

## 项目背景
- 工程：`/home/ubuntu/opencode-agui-app/`（**不是 git 仓库，本次需 git init**）
- 架构：Vue 3 + Vite + @copilotkit/vue(fork) 前端 → nginx `/agui-api/` → Java Spring Boot gateway(8090) → OpenCode server(4096, bun) → DeepSeek
- 前端构建产物部署到 `/var/www/blog/agui/`，访问地址 `http://101.34.246.179/agui/`
- 参考设计源码：`ref/adk-dashboard/`（CopilotKit 官方示例，Apple 风 B2B SaaS 浅色：#f8fafc 底 + 白卡 + #6366f1 靛蓝）
- CopilotKit fork 源码在 `vue-frontend/` 本地依赖或 `packages/`（自行确认位置）

## 需求 1：多会话管理（最高优先级）
- 左侧会话侧边栏：会话列表（标题取首条用户消息截断）、新建会话、切换会话、删除会话、重命名（可选）
- 会话历史**持久化**：刷新浏览器后会话列表和历史消息不丢失。推荐 gateway 提供会话持久化 API（POST /api/chat/threads 等，存文件或 H2/SQLite 均可，零外部依赖优先）；前端 localStorage 仅作缓存兜底
- 每个会话独立 threadId，切换会话时加载该会话历史消息并渲染
- OpenCode 侧：确认 threadId→OpenCode session 的映射在 gateway 已正确隔离

### [DONE] 2026-08-13 需求1 完成（实测证据）

**实现**：
- gateway 新增 `ChatThreadStore`（单文件 threads.json 原子写，零外部依赖，默认 `data/`，`agui.store-dir` 可配）：thread 元数据（标题取首条用户消息截断 30 字）+ threadId→sessionId 映射 + 每 thread 的 A2UI surface 快照（供历史回放重放看板）
- REST API：`GET/POST /chat/threads`、`PATCH/DELETE /chat/threads/{id}`、`GET /chat/threads/{id}/messages`（实时从 OpenCode session 拉历史 → AG-UI Message[]：reasoning/assistant/toolCalls/tool 结果全转换；实测发现 OpenCode 历史"最新在前"且 user 文本在 m.text 含 prompt 包装，均已处理）
- run 时自动建档 + 命名 + touch；ACTIVITY_SNAPSHOT 统一 tap 落盘
- **session 失效自动重建**：复用前 GET /api/session/{id} 存活校验，404/异常则新建并 rebind（实测：注入 bogus sessionId → 日志 "stale … recreating" → run 正常完成 + 映射更新）
- 前端 `useThreads`（API 权威 + localStorage 兜底）+ `ThreadSidebar`（列表/新建/切换/删除确认/双击重命名）+ App.vue 集成（CopilotChat :thread-id 驱动；run 结束后自动刷新列表拿新标题）；窄屏暂隐藏侧边栏（抽屉化在需求4）

**实测**（curl 全链路 + 重启验证）：
- 建 demo-A/demo-B 各发消息 → 列表标题自动生成、sessionId 各自绑定、历史各自隔离（A 红枫77 / B 青竹99）
- demo-A 第二轮问"暗号甲是什么" → agent 答"红枫77"（上下文正确）
- PATCH 重命名为"青竹暗号会话"、DELETE 删除均生效
- gateway 重启后 threads + sessionId 映射完整保留
- 前端 21 vitest 全绿（useThreads 8 + ThreadSidebar 5 等）；部署 bundle 静态校验含 thread-sidebar/dataagent.threads/chat/threads
- gateway 53 测试全绿

**已知边界**：session 失效重建后旧 session 的历史不再可读（新会话从零开始）；A2UI surface 历史回放按 thread 最后快照恢复。

**[补充 DONE] 2026-08-13（commit 9b708e9）用户重申项实测**：
- **切换历史真实渲染到 DOM**：实测发现 fork 的 `useAgent` 按 threadId 克隆 agent，而 core 注册表中的 agent 是 Vue reactive 代理，`clone()` 内 `structuredClone(messages)` 直接抛 DataCloneError —— fork 修复（`toRaw` 解包）并导出 `getThreadClone`；`useThreads.switchTo` 把历史写入 CopilotChat 实际渲染的 per-thread clone。组件级测试用**真实 CopilotKitProvider + CopilotChat** 验证 user/assistant/reasoning 历史均渲染到 DOM（chatHistoryRender.test.ts），前端 22 测试全绿。

**[DONE] 2026-08-13（commit 9b708e9）同批工程化项**：
- **fork 自动构建**：`vue-frontend/scripts/build-fork.mjs` 挂在 prebuild/predev；fork dist 比 src 新则跳过（秒级），否则 npm install + build。实测：删 fork dist 后 `npm run build` 一次成功（1m21s 全量），产物 bundle 含 fork 最新代码（mergeAgents/getThreadClone/rawExisting 均在）；dev server 重启走 predev 后 :3001 公网 200
- **controller 文件名冲突**：`AguiController.java`/`AgUiController.java`（仅大小写不同，Windows/macOS 会冲突）合并为 `AgentRunController.java`
- **配置外置**：`AguiService` 模型 ID 改从 `agui.model.*` 读（WebClientConfig 的 opencode.server.url 原本就走配置；basic 认证见上方插队修复）

## 需求 2：真实 Agent 化（移除一切写死/mock）

> **插队修复 [DONE] 2026-08-13：OpenCode basic 认证支持（commit e9ea915）**
> 用户本地以 OPENCODE_SERVER_USERNAME/PASSWORD 启动 OpenCode 后，gateway 无认证头 → 401 + WWW-Authenticate 透传 → 浏览器弹 Basic 认证框。
> 修复：application.yml 新增 `opencode.server.username/password`（可空明文）；WebClientConfig 有凭证时带 Authorization: Basic 默认头；代理路由剥掉 WWW-Authenticate 兜底。
> 实测：4098 起带认证 opencode（直连 401 + 挑战头）→ 一次性 gateway(8091) 带凭证发完整 RunAgentInput → 200 全链跑完（reasoning + RUN_FINISHED）；本地无认证回归 200 正常。

- 排查 gateway 中所有写死/mock 逻辑：硬编码的 LLM 响应、mock 工具结果、demo 专用的假数据分支（如 `/ag-ui/a2ui-demo` 之类的演示端点）
- 全部改为真实走 OpenCode → DeepSeek 的 agent 链路；a2uiAction 回传后的处理也要走真实 agent 续跑，而不是 Java 里 if/else 返回固定 surface
- 保留 debug 页 `/dataagent/copilotkit-test` 不动

## 需求 3：API URL 语义化（去 opencode 字样）
- `/agui-api/opencode/ag-ui` → 改为按功能命名，如 `/agui-api/agent/run`（前端 HttpAgent 端点同步改）
- 新增会话管理 API：`/agui-api/chat/threads`（GET 列表 / POST 新建 / DELETE 删除 / PATCH 重命名），`/agui-api/chat/threads/{id}/messages`（GET 历史）
- nginx 配置 `/etc/nginx/` 中相关 location 同步更新；改完 `nginx -t && systemctl reload nginx`
- 兼容策略：旧 `/opencode/ag-ui` 可保留 302 或保留一段时间，但前端必须用新 URL

## 需求 4：UI 绚丽化（对齐 CopilotKit adk-dashboard / a2ui 示例水准）
- 浅色 B2B SaaS 主题（#f8fafc 底、白卡、#6366f1 靛蓝 accent），参考 `ref/adk-dashboard/app_globals.css`
- 布局：左侧会话栏（可折叠）+ 主聊天区 + A2UI surface 渲染区
- 细节：消息气泡精致化、打字/加载动画（skeleton/渐变 shimmer）、A2UI 卡片悬停阴影过渡、图表配色用 chart-1~5 色板、空会话欢迎页（品牌 logo + 建议问题快捷入口）
- 移动端基本可用（侧边栏抽屉化）
- 禁止白屏、禁止默认深色简陋样式

## 需求 5：设计文档入工程
- `docs/design.md` 全面更新为详细设计方案：总体架构图（文字/mermaid）、多会话模型（thread/user 隔离）、API 一览表（新 URL）、A2UI surface 协议、frontend tool 机制、会话持久化方案、UI 设计系统（色板/组件规范）、部署拓扑（nginx 路由表）
- 同步更新 `docs/ARCHITECTURE.md`、`docs/VERSIONS.md`

## 需求 6：可移植交付包（用户要拷到公司电脑重建）
**目标：拿到包的人在一台有 JDK17+、Maven、Node20+、bun 的干净机器上能完整重建并运行。**
1. `git init` + 合理的 `.gitignore`（排除 node_modules/target/dist），全部源码入库，干净 commit 历史（按特性多个 commit）
2. **开源修改可溯源**：
   - CopilotKit vue fork：在 `patches/` 目录放针对上游版本的 unified diff patch（标注上游 repo URL + commit/tag），或直接把 fork 源码放 `vendor/` 并附 `vendor/README.md` 说明来源版本与修改点清单
   - 其他所有修改过的开源组件同法处理
3. `README.md` 重建指南：依赖清单（JDK/Maven/Node/bun 版本）、OpenCode server 安装与配置（含 opencode.json、DeepSeek key 配置方式）、前端 build 步骤（含 fork patch 应用步骤）、gateway `mvn package`、nginx 参考配置（`deploy/nginx.conf.example`）、启动顺序与验证 curl 命令
4. `scripts/` 下提供一键脚本：`build-all.sh`（前端+gateway）、`run-dev.sh`
5. 打包：`scripts/package.sh` 生成 `/var/www/blog/dataagent-v1.0.tar.gz`（含全部源码、patches、docs、脚本；**排除** node_modules、target、.git 可选保留、真实 API key——key 用 .env.example 占位）

## 验收（全部实测，禁止口头完成）
1. curl 公网 `http://101.34.246.179/agui/` 200；新 API 路径生效（`curl -H 'Host: 101.34.246.179'` 验证 nginx）
2. 多会话实测：建 2 个会话各发消息 → 切换 → 历史正确 → 刷新页面后仍在
3. 真实 agent 实测：问一个数据问题，确认 gateway 日志显示真实 OpenCode 调用、无 mock 分支命中
4. 打包文件存在且 `tar -tzf` 校验内容完整；在公司电脑模拟验证：解包后按 README 步骤至少 `mvn -q compile` 和 `pnpm/npm install --dry-run` 层面可行
5. 全程截图（侧边栏多会话、新 UI、深色终端日志）放入 `docs/screenshots/`

## 需求 7：对话完整性与可观测性（用户实测发现阻断性 bug，优先级最高）
**实测 bug**：发送"分析本月销售情况"后，前台只收到一条 "I'll help analyze this month's sales situation. Let me first understand what data is available." 就没了下文——流中断/挂起。必须先诊断根因（gateway SSE 流断？OpenCode question 工具挂起无超时？事件翻译丢事件？）并修复，这正是任务书遗留项"run 超时兜底"击中的场景。

修复后必须实现并实测以下能力才算收工：
1. **连续对话测试**：同一会话内连续 5+ 轮问答不中断、上下文正确（agent 记得前文）；用自动化脚本（curl SSE 或 playwright）跑通并留证据
2. **渲染测试**：A2UI surface（MetricCard/BarChart/表格等）在真实 agent 回答中正确流式渲染；a2uiAction 回传后续跑正常
3. **工具调用可见**：前端展示 tool call 过程（工具名、参数摘要、执行状态、结果摘要），可折叠
4. **思考过程可见**：agent 的 reasoning/thinking 流式展示（样式区别于正式回答，如浅色斜体可折叠区块）
5. **会话 context 用量显示**：显示当前会话 token/context size 占用（从 OpenCode 事件或 gateway 统计获取），如 "context: 12.3k/200k"，随对话增长更新
6. **run 超时兜底**：agent 挂起（如 question 工具等待）时 gateway 侧超时终止并向前端发 RUN_ERROR，前端友好提示"可重试"，禁止无声卡死

### [DONE] 2026-08-13 需求7 全部完成（实测证据如下，截图在 docs/screenshots/）

**根因（三层叠加，均实证）**：
1. **主因 — gateway 提前断流**：OpenCode 的 `session.next.step.ended` 是每个 assistant turn 结束（`finish=tool-calls` 表示还要继续），而 gateway `AgUiProtocolService.streamEvents()` 用 `takeUntil(step.ended)` 在第一个 step 就切断 SSE。实测该 prompt 一次产生 3+ step（bash+glob → read → 最终回答），第一刀切完用户只见首条消息。
2. **次因 — OpenCode 权限挂起**：agent 读 workspace 触发 `external_directory` 权限询问（`/api/permission/request` 实测捕获 pending），无头服务器无人应答 → 工具永远 running → 零事件。修复：opencode server 改为以 app 项目根为 cwd 启动（workspace/ 变实例内部路径；项目级 opencode.json 由此真正生效）。
3. **三因 — AG-UI 状态机配对**：step 会重叠/孤儿化（实测多个 step.started 先于 step.ended、存在永不 ended 的孤儿 step），native render_a2ui 截断 run 时还有未关闭的 text/reasoning 消息 → 客户端报 "RUN_FINISHED while steps/text messages are still active"。修复：translator 跟踪活跃 step 集合 + 打开的 text/reasoning 消息，step.ended 只关自己，终止事件前关闭全部残余。

**修复清单（TDD，gateway 32 测试全绿）**：
- `streamEvents`：只在 `step.ended(finish!=tool-calls)` 或 `step.failed` 终止上游流
- translator 新增：STEP_STARTED/FINISHED（唯一名严格配对）、TOOL_CALL_RESULT（tool.success/failed 结果摘要，截断 2k）、REASONING_* 全生命周期、CUSTOM context_usage（contextSize=input+cacheRead）
- run 超时兜底：`agui.run-idle-timeout`（默认 PT120S，空闲判挂起）→ RUN_ERROR("运行超时…可重试") + `POST /api/session/{id}/abort` 清理残留
- 模型可配置（`agui.model.id/provider-id`），默认切 **deepseek-reasoner**（实测 reasoning 流 + 工具调用正常，思考过程 UI 可见）
- prompt 注入数据工作目录提示（`agui.data-workspace`），agent 直接在 workspace/ 找数据；种入示例数据 workspace/sales-2026-08.csv
- 前端：顶栏 context 徽章（useContextUsage 订阅 CUSTOM 事件，"context: 95.3k/128k"）；DefaultToolRender 注册通配工具渲染器（名称/状态/参数/结果，可折叠）；on-error toast 提示可重试

**实测证据**：
- 连续对话：`scripts/test-multi-turn.sh` 5 轮 7 断言全过（含"记得暗号蓝鲸42"），context 逐轮增长 3068→7270；证据 docs/screenshots/req7-multi-turn-evidence.log
- A2UI：真实 agent 产出 ACTIVITY_SNAPSHOT（MetricCard×3+BarChart+DataTable+InsightCard，data path 绑定）；a2uiAction（drill_down_region 华南）走真实 agent 续跑并更新 surface
- 工具/思考/context 徽章：浏览器实测截图 docs/screenshots/req7-02-final.png；部署产物静态校验通过（bundle 含 context-badge/context_usage/copilot-tool-render/重试提示）
- 超时兜底：单测 `hungRunTimesOutWithRunError`（断言 RUN_ERROR + abort）+ 两次真实挂起均 120s 后 RUN_ERROR + abort 收尾（gateway 日志）
- 页面：http://101.34.246.179/agui/ 200；debug 页 /agui/dataagent/copilotkit-test.html 200

**已知边界**：旧实例 session 重启后可能 wedge（空闲超时覆盖）；native render_a2ui 截断的 run 无 tokens 来源，不发 context_usage。


## 工作方式约束
- TDD：每特性先写/改测试再实现；gateway 测试 `./mvnw test`，前端单测跑通
- 每完成一个需求 commit 一次（commit message 中文，说明 why）
- 随时更新本文件：在对应需求下追加 `[DONE] 日期 + 实测证据`
- 服务重启：gateway `systemctl --user restart` 或原有启动脚本；opencode server 重启前确认端口释放
- 遇到问题先诊断根因，禁止无脑重试
