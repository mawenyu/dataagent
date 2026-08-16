# DEVELOPMENT_STATUS — 当前完成度 / 问题清单 / 下一步（2026-08-16 全面审查）

> 每次开发循环更新。基线：main @ P-S（frontend 233+ 绿 / gateway 164 绿 / fork 目标文件全绿、10 既有失败属并行线在途）。

## 本轮审查新发现（两个探查代理 + 主线自查，全部给出行号证据）

### P0（本轮立即修）

1. **明文 secret 入库**：`gateway/src/main/resources/application.yml:10` opencode 密码硬编码并提交。修法：yml 改 `${OPENCODE_SERVER_PASSWORD:}`，启动脚本 source `.env.opencode`（已含同密码），文档同步。
2. **SSE 手写 escape 可产非法 JSON**：`AgUiProtocolService.java:719-721` 只替换 `"`→`'` 与换行，不转义反斜杠；以 `\` 结尾的 RUN_ERROR 消息破坏协议帧。修法：改 Jackson 序列化 + 测试。
3. **仓库无 CLAUDE.md**（新会话冷启动无指引）。补建。

### P1（本轮修）

4. **agents/ 混入上游样例死代码**（会被 build-opencode.sh 部署到每个 .opencode/）：`agents/tool/github-*.ts`（硬编码上游 owner/repo、引用不存在的 env.d.ts）、`agents/agent/triage.md`/`duplicate-pr.md`（用未配置的 opencode/* 模型，实际不可用）、`agents/skills/*`（4 个样例）、`agents/command/*`（8 个上游命令）、`agents/plugins/tui-smoke.tsx`+`smoke-theme.json`（TUI-only）。移到 `agents/upstream-examples/`（不部署）并改 build 脚本排除。
5. **a2ui-tools.ts 过时注释**：头注释"4 个 UI 工具"实为 5 个（漏 request_user_confirm）；build-opencode.sh:61 同样。
6. **文档漂移**：DELIVERY-README 与现状 6 处矛盾（vendor 空目录 / DEEPSEEK_API_KEY 不存在 / scripts 清单 / 版本状态停滞 / example 空 provider）；`docs/spec/workspace-files.md` 仍写 5MB（实际 50MB）且缺 PUT/子目录/baseModified；`workspace-isolation.md` 缺 409 契约。
7. **applySpreadsheetEdits 原生 confirm**（App.vue:97 区域，唯一残留原生弹窗）。

### P2（排入后续循环）

8. ~~translate 单方法 / 文件端点双套 / 历史拉取重复~~ ✅ d27c6ad（translate → 36 行编排 + 7 事件族）/ 6cff803（端点共享实现委托）/ 403b73a（拉取收敛 ThreadMessagesService）。
9. ~~错误映射 / 阻塞 IO~~ ✅ c209fa0（@RestControllerAdvice：400/404/409/500 结构化 JSON，栈帧不外泄）/ 393319f（store+文件 IO 全量 boundedElastic，SSE 逐事件副作用 concatMap 下移）。189 绿。
10. ~~每事件 `new ObjectMapper()`（AgUiProtocolService 3 处）~~ ✅ a8f4354。
11. ~~死代码：WorkspaceFileService.sizeOf、A2UiActionHandler.parse、A2UiService.BASIC_CATALOG_ID~~ ✅ 2fb571d（parse/ParsedAction 连带清理，-43 行）。
12. fork 10 个既有失败测试（并行线在途，非本线债）。
13. ~~根目录陈旧顶层 `dist/`~~ ✅ 已不存在（复核 2026-08-16）。

### P3

14. `agents/e2e-demo/plugins/demo.ts` root 属主；`.opencode/opencode.jsonc:2` `$schema` 键为空字符串（运行无碍）；CORS 通配+credentials（无 auth 期间可接受）。

## 本轮执行记录

- [x] git 清理：运行时产物入 gitignore，MASTER-PROMPT 入库（b205b6d）
- [x] 五文档：CURRENT/TARGET_ARCHITECTURE、PRODUCT_REQUIREMENTS、本文件、ACCEPTANCE_TESTS
- [x] P0-1 密钥外移（6c6df31）/ P0-2 escape 修复（64a71f2）/ P0-3 CLAUDE.md（0000cae）
- [x] P1-4/5 agents 清理（514c13f）/ P1-7 原生弹窗清零（db7bc07）
- [x] P1-6 文档漂移修正（e2d0dba：DELIVERY-README 6 处 + workspace spec PUT/409/50MB + example provider 占位）
- [x] P2-10 ObjectMapper 去重（a8f4354）/ P2-11 死代码清除（2fb571d）—— gateway 178 绿
- [x] F3 补全：工具级失败结果渲染失败态（f972413，fork 目标文件 30/30 绿，FORK.md 条目 13）
- [x] 验收 Test 4 补齐：`scripts/test-datasource-missing.sh` 真链路 5/5（509ee4b）—— 删 CSV → 工具失败前缀契约 + RUN_FINISHED
- [x] 根 README 补建（abfb0ac）；前端 build + 245 绿 + 部署 /var/www/blog/agui 200
- [x] P2-8 gateway 重构三件套（d27c6ad/6cff803/403b73a，每步 178 绿）
- [x] 移动端验收（playwright 触屏仿真实锤）：
  - 会话行点击被隐形 pin 按钮拦截 → pointer-events 随可见性（0d8acb4，ThreadSidebar 26/26）
  - FilesPanel 同款（b869322）+ fork 图片下载按钮 touch-safe（8a2173c，FORK 条目 14）
  - welcome 占位文案移动端截断 → 单行 + title 提示（794cfaa）
  - 证据截图 docs/screenshots/2026-08-16-mobile-*.png；前端 248 绿
- [x] P2-9 错误映射 + 阻塞 IO（c209fa0/393319f，189 绿）+ gateway 重启上生产 + test-multi-turn 7/7 真链路回归
- [x] P3：`.opencode/opencode.jsonc` $schema 空键修复、demo.ts root 属主、agents/ 空壳目录清理
- [x] TARGET_ARCHITECTURE 差距三项（并行子代理，194 绿）：RUN_ERROR 结构化 code（ebfb4aa，UPSTREAM_ERROR/RUN_TIMEOUT，前端 parseRunError 直接消费）/ ThreadRepository 接口抽取（23f4397，JsonThreadRepository 为实现）/ MDC traceId=runId 全链路（8002a27）
- [x] **spreadsheetEdits 真实链路阻断 bug 根因修复**（本线）：DeepSeek 先流引导文字再以伪 `<tool_call>` 文本调 frontend tool 时，`dispatchToolCall` 截断分支只关 step 不关文本消息 → RUN_FINISHED 先于 TEXT_MESSAGE_END，AG-UI 客户端拒收（"Cannot send 'RUN_FINISHED' while text messages are still active"）。TDD：新增 2 回归用例精确复现线上事件序（红：序列无 TEXT_MESSAGE_END）→ 修复（截断前先补 END）→ `AguiEventTranslatorTest` 33/33 绿（gateway/target/surefire-reports 实测）。全量套件收尾时截断，其余文件本轮零改动，194 基线不受影响面。
- [x] **spreadsheetEdits modal 不弹二次根因修复**（2026-08-16 P26 续，ffe2e3c + fed6ce6）：d992ab5 部署后真实链路复跑仍不弹 modal —— 四场景隔离实验（真实 HttpAgent + CopilotChat + 打桩 fetch 逐字节复现 gateway SSE，`vue-frontend/src/components/frontendToolExec.test.ts`）定位唯一致因：**RUN_FINISHED 前插的 MESSAGES_SNAPSHOT 以 opencode 历史为权威冲刷客户端消息流，而历史里伪 `<tool_call>` 是纯文本** → 流式 TOOL_CALL_* 被抹掉 → handler 永不执行（悬空 parentMessageId、TEXT_MESSAGE 包裹均非致因）。修复：`ThreadMessagesService` 历史转换把标记还原成 `toolCalls`（复用 `FrontendToolBridge.parseToolCall`，含 DSML 伪尾巴容错；确定性 id `histcall-*`；标记前引导文本保留、标记后余文按截断语义丢弃），顺带消除快照/回放把裸标记渲染成可见文本的 UX 泄漏。TDD：gateway `ThreadMessagesServiceTest` +3 → 全量 199/199 绿；前端 252/252 绿。**真实链路复跑 PASS**：modal 弹出 → 确认 → CSV 落盘含 999999（/tmp/p26-diag.py + /tmp/p26-modal.png）；gateway 已重启上生产；`test-multi-turn.sh` 7/7 回归通过。

## 下一步（修完 P0/P1 后）

剩余：
1. ~~gateway 重启上生产（4 commit 未部署）→ test-multi-turn 回归~~ ✅ 2026-08-16 已完成两轮（d992ab5 一轮 + ffe2e3c 一轮），multi-turn 7/7。
2. ~~spreadsheetEdits 真实链路复跑~~ ✅ 2026-08-16 PASS（modal → confirm → CSV 999999 落盘）。
3. fork 既有 2 失败（`use-frontend-tool.e2e.test.ts` Agent Scoping，并行线在途）。
4. DeepSeek 伪 `<tool_call>` 文本输出习性：已确认双路径（native + 文本 marker）都会触发，bridge 均兜住；记录为模型行为基线（本条为观察记录，长期有效）。
5. 观察项（非阻断，记录在案）：模型偶发拒用 frontend tool 改用原生 edit 工具绕过 HITL 直接改 CSV（提示词契约约束力的边界）。
