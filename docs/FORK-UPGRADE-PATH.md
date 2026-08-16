# FORK-UPGRADE-PATH.md — fork 可升级性抽查（P25 · 2026-08-16）

> 方法：npm registry 拉取上游 `@copilotkit/vue` **1.67.1**（fork 基线，发布于 2026-08-10）与
> **1.68.1**（latest，发布于 2026-08-14） tarball，`src/` 级 diff；再与 fork 工作树实测 diff 取交集。
> 本文不依赖上游 CHANGELOG（tarball 内 CHANGELOG.md 两版逐字节相同，无信息量）。

## 1. 版本快照

| 项 | 值 |
|---|---|
| fork 版本 | `1.67.1-fork.1`（base tag `v1.67.1`，见 `packages/copilotkit-vue/FORK.md`） |
| 上游 latest | **1.68.1**（1.68.0 / 1.68.1 两个小版本在 fork 之后 4 天内发布） |
| 上游 dist-tags | `latest=1.68.1`，`canary=1.62.2-canary.*` |
| 结论 | 落后 2 个小版本；无安全通告驱动，**短期可不动**，但存在一处硬阻塞（见 §4） |

## 2. Vendor patch 清单（fork vs upstream 1.67.1，实测 diff）

修改 16 文件 + 新增 4 文件（FORK.md 编号 → 文件 → 性质）：

| 文件 | patch | 线 | 升级冲突风险 |
|---|---|---|---|
| `v2/providers/CopilotKitProvider.types.ts` / `.vue` | #1 #2 directAgents | 主线 | 低（上游未动） |
| `v2/providers/mergeAgents.ts`（新）+ directAgents 测试（新） | #3 #4 | 主线 | 无（纯新增） |
| `v2/index.ts`（a2ui adapter 显式导出） | #5 | 主线 | 低（上游未动） |
| `v2/hooks/use-agent.ts`（toRaw 修 DataCloneError） | #6 | 主线 | **高（上游整文件重写）** |
| `v2/hooks/index.ts`（re-export getThreadClone） | #7 | 主线 | **阻塞（上游已删该 API）** |
| `v2/components/chat/CopilotChatView.vue`（welcome gating） | #8 | 主线 | 低（上游未动） |
| `v2/hooks/use-default-render-tool.ts`（时长/状态图标/失败前缀） | #10 #13 | 主线 | 低（上游未动） |
| `v2/components/chat/CopilotChatInput.vue`（maxRows=3） | #11 | 主线 | 低（上游未动） |
| `CopilotChatMessageView.vue` + `CopilotChatAssistantMessage.vue`（P-S 操作栏/时间戳/touch-safe） | #12 #14 | 主线 | **中（上游改了同文件 12 行）** |
| `v2/components/a2ui/VueSurface.ts`、`A2UISurfaceActivityRenderer.vue` | vision 线 | vision | 低（上游未动） |
| 测试 ×4（AssistantMessage/Input/View/use-default-render-tool）+ 新增 2（PS 测试、java-wire-contract） | 随各 patch | — | 低 |

## 3. 上游 1.67.1 → 1.68.1 变更面（src 实测）

源码改动仅 4 个非测试文件 + 测试若干：

- `v2/hooks/use-agent.ts` —— **重写级**（diff 283 行）：引入 thread-scoped proxy agent
  （`UseAgentThreadScopedProps`：本地 `agentId` 注册代理、路由到 `runtimeAgentId`，注释明示
  "Mirrors React's UseAgentThreadScopedProps"）；旧 `cloneForThread` 函数删除；
  **`getThreadClone` 从上游代码库整体移除**（1.67.1 存在于 use-agent.ts/MessageView/5 个测试，
  1.68.1 grep 零命中）。
- `v2/components/chat/CopilotChatMessageView.vue` —— 12 行：改为直接读 registry agent，
  不再走 `getThreadClone`。
- `v2/components/chat/CopilotChat.vue` —— 15 行（fork 未碰此文件，无冲突）。
- 新增测试 `use-agent-thread-isolation.test.ts` / `use-agent-thread-pinning.test.ts`
  （thread 隔离/钉住成为上游一等能力）。
- 上游同时改了 `clearOnFresh` / `slots` / `CopilotChat.test` / `ActivityRendering` 测试 ——
  与 fork 当前 5 个在途失败测试同区域，**上游 1.68.1 很可能已修复这批行为**。
- 依赖联动：`@copilotkit/core|shared|web-components|web-inspector` 1.67.1 → 1.68.1（升级须同步 pin）。

## 4. 交集结论（冲突面）

| 冲突 | 级别 | 说明 |
|---|---|---|
| `getThreadClone` 上游删除 | **阻塞** | fork #7 re-export + 应用侧 `App.vue`/`useThreads.ts`/`use-default-render-tool.ts` 三处消费。升级 = 先把应用的多会话历史写入机制迁到上游 thread-scoped proxy agent，否则编译即断 |
| `use-agent.ts` 重写 | 高 | fork #6 的 `toRaw()` 修复点（`cloneForThread` 内）已不存在；新架构下 `structuredClone` DataCloneError 是否仍发生需重新实测，不能直接 re-apply |
| `CopilotChatMessageView.vue` 双改 | 中 | 三方合并：上游 12 行（去 getThreadClone）× fork P-S 操作栏/时间戳 |
| 其余 14 个 patch 文件 | 低 | 上游未动，机械 re-apply 即可 |

## 5. 建议路径

1. **维持现状（推荐，当前）**：pin `1.67.1-fork.1`。上游领先的两个小版本主题（thread-scoped
   agent / pinning / isolation）恰是 fork 用 `getThreadClone` 自解决的问题域——等并行会话在途的
   threadId 特性（5 个失败测试）闭环后再评估，避免双线同时动同一区域。
2. **升级时（到 ≥1.68.1）顺序**：
   a. 先迁应用侧：`App.vue`/`useThreads.ts` 的 `getThreadClone` 历史写入 → 上游
      `UseAgentThreadScopedProps` 机制（React 侧已有对应实现可对照）；
   b. sparse-checkout 新 tag `packages/vue`，重放 §2 中低风险 patch（FORK.md 升级步骤不变）；
   c. 重新实测 #6 的 DataCloneError 场景（多 threadId CopilotChat），确认新架构下是否还需要 toRaw；
   d. 依赖 pin 升到同 tag 版本；`npm run build && vitest 全量 + scripts/test-multi-turn.sh` 回归。
3. **长期信号**：上游把 vue 包当一等公民在快速迭代（4 天 2 版），且改动方向（thread 隔离）
   与本项目多会话需求同向——每季度做一次本文式 tarball diff 复查，落后 >4 个小版本时启动升级。

## 6. 复查命令（下次巡检可重放）

```bash
curl -s https://registry.npmjs.org/@copilotkit%2Fvue | python3 -c \
  "import json,sys;d=json.load(sys.stdin);print(d['dist-tags'])"
npm pack @copilotkit/vue@<latest>   # 解包后与 packages/copilotkit-vue/src diff -rq
```
