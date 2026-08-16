# DEVELOPMENT_STATUS — 当前完成度 / 问题清单 / 下一步（2026-08-16 全面审查）

> 每次开发循环更新。基线：main @ P28（frontend 262 绿 / gateway 213 绿 / fork 1177 绿 **0 红**）。

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
12. ~~fork 10 个既有失败测试~~ ✅ 2026-08-16 A 线修复 9 例（ac501c6 getThreadClone toRaw / 1dd295c 测试对齐 FORK#8 / f5b466b agent-scoping 竞态 / 41c4c20 v-memo+stateTick / 2c3d9ed SSR 超时预算）；最后 1 例 A2UI /connect replay 由 P28-A 根治（vitest inline @copilotkit/core，22b74ae）→ **fork 套件 0 红（1155/1155）**。
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
- [x] **能力清单全链路通车（P27，六线并行循环）**：opencode-fork 新增 `GET /api/tool` 注册工具清单端点（d5d737f，server 25/25 + tool.test 3/3，已 push origin/dataagent-v2）→ gateway `GET /capabilities` 五路并行聚合（agents/skills/commands/plugins/tools，单路失败降级、skills content 剥离、hidden agent 过滤、source 启发式 builtin/plugin/custom）→ 前端 `CapabilitiesPanel` 六区展示 + `useCapabilities` composable（侧栏第三 tab，frontendTools 经 props 区分客户端工具）。两处实测抓虫修复：controller 误映射带前缀路径（5557a6a + 反射回归）/ opencode 未重启端点未装载（已重启 :4096 实测 18 工具：builtin 12 / plugin 5=render_a2ui 等五个全中 / custom 1=timestamp；浏览器实测面板渲染 /tmp/caps-final.png）。已知：冷启动 ~23s（插件异步加载竞态），热态 1.7s。
- [x] **fork 失败基线清零收尾**：9 红 → 1 红（见 P2-12）；三线回归 frontend 262 ✅ / gateway 210 ✅ / fork 1144+1SKIP ✅；fork patch 重生成（patches/copilotkit-vue-fork.patch，41 文件 13844 行，git apply 干净应用 + diff -rq 逐字节一致验证）。
- [x] **spreadsheetEdits modal 不弹二次根因修复**（2026-08-16 P26 续，ffe2e3c + fed6ce6）：d992ab5 部署后真实链路复跑仍不弹 modal —— 四场景隔离实验（真实 HttpAgent + CopilotChat + 打桩 fetch 逐字节复现 gateway SSE，`vue-frontend/src/components/frontendToolExec.test.ts`）定位唯一致因：**RUN_FINISHED 前插的 MESSAGES_SNAPSHOT 以 opencode 历史为权威冲刷客户端消息流，而历史里伪 `<tool_call>` 是纯文本** → 流式 TOOL_CALL_* 被抹掉 → handler 永不执行（悬空 parentMessageId、TEXT_MESSAGE 包裹均非致因）。修复：`ThreadMessagesService` 历史转换把标记还原成 `toolCalls`（复用 `FrontendToolBridge.parseToolCall`，含 DSML 伪尾巴容错；确定性 id `histcall-*`；标记前引导文本保留、标记后余文按截断语义丢弃），顺带消除快照/回放把裸标记渲染成可见文本的 UX 泄漏。TDD：gateway `ThreadMessagesServiceTest` +3 → 全量 199/199 绿；前端 252/252 绿。**真实链路复跑 PASS**：modal 弹出 → 确认 → CSV 落盘含 999999（/tmp/p26-diag.py + /tmp/p26-modal.png）；gateway 已重启上生产；`test-multi-turn.sh` 7/7 回归通过。
- [x] **P28-A fork 剩红清零**（22b74ae）：最后 1 例 A2UI /connect replay 挂起根因 = @copilotkit/core 是安装依赖被 vitest 外部化，其 dist 顶层 `import { Socket } from "phoenix"` 绕过 vi.mock（探针实锤 sockets:0）→ 真 Phoenix Socket 在 jsdom 挂死。修复：vitest.config `server.deps.inline: [/@copilotkit\/core/]`。全量 1155/1155，**fork 套件 0 红**。
- [x] **P28-B capabilities 冷启动竞态根治**（a7e77d1）：实测冷启动窗口期五路都可能回 200+空清单，且 plugins 空会污染 source 分类（实测 builtin 12 全误判 custom 13）——比原记录的"23s 慢"更严重（返回即时的错数据）。修复：gateway 五路统一 `readinessGuard` 空清单退避重试（250ms/500ms/1s/2s/4s，~7.75s 预算覆盖冷启动窗口；连接拒绝不重试快速降级；耗尽降级空数组+log.warn）。TDD +3（工具空清单重试/耗尽降级/plugins 空清单分类污染回归）→ gateway 213/213 绿；gateway 重启上生产。**实测对照**：修复前窗口直击 plugins:0/custom:13 错数据；修复后端口就绪瞬间直击 → 5.91s 返回完整正确数据（boot+9.6s，agents 6/skills 10/commands 4/plugins 70/builtin 12+plugin 5+custom 1），热态 0.13s 无回归（/tmp/p28b-capabilities-cold.json）。
- [x] **FORK#18 A2UI 协议边界第一批**（cd2bd9c）：`sanitizeA2uiOperations` 入口消毒（畸形 JSONL 容错解析/非对象条目丢弃/300KB props 耐压），payload 在但 0 可用 op → `a2ui-payload-error` 警告 chip 取代无限 loading；A2UIBoundaryPayloads.test.ts 10 例。
- [x] **FORK#20/22 A2UI 协议边界第二、三批**（3c5bc8a / 7267b07）：第二批 —— 超大 payload 截断（string >1MB 留 marker、整条 op >4MB 丢弃）、重复 op 去重、out-of-order 归一化，A2UIBoundaryBatch2 10 例（2MB 渲染卡死 → 138ms，证据 docs/evidence/2026-08-16-a2ui-boundary-batch2.md）。第三批 —— 20+ op pipeline 组合顺序交互：第二批全局 rank 排序被 [create,delete,create] 复活序列实锤双重出错，改为 **per-surface 分段归一化**（deleteSurface 段屏障不可越过，段内字节级去重 key 取自截断后 op + create 提段首），A2UIBoundaryBatch3 11 例（截断后 dedupe key 稳定性 / 21 op 三轮复活渲染回归 / 27 行 JSONL 混合流 / 30 op 多 surface 总集成），证据 docs/evidence/2026-08-16-a2ui-boundary-batch3.txt。fork 全量 1177/1177 绿 0 红。
- [x] **P28-A 主线 bundle 预算 + 懒加载**（afbcd47）：预算断言脚本 `check-bundle-budget.mjs`（vite manifest 静态闭包逐文件真实 gzip 求和，单入口初始 JS <500KB，超线 exit 1，`npm run budget` 可挂 CI）。基线实测 index 481.4KB 已达预算 96%，根因 = fork 两处聊天组件静态 import streamdown-vue 拖入 shiki+mermaid；改 `defineAsyncComponent` 懒加载（FORK#19）后 index 287.3KB / gallery 235.8KB。TDD：fork 3 个同步断言改 waitFor、app chatHistoryRender 加 waitForText；顺手清零 formChecks 红框字面量断言既有红线（vision 调色板化后即红）。证据 `docs/evidence/2026-08-16-bundle-budget.md`。
- [x] **P28-B 主线 Button disabled WCAG AA 收口**（本 commit）：fork catalog Button 禁用态弃 `opacity: 0.5`（半透明在 primary 白字蓝底对比度塌陷）→ 三变体统一实心 muted 配色（新 token `surfaceDisabled #e5e7eb` + `textDisabled #4b5563`，对比度 6.1:1，FORK#21）；gallery form 批新增三变体禁用演示（checks 绑空路径 → isValid=false）。TDD：fork 禁用态测试改写 + WCAG 对比度公式断言 ≥4.5:1、app galleryGuard 渲染级断言 3 禁用按钮；真浏览器截图 + computedStyle 取证 `docs/evidence/2026-08-16-button-disabled-gallery.png`。STATUS 已知边界"Button disabled 无视觉弱化"条目清除。

- [x] **P29 界面结构重构 + 新建会话 bug 修复**（P0 插队，0c71165 + fa0275e）：**bug** —— 生产实测复现（playwright 公网）根因 = `crypto.randomUUID` 仅 secure context 可用，裸 HTTP 站点 createNew 首行抛 TypeError 点击整体无效（jsdom 提供 randomUUID，单测盲区）；修复 = composables/uuid.ts 三级降级替换 5 处直调 + useThreads `settlePendingRefresh` 竞态防护（在途 refresh 旧快照不得顶掉本地列表变更，TDD 竞态回归锁定）。**重构** —— 60px 导航 rail（对话/能力双主视图，aria-current），能力 = CapabilitiesPanel 72rem 整幅画布；v-show 保活 CopilotChat；侧栏 tabs 收敛会话/文件。前端 280/280 绿 + typecheck 干净；已部署 /var/www/blog/agui，**公网实测 PASS**（rail 双视图切换 aria 跟随 / 点新建 POST 200、新会话置顶 active、currentId 变更、欢迎页回归、零 pageerror，证据 docs/evidence/2026-08-16-p29-new-thread-and-rail-layout.txt）。测试环境坑沉淀：jsdom getComputedStyle 对 detached 树缓存不失效，「先隐后显」isVisible 断言序列必须 attachTo。

## 下一步（修完 P0/P1 后）

剩余：
1. ~~gateway 重启上生产（4 commit 未部署）→ test-multi-turn 回归~~ ✅ 2026-08-16 已完成两轮（d992ab5 一轮 + ffe2e3c 一轮），multi-turn 7/7。
2. ~~spreadsheetEdits 真实链路复跑~~ ✅ 2026-08-16 PASS（modal → confirm → CSV 999999 落盘）。
3. ~~fork 既有失败（use-frontend-tool.e2e Agent Scoping 等）~~ ✅ 2026-08-16 清零（9→0，P28-A 根治最后 1 例，fork 1155/1155 全绿，见 P2-12）。
4. DeepSeek 伪 `<tool_call>` 文本输出习性：已确认双路径（native + 文本 marker）都会触发，bridge 均兜住；记录为模型行为基线（本条为观察记录，长期有效）。
5. ~~观察项：模型偶发拒用 frontend tool 改用原生 edit 绕过 HITL 直改 CSV~~ ✅ P27 已加固（2026-08-16）：提示词层 client_tools 段落 + 工具描述双重显式禁止；gateway 对原生 edit/write/multiedit 直改 CSV/TSV/XLS 追加警告回执（观测模式不阻断，log.warn 可检索）。长期效果待线上观测。
