# CAPABILITIES_DEFINITION.md — 能力页各类能力的定义出处（2026-08-16）

> 能力面板（rail「能力」主视图）展示的一切都有唯一真源。本文按类别给出：
> 定义在哪 → 怎么生效/部署 → 怎么被 `/agui-api/capabilities` 聚合进面板。
> 改能力前先查本文，禁止在面板侧写死清单。

## 总览：数据流

```
定义层：
  opencode 内置工具/插件 ─┐
  agents/plugins/*.ts ────┤  build-opencode.sh 部署到 .opencode/ ──► opencode server :4096
  agents/{agent,command,skills}/*.md ─┘                                │ 五路 REST
  vue-frontend App.vue frontendTools（客户端，不走网络）                ▼
                                                   gateway CapabilitiesService 聚合
                                                                       │ GET /agui-api/capabilities
                                                                       ▼
                                                   useCapabilities → CapabilitiesPanel 六区渲染
```

## 1. Server 工具（面板「Server 工具」区，带 source 分类）

三种来源，面板用 `source` 字段区分（`builtin` / `plugin` / `custom`）：

| source | 定义出处 | 例子 |
|---|---|---|
| `builtin` | opencode-fork 内置工具（以 `opencode.tool.<name>` 插件形式注册，见 fork `packages/core` 工具链） | read/write/edit/bash 等 12 个 |
| `plugin` | **业务插件 `agents/plugins/a2ui-tools.ts`** | render_a2ui / request_user_confirm / render_report / render_slides / update_canvas |
| `custom` | `.opencode/tool/` 自定义工具（当前仅上游样例 timestamp，见 §4） | timestamp |

### 1.1 插件工具注册机制（`agents/plugins/a2ui-tools.ts`）

- 用 fork 插件 API：`Plugin.define({ id: "dataagent.a2ui-tools", setup })`，`setup` 里
  `ctx.tool.transform(tools => tools.add({...}))` 把 5 个工具**注册进 opencode 工具表**
  （input schema 即模型可见契约）。
- **`options: { codemode: false }` 是必须的**：默认工具只经 CodeMode 暴露，模型按名调用
  会得到 `Unknown tool`（2026-08-15 实测踩坑）；`codemode:false` 让工具出现在普通工具列表。
- 插件端 `execute` 只做轻量校验 + 结构化回执；**真正的 UI 事件裁决在 gateway**
  （`AguiEventTranslator` / `A2UiBridgeService` 等在 `session.tool.called` 拦截同名调用，
  展开成 ACTIVITY_SNAPSHOT）。渲染逻辑单一真源在 Java 侧，插件不复制。
- `render_a2ui` 的回执先过 `POST /a2ui/validate`（gateway 裁决），被拒则如实告知模型
  纠正重试，不许自称"已渲染"。
- 依赖解析：`OPENCODE_FORK_PATH`（默认 `/home/ubuntu/opencode-fork`）动态 import fork 的
  `packages/plugin/src/promise/index.ts` —— npm 包是旧 API，没有 `tool.transform`。

## 2. 前端工具（面板「前端工具」区）

- **定义**：`vue-frontend/src/App.vue` 的 `frontendTools` 数组（CopilotKit 客户端工具，
  zod schema + 浏览器端 handler）。当前 2 个：`showNotification`（toast）、
  `applySpreadsheetEdits`（CSV 单元格编辑，自绘确认 modal，HITL）。
- **桥接链路**（gateway `FrontendToolBridge.java`）：本版 opencode 的 v2 runner 不透传
  per-request 工具定义给模型，gateway 在 prompt 层实现 AG-UI frontend-tool 契约：
  1. `RunAgentInput.tools` 非空 → schema 注入 prompt + 严格输出契约（调工具 = 只回一个
     `<tool_call>{...}</tool_call>` 块）；`sanitizeTools` 限量 32 个 / 单 schema 16KB；
  2. `AguiEventTranslator` 检出该块 → 转标准 TOOL_CALL_START/ARGS/END 事件（不流成文本），
     结束本轮，浏览器执行 handler；
  3. 客户端以 `role:"tool"` 消息回传结果 → `buildContinuationPrompt` 合成续跑 prompt。
  历史回放侧：`ThreadMessagesService` 把历史里的 `<tool_call>` 标记还原成 toolCalls
  （确定性 id `histcall-*`），防止 MESSAGES_SNAPSHOT 冲刷掉工具渲染（P26 根因修复）。
- **进面板方式**：不经网络 —— `App.vue` 把 `frontendTools` 以 props 传给
  `CapabilitiesPanel`，与 server 侧清单分区展示。

## 3. Agents / Skills / Commands（面板对应三区）

- **定义位置**：`agents/agent/*.md`、`agents/command/*.md`、`agents/skills/<name>/`
  （opencode 约定的 markdown 前置元数据格式；样例见 `agents/upstream-examples/`）。
  **当前业务仓这三类目录为空** —— 面板上看到的 6 agents / 10 skills / 4 commands 全部
  来自 opencode 内置与上游生态，主仓未定义业务 agent/skill/command。
- **部署链路**：`agents/build-opencode.sh`（或手工）把 `agents/` 下的
  `plugins tool skills command agent` 五个顶层目录复制到 `<target>/.opencode/`；
  `upstream-examples/` **不部署**（P1#4 隔离，脚本循环不含它）。
  opencode server 以仓库根为 cwd 启动（`scripts/up.sh`），运行时读取 `.opencode/`。
  当前运行侧 `.opencode/` 只有 `plugins/a2ui-tools.ts` + `opencode.jsonc`。
- 改完后重启 opencode 生效（bun 源码运行，无构建）。

## 4. 插件清单（面板「插件」区）

- 出处：opencode `GET /api/plugin` 返回全部已装载插件 id（内置 + 业务，实测 70 条）。
- 契约坑（P30-a 已修）：上游条目只有 `id`，前端契约要 `name` —— gateway 在
  `CapabilitiesService.assemble` 归一化补 `name=id`，否则面板渲染 70 条空白行。

## 5. 聚合端点：`GET /agui-api/capabilities`

- **入口**：`CapabilitiesController`（`/capabilities`，nginx/vite 剥掉 `/agui-api` 前缀）。
  全部逻辑在 `CapabilitiesService`。
- **聚合**：`Mono.zip` 五路并行真实拉取 opencode —— `/api/agent`、`/api/command`、
  `/api/skill`、`/api/plugin`、`/api/tool`（最后一项是 fork 新增端点，主分支
  `dataagent-v2` commit d5d737f）。**禁写死清单**。
- **降级**：单路失败 → 该路空数组 + `log.warn`，不拖垮整体；`/api/tool` 失败额外置
  `toolsAvailable=false`。
- **冷启动竞态**（P28-B）：opencode 端口就绪早于注册完成，五路都可能回 200+空清单
  （空 plugins 还会把 builtin 误判 custom）。空清单按 250ms/500ms/1s/2s/4s 退避重试，
  连接拒绝不重试快速降级。
- **source 启发式**：插件清单含 `opencode.tool.<name>` → builtin；工具名命中
  `agents/plugins/a2ui-tools.ts` 源码里 `name: "..."` 提取的清单（正则解析，不写死
  字符串，`opencode.plugin-tools-file` 可覆盖路径）→ plugin；其余 → custom。
- **清洗**：skills 的 `content` 全文剥离；`hidden:true` 的 agent 过滤。

## 6. 前端展示

- `useCapabilities`（composable）：拉取 + 缓存（`ensureLoaded` 不重复拉，`refresh`
  强制重拉，失败保留旧数据）。
- `CapabilitiesPanel`：六区 = server 工具 / 前端工具 / 插件 / agents / skills / commands；
  rail「能力」主视图独占 72rem 画布（P29）。

## 7. 新增能力的正确姿势

| 想加什么 | 加在哪 | 生效 |
|---|---|---|
| 服务端裁决工具（UI 渲染类） | `agents/plugins/a2ui-tools.ts` 加 `tools.add` + gateway 翻译器拦截 | 部署 `.opencode/` + 重启 opencode + 重启 gateway |
| 客户端工具（需浏览器执行/HITL） | `App.vue` `frontendTools` | 前端重新构建部署 |
| 业务 agent / skill / command | `agents/agent|skills|command/` | `build-opencode.sh --skip-build` 部署 + 重启 opencode |
| 内置工具行为 | opencode-fork `packages/core` | fork 仓 commit + 重启 opencode |
