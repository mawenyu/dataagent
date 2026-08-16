# DataAgent 项目状态总览（P27 并行循环收官巡检 · 2026-08-16）

> 本文每次回归巡检时更新。最近更新：P27（2026-08-16，能力清单全链路通车 + fork 失败基线 9→1 清零收尾）。

## 架构一句话

Vue 3 + @copilotkit/vue(fork) 前端 → nginx `/agui-api/` → Java gateway(8090, Spring Cloud Gateway/WebFlux) → OpenCode server(4096, bun) → DeepSeek。
公网入口 `http://101.34.246.179/agui/`（部署 `/var/www/blog/agui/`）。

## ① 测试三线核验（2026-08-16 P27 复核）

| 线 | 结果 | 说明 |
|---|---|---|
| 前端 vue-frontend vitest | **262/262 ✅** | 全量（+10：capabilities 面板 8 + App 接线 2 等） |
| gateway mvn test | **210/210 ✅** | 全量（+11：CapabilitiesService 聚合/降级/路径回归等） |
| fork packages/copilotkit-vue vitest | **1144/1145**（唯一失败 = vision 线领地 A2UI /connect replay，按约 SKIP） | 全量 |

fork 既有失败基线 10 → 1（A 线 5 commit 修复 9 例，ac501c6/1dd295c/f5b466b/41c4c20/2c3d9ed）：
- agentId/threadId 解析与 clearOnFresh/connectingGate（5 例）—— getThreadClone toRaw 解包（FORK#15）+ 测试对齐 FORK#8 语义
- useFrontendTool agent scoping（2 例）—— 测试竞态修复（welcome-screen=false 对齐同文件其余 18 例）
- renderCustomMessages（1 例）—— v-memo 签名补 stateTick（FORK#17）
- SSR import safety（1 例）—— 测试加显式 30s 超时预算（共享机冷 import 7-14s）
- 剩余 1 例：A2UI surface replay —— vision 线领地，baseline 即在红

## ② 部署一致性核验（2026-08-16 P24，两处陈旧已修复）

- **前端（已修复）**：部署 `main-BrDPfOk0.js` 落后于 HEAD（缺 b5f138f P-I parseRunError）。HEAD 全新构建 → rsync 部署 `/var/www/blog/agui/` → 现为 `main-yiUdb2Nq.js`，md5 与 dist 逐字节一致，公网 index/资源 200 ✅
- **gateway（已修复）**：运行 jar（08:13）落后于 HEAD（缺 ebfb4aa RUN_ERROR 结构化 code + 8002a27 MDC traceId）。按 `restart-gateway.sh` 语义重启（并行会话在途红测试挡住主树 package，改为干净 worktree 打包 HEAD → 拷 `/tmp/agui-gateway-run.jar` → 副本启动，cwd=/home/ubuntu/dataagent、.env.opencode 注入已验）。健康 UP（本地 + 公网 `/agui-api/`），日志 pattern 带 `[traceId=]` 证明新 jar 生效；真链路冒烟（p24-smoke-1，DeepSeek 真实应答）RUN_STARTED→RUN_FINISHED 闭环无 RUN_ERROR ✅
- opencode server：2026-08-16 重启装载新 `/api/tool` 端点（opencode-fork d5d737f 已 push origin/dataagent-v2），能力清单 serverTools 通车 ✅
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
| P26 | spreadsheetEdits modal 不弹二次根因修复：MESSAGES_SNAPSHOT 裸标记冲刷流式工具调用 → 历史转换还原 toolCalls（ffe2e3c）+ 客户端钉板测试（fed6ce6）；真实链路复跑 PASS（modal→confirm→CSV 999999），gateway 已上生产，multi-turn 7/7 | /tmp/p26-modal.png、frontendToolExec.test.ts、DEVELOPMENT_STATUS 下一步 1/2 闭环 |
| P27 | 能力清单全链路 + 六线并行循环收官：opencode-fork 新增 `GET /api/tool`（d5d737f，已 push）→ gateway `/capabilities` 五路聚合（source 启发式 builtin/plugin/custom）→ 前端 CapabilitiesPanel 六区展示（侧栏第三 tab）；实测：serverTools 18（builtin 12 / plugin 5=render_a2ui 等 / custom 1=timestamp）、agents 6、skills 10、commands 4、plugins 70，浏览器实测渲染通过；opencode 已重启装载端点；fork 失败基线 9→1；fork patch 重生成（41 文件 13844 行，git apply 验证逐字节一致） | /tmp/caps-final.png、CapabilitiesServiceTest、docs/spec/a2ui-component-matrix.md |

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

- fork 仅剩 1 个既有失败测试（A2UI /connect replay，vision 线领地按约 SKIP；其余 9 例已修）
- capabilities 冷启动 ~23s（插件异步加载竞态，热态 1.7s；gateway 消费方宜在 session 启动后拉取）
- HITL 确认卡片无超时（设计：interrupt 后 run 即结束，卡片持久有效）
- opencode 重启后 resume 走新 session（无旧上下文，A2UI_ACTION prompt 携带足够决策信息）
- 欢迎页自绘输入框的附件走独立链路（P-J 已真实化）；gallery 页 Button disabled 无视觉弱化
