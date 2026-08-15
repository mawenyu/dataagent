# DataAgent 项目状态总览（P12 回归巡检 · 2026-08-16）

> 本文每次回归巡检时更新。当前巡检：`a008417`（P11）之后、并行会话 P-J 已入库。

## 架构一句话

Vue 3 + @copilotkit/vue(fork) 前端 → nginx `/agui-api/` → Java gateway(8090, Spring Cloud Gateway/WebFlux) → OpenCode server(4096, bun) → DeepSeek。
公网入口 `http://101.34.246.179/agui/`（部署 `/var/www/blog/agui/`）。

## ① 测试三线核验（2026-08-16）

| 线 | 结果 | 说明 |
|---|---|---|
| 前端 vue-frontend vitest | **179/179 ✅** | 全量 |
| gateway mvn test | **151/151 ✅** | 全量 |
| fork packages/copilotkit-vue vitest | **1084/1094**（10 失败全部既有，见下） | 全量 |

fork 10 个既有失败（与 P 系列改动零交集，P11 已用"失败集 diff 基线"法证明 0 新增）：
- agentId/threadId 解析与 clearOnFresh/connectingGate（5 例）——并行会话在途特性的测试
- A2UI surface replay（1 例）—— 既有
- useFrontendTool agent scoping（2 例）、renderCustomMessages（1 例）—— 既有
- SSR import safety（1 例）—— 环境抖动型
- 顺手修复：standard-schema 测试因缺 valibot/arktype devDep 文件级失败 → 已补依赖（+17 测试转绿）

## ② 部署一致性核验（2026-08-16）

- `vue-frontend` HEAD 全新构建 vs `/var/www/blog/agui/`：`main-LJQQtx7u.js` **md5 逐字节一致**，index.html 一致，公网抓取同 hash ✅ 无陈旧部署
- gateway 运行 jar = `/tmp/agui-gateway-run.jar` 副本（P-P 固化：`scripts/restart-gateway.sh` = kill → package → 拷副本 → 副本启动；三件套一键 `scripts/up.sh`，幂等）
- opencode server：tmux `opencode2-4096` 常驻（启动必须 `-c /home/ubuntu/dataagent`，否则 jsxImportSource/provider 配置丢失）
- 注意：repo 根有个陈旧顶层 `dist/`（历史残留，非部署源，忽略）

## ③ READY 条目汇总

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
