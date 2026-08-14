# 综合端到端验证报告：gateway + opencode2 v2 + 插件全能力

日期：2026-08-15（实际为 8/14 深夜~8/15 凌晨）
链路：浏览器(vite:3001) → gateway(:8090) → opencode2(:4096) → DeepSeek

## 0. 关键架构决策：4096 实例换了实现

gateway 原对接的 4096 是 npm 打包的 opencode2 二进制（plugin 包 1.18.15）。
实测其 v2 插件 API **没有 tool/session domain**（无 tool.transform、无
tool.hook），无法演示工具与钩子，因此将 4096 切换为官方仓库 v2 分支源码
（/home/ubuntu/opencode-v2-verify，commit 8bcc245 + MCP bridge）运行。

切换牵出的 gateway↔服务端协议差异（全部实测发现并修复，gateway 65 测试全绿）：

| 差异 | 旧打包二进制 | v2 官方分支 | gateway 适配 |
|---|---|---|---|
| 事件名 | `session.next.*` | `session.*` | translator 归一化（normalizeDialect，双方言兼容） |
| reasoning id | `reasoningID`（且各 step 复用 reasoning-0） | 无（assistantMessageID+ordinal） | 归一化时合成 |
| 工具调用 id 字段 | `callID` | `id` | 归一化时映射 |
| tool.called 工具名 | `tool` 字段 | 无（回退 input.started 注册名） | translator 回退 |
| prompt payload | `{"prompt":{"text"}}` | `{"text"}` | 新格式优先，400 回退旧格式 |
| 取消执行 | `POST /api/session/{id}/abort` | `POST /api/session/{id}/interrupt` | interrupt 优先，失败回退 abort |
| 事件流 | 按会话过滤/有回放 | 全局流、volatile 不回放 | ①订阅先于 prompt（replay 缓冲）②按 sessionID 客户端过滤 |

## 1. 插件部署方式

- 插件主体：`~/.config/opencode/plugins/demo.ts`（v2 `Plugin.define`，
  import 指向 monorepo 源码 `opencode-v2-verify/packages/plugin/src/promise/index.ts`，免 bun add）
- 文件方式：`~/.config/opencode/agents/explorer.md`、`commands/deploy.md`、
  `skills/hello-skill/SKILL.md`（+scripts/hello.py）
- 配置：`OPENCODE_CONFIG=/tmp/oc4096.json`（model + allow-all 权限）

## 2. 逐项验证证据

### a. 工具（timestamp）+ hook（execute.before）— 全链路通过
```
$ curl -N :8090/agent/run  "调用 timestamp 工具（直接调用），把结果告诉我"
事件流（gateway 输出）:
  TOOL_CALL_START toolCallName=timestamp
  TOOL_CALL_ARGS ×13 → TOOL_CALL_END → TOOL_CALL_RESULT "当前时间: 2026-08-14T15:40:03Z (Asia/Shanghai)"
  TEXT_MESSAGE_* 回答 "当前时间（Asia/Shanghai）：2026-08-14T15:40:03…"
  RUN_FINISHED
4096 端日志: [acme.demo hook] execute.before tool=timestamp input={"timezone":"Asia/Shanghai"}
```

### b. 子 agent（summarizer via task/subagent 工具）— 通过
```
$ curl -N :8090/agent/run  "用 task 工具调用 summarizer 子 agent 总结…转述结果"
事件流: TOOL_CALL_START toolCallName=subagent → RESULT(子 agent 摘要) →
        TEXT_MESSAGE_CONTENT ×199（完整转述）→ RUN_FINISHED
会话落库内容确认子 agent 真实执行并返回结构化摘要。
```

### c. skill — 通过
```
GET :4096/api/skill → ["customize-opencode", "hello-skill"]
```

### d. command — 通过
```
GET :4096/api/command → ["init","review","deploy","demo-review"]
（deploy=文件定义，demo-review=插件 command.transform 注册）
```

### e. 插件加载 — 通过
```
GET :4096/api/plugin → 69 个插件含 acme.demo
```

## 3. 有序性校验（多工具 + 子 agent 交错真实场景）

对 plugin-full4（timestamp）与 plugin-sub4（subagent）的 gateway 输出按 id 归并校验：
```
plugin-full4.sse  terminal: RUN_FINISHED  counts: {'TOOL': 15, 'TEXT': 32}                violations: NONE
plugin-sub4.sse   terminal: RUN_FINISHED  counts: {'REASONING': 146, 'TOOL': 55, 'TEXT': 201}  violations: NONE
```
（每个 id 的 START 在 delta 前、delta 在 END 前、END 后无游离 delta。）

## 4. 前端确认（:3001 真实浏览器）

发消息"调用 timestamp 工具告诉我现在几点" → 页面渲染 `timestamp` 与
`subagent` 工具卡片（可折叠，含参数/结果）、思考过程折叠区、context 徽章，
无 JS 错误。截图：`docs/screenshots/plugin-e2e-frontend.png`。

## 5. 踩到的坑（全部实测）

1. **打包二进制 v2 插件 API 无 tool/session domain** —— 工具/钩子演示必须换 v2 分支源码。
2. **旧二进制 transform 惰性**：v2 插件的 agent/command transform 需显式 `ctx.agent.reload()` 才生效（新分支源码不需要）。
3. **插件重复注册**：全局 plugins/ 目录发现 + OPENCODE_CONFIG plugins 字段指向同一插件 → "Duplicate plugin ID" 导致整个 reload 失败。留一路即可。
4. **/api/event 全局流 + volatile 不回放**（v2 分支）：gateway 原先"先发 prompt 再订阅"，秒回的 tool call 全丢 → run 挂起。修复：replay() 缓冲 + 订阅先于 prompt。
5. **全局流跨会话串扰**：子 agent 的 child session 事件混在同一流，且 child 有独立 aggregate seq（与 parent 重复）——不过滤会撞乱序缓冲。修复：按 data.sessionID 客户端过滤。
6. **方言差异**：事件名/字段名/prompt payload/abort 端点全部不同（见第 0 节表）。
7. **兜底定时器韧性**：fold 超时 flush 若因 sink 状态异常抛错会静默死亡 —— 加了 offer 驱动的兜底 flush（不依赖定时器）+ 定时器异常保护。
