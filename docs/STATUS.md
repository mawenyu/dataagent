# DataAgent 项目状态总览（P24 交付前最终巡检 · 2026-08-16）

> 本文每次回归巡检时更新。最近更新：P25（2026-08-16，抛光收尾：README 实拍图 + fork 升级路径抽查）。

## 架构一句话

Vue 3 + @copilotkit/vue(fork) 前端 → nginx `/agui-api/` → Java gateway(8090, Spring Cloud Gateway/WebFlux) → OpenCode server(4096, bun) → DeepSeek。
公网入口 `http://101.34.246.179/agui/`（部署 `/var/www/blog/agui/`）。

## ① 测试三线核验（2026-08-16 P24 复核）

| 线 | 结果 | 说明 |
|---|---|---|
| 前端 vue-frontend vitest | **250/250 ✅** | 全量（较 P23 的 179 增至 250，新特性测试随提交进入） |
| gateway mvn test | **202/202 ✅** | 干净 worktree @ HEAD(8002a27) 全量绿；主工作树编译红系并行会话在途 TDD（JsonThreadRepository 红阶段→已闭环，当前在途为 AguiEventTranslator 改动），非回归 |
| fork packages/copilotkit-vue vitest | **1100/1110**（10 失败逐名核对 = 既有基线，0 新增） | 全量 |

fork 10 个既有失败（与 P 系列改动零交集，P11 已用"失败集 diff 基线"法证明 0 新增）：
- agentId/threadId 解析与 clearOnFresh/connectingGate（5 例）——并行会话在途特性的测试
- A2UI surface replay（1 例）—— 既有
- useFrontendTool agent scoping（2 例）、renderCustomMessages（1 例）—— 既有
- SSR import safety（1 例）—— 环境抖动型
- 顺手修复：standard-schema 测试因缺 valibot/arktype devDep 文件级失败 → 已补依赖（+17 测试转绿）

## ② 部署一致性核验（2026-08-16 P24，两处陈旧已修复）

- **前端（已修复）**：部署 `main-BrDPfOk0.js` 落后于 HEAD（缺 b5f138f P-I parseRunError）。HEAD 全新构建 → rsync 部署 `/var/www/blog/agui/` → 现为 `main-yiUdb2Nq.js`，md5 与 dist 逐字节一致，公网 index/资源 200 ✅
- **gateway（已修复）**：运行 jar（08:13）落后于 HEAD（缺 ebfb4aa RUN_ERROR 结构化 code + 8002a27 MDC traceId）。按 `restart-gateway.sh` 语义重启（并行会话在途红测试挡住主树 package，改为干净 worktree 打包 HEAD → 拷 `/tmp/agui-gateway-run.jar` → 副本启动，cwd=/home/ubuntu/dataagent、.env.opencode 注入已验）。健康 UP（本地 + 公网 `/agui-api/`），日志 pattern 带 `[traceId=]` 证明新 jar 生效；真链路冒烟（p24-smoke-1，DeepSeek 真实应答）RUN_STARTED→RUN_FINISHED 闭环无 RUN_ERROR ✅
- opencode server：tmux `opencode2-4096` 常驻 ✅
- 注意：repo 根有个陈旧顶层 `dist/`（历史残留，非部署源，忽略）

## ③ READY 条目汇总

### P24 抽查记录（2026-08-16，4/17 条目 ≈ 24%，跨线取样）

| 抽查条目 | 核验方式 | 结论 |
|---|---|---|
| vision-P4 协议边界 | 5 类畸形 payload SSE 证据齐备（badpath/cycle/deep/noprop/unknown，207~653 行真实事件流）+ READY-VISION-edge.png 在位 | ✅ |
| vision-P11 v-memo 性能 | docs/perf/frontend-long-chat.md 实测表 313.2ms→8.3ms（38×）在卷，口径一致 | ✅ |
| vision-P23 错误恢复 UI | p23-error-recovery-ui.txt 三态同框说明 + 截图在位，取证页 `/agui/a2ui-gallery.html?batch=uistates` 随本次部署保持可访问 | ✅ |
| READY-FRONTEND P9 | 代码级核验：欢迎页输入/附件/发送 run 中禁用（App.vue `:disabled="isRunning"`）；停止按钮 fork CopilotChat 默认接 `abortRun()`（CopilotChat.vue:558/676）；gateway 客户端断开即 `abortSession`（AgUiProtocolService.java:437-441） | ✅ |

### READY-VISION（A2UI/AG-UI 线，截图在 /tmp/screenshots/READY-VISION-*.png）

| 条目 | 内容 | 关键证据 |
|---|---|---|
| vision-P0~P3 | 28 组件全覆盖 / AG-UI 33 事件矩阵闭环 / HITL interrupt-resume | docs/spec/a2ui-component-matrix.md、agui-protocol-matrix.md、a2ui-agui-extensions.md |
| vision-P4 | 协议边界 5 类畸形 payload 双层防护（cycle 栈溢出真修复） | edgeCases + READY-VISION-edge.png |
| vision-P5 | 插件回执与裁决同步（叙事一致）/ 性能基线 / HITL 超时取消中断恢复 | docs/perf/a2ui-baseline.md、hitl-lifecycle.txt |
| vision-P6 | 场景扩展：表单校验错误卡（checks）+ 多步向导（自主组合 HITL） | p6-*.sse ×5 + 2 截图 |
| vision-P8 | gateway 可观测性：run-metrics.log + 成功率 gauge | docs/evidence/2026-08-15-p8-observability.txt |
| vision-P10 | surface 生命周期（更新/替换/关闭 + 逐 op 容错） | 2026-08-16-p10-surface-lifecycle.sse |
| vision-P11 | 长会话 v-memo：流式 tick 313→8.3ms（38×） | docs/perf/frontend-long-chat.md |
| vision-P12~P17 | 全链路回归巡检（STATUS.md）/ 恶意 payload 防护 / HITL 并发裁决 / 表格回写链（冲突检测+坐标上限）/ 事件流压测 / 叙事一致性审计 | docs/perf/event-stream-stress.md、docs/evidence/p13~p17 系列 |
| vision-P18~P22 | 断网恢复深挖（历史去重修复）/ dashboard 真实化（opsUrl 回放）/ 多会话并发隔离 / HITL 审批 UI（附言+结果徽章）/ 图表三边界 | docs/perf/concurrent-threads.md、docs/evidence/p18~p22 系列 |
| vision-P23 | 错误恢复 UI 取证页（错误卡/离线徽章/恢复 toast 三态同框） | docs/evidence/2026-08-16-p23-error-recovery-ui.txt + READY-VISION-p23-error-recovery.png |
| P24 | 交付前最终巡检：三线复核 + 部署一致性（前端/gateway 两处陈旧已修复上线）+ READY 抽查 24% 全过 + 真链路冒烟 | docs/STATUS.md ①②③ |
| P25 | 抛光收尾：README 公网实拍图（真实 run → A2UI 看板）+ fork 可升级性抽查（上游 1.68.1 删除 getThreadClone = 升级硬阻塞，路径已立项） | docs/screenshots/p25-home.png、docs/FORK-UPGRADE-PATH.md |

### READY-FRONTEND（前端 UX 线）

| 条目 | 内容 |
|---|---|
| P-A~P-D（并行会话） | 会话导出 Markdown / run 失败内联错误恢复卡 / 文件预览 modal / 欢迎页模板卡 |
| P-E~P-H（并行会话） | 模板卡高亮+一键清空+输入框自适应 / maxRows=3 / 会话归档区 / 多选批量归档删除 |
| P-I/P-J（并行会话） | 断线检测+离线徽章+自动续跑+5xx 结构化错误码 / 附件上传真实化+限制提示 |
| P7 | ThreadSidebar 搜索过滤（子序列模糊）+ 置顶（localStorage） |
| P9 | run 中输入禁用+停止按钮 + gateway 客户端断开即 abort session |

### task 主线（前期）

task5（workspace 文件管理/official capabilities）、task6（workspace 会话隔离 +
ChatGPT 式上传，含 413 修复 50MB 上限）——证据见 docs/evidence/task6-*.txt、
docs/spec/workspace-*.md。

## 核心规格/文档索引

- 协议矩阵：`docs/spec/agui-protocol-matrix.md`（33 事件：22 实测 + 11 附理由不用）
- 组件矩阵：`docs/spec/a2ui-component-matrix.md`（28 组件全实测 + P4 边界附录）
- 扩展能力：`docs/spec/a2ui-agui-extensions.md`（扩展机制盘点/HITL/场景模式/生命周期）
- 性能：`docs/perf/a2ui-baseline.md` + `docs/perf/frontend-long-chat.md`
- 证据：`docs/evidence/`（全部 curl SSE/实测记录）

## 已知边界（择要）

- fork 10 个既有失败测试（归因见上节，属并行会话在途特性）
- HITL 确认卡片无超时（设计：interrupt 后 run 即结束，卡片持久有效）
- opencode 重启后 resume 走新 session（无旧上下文，A2UI_ACTION prompt 携带足够决策信息）
- 欢迎页自绘输入框的附件走独立链路（P-J 已真实化）；gallery 页 Button disabled 无视觉弱化
