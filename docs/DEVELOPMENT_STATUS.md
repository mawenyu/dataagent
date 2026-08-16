# DEVELOPMENT_STATUS — 当前完成度 / 问题清单 / 下一步（2026-08-16 全面审查）

> 每次开发循环更新。基线：main @ P28（frontend 262 绿 / gateway 213 绿 / fork 1177 绿 **0 红**）。

## 本轮审查新发现（两个探查代理 + 主线自查，全部给出行号证据）

### P0（本轮立即修）

1. **明文 secret 入库**：`gateway/src/main/resources/application.yml:10` opencode 密码硬编码并提交。修法：yml 改 `${OPENCODE_SERVER_PASSWORD:}`，启动脚本 source `.env.opencode`（已含同密码），文档同步。
2. **SSE 手写 escape 可产非法 JSON**：`AgUiProtocolService.java:719-721` 只替换 `"`→`'` 与换行，不转义反斜杠；以 `\` 结尾的 RUN_ERROR 消息破坏协议帧。修法：改 Jackson 序列化 + 测试。
3. **仓库无 CLAUDE.md**（新会话冷启动无指引）。补建。

### P1（本轮修）

4. ~~agents/ 混入上游样例死代码~~ ✅ 514c13f（全部 git mv 到 `agents/upstream-examples/`，build-opencode.sh 部署循环只含 plugins/tool/skills/command/agent 顶层目录；P30 复核 2026-08-16：脚本排除逻辑结构核验 ✓、运行侧 .opencode/ 仅剩 a2ui-tools.ts ✓、gateway 221/221 绿）。
5. ~~a2ui-tools.ts 过时注释~~ ✅ 514c13f（P32 复核 2026-08-16：头注释已是"5 个 UI 工具"，与 name: 计数一致；P34 复核更正：build-opencode.sh 存在且仍是部署入口（DELIVERY-README §1），部署循环覆盖 plugins/（含 workspace-guard.ts）——此前"已不存在/并入 up.sh"的表述有误）。
6. **文档漂移**：DELIVERY-README 与现状 6 处矛盾（vendor 空目录 / DEEPSEEK_API_KEY 不存在 / scripts 清单 / 版本状态停滞 / example 空 provider）；`docs/spec/workspace-files.md` 仍写 5MB（实际 50MB）且缺 PUT/子目录/baseModified；`workspace-isolation.md` 缺 409 契约。
7. ~~applySpreadsheetEdits 原生 confirm~~ ✅ db7bc07（Promise 化 askConfirm + 自绘 ConfirmDialog，全仓原生弹窗清零；P30 复核 2026-08-16：grep 零残留、ConfirmDialog/spreadsheetEdits 17 例绿、公网 HITL 取消路径实测 PASS，证据 docs/evidence/2026-08-16-p30-hitl-modal-cancel.txt）。

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

- [x] **P31 长会话历史加载 256KB 缓冲截杀修复**（本轮 audit 新发现，308ce21）：生产日志实锤 vision-p6-form 历史加载 DataBufferLimitException（WebClient 默认 maxInMemorySize 256KB，多 A2UI surface 长会话历史 JSON 轻易超限）。修复：WebClientConfig maxInMemorySize 可配、默认 8MB 常量。TDD：JDK HttpServer 真实 512KB 响应体，显式 262144 完整复现生产异常（红）→ 默认路径绿 + 显式小上限保护语义不丢。gateway 223/223 绿；已重启上生产，70/70 会话历史回归 OK + multi-turn 7/7；证据 docs/evidence/2026-08-16-p31-webclient-buffer-limit.txt。旁证：P29 新 rail 移动端 390px 触屏实测无回归。

- [x] **P0-abc 三连**（274421a / 60a8163 / 589325a）：**P0-a 能力页插件区空白行** —— 公网实测根因 = opencode /api/plugin 70 条仅含 id，gateway 透传，前端 PluginInfo 契约要 name → 70 条空白行 + key 冲突；修复在 gateway 协议边界归一化补 name=id（BFF 职责），CapabilitiesServiceTest 红→绿。**P0-b 文件面板升格 rail 第三主视图** —— rail 新增「文件」入口，FilesPanel 独占主视图绑定当前会话隔离工作目录；对话视图纯粹化：删 sidebar tabs，只剩会话列表 + 聊天工作区。**P0-c 顶栏品牌净化** —— 删「Vue + CopilotKit · No Node Runtime · DeepSeek via OpenCode」badge，副标题 → AI 数据分析助手。前端 281/281 + typecheck 绿；已部署，**公网实测 14/14 PASS**（插件 70 行全带名 / rail 三视图切换 / 顶栏零技术栈残留，证据 docs/evidence/2026-08-16-p0abc-plugins-rail-brand.txt）。

- [x] **P32 多模态文件预览 —— 图片直渲弹层**（786b534）：体验价值点（P 清单清零后按架构师路线）。缺口 = 图片扩展名不在 PREVIEWABLE，二进制图按文本拉会乱码；修复 = isImage() 判定 + FilePreviewModal imageUrl 分支 `<img>` 直渲下载 URL（gateway 按扩展名给 Content-Type，前端零二进制处理），阈值 5MB 超大图走下载提示。TDD 6 新例先红后绿，前端 288/288 + typecheck 绿；已部署，**公网实测 6/6 PASS**（真实 PNG 上传→点击→naturalWidth=64 真解码，CSV 表格回归，证据 docs/evidence/2026-08-16-p32-image-preview.txt）。**至此 P0/P1/P2 清单全部清零**（P3 为既定接受项）。

- [x] **P33 workspace 隔离二期 —— 公共区只读 + 写权限白名单插件 + 面板两区**（2026-08-16，9f224d3 / 1cfbdb0+d0e4d91 / 2d0a109）：一期隔开会话目录后共享根仍是"谁都能写"，二期把共享根升格为**公共数据区**（用户可写、agent 只读），三层落地——**A prompt 层**：`AgUiProtocolService.environmentSection()` 单点组装，新增"公共数据目录 workspace 只读"段（run + a2uiAction 续跑共用），gateway +2 测试红→绿；**B 插件层硬拦**：`agents/plugins/workspace-guard.ts`（opencode effect 插件，`execute.before` 钩子返回 `Tool.Error`），write/edit/patch 白名单 = 本会话目录 + /tmp，sessionID→threadId 反查 data/threads.json（mtime 缓存），未知 session 护 workspace 树；patch 目标从 patchText 头提取。直连 opencode e2e `scripts/test-workspace-guard.sh` **5/5 PASS**（公共区根/跨会话/覆盖 CSV 三拒 + 会话目录与 /tmp 两放，证据 2026-08-16-p33b-workspace-guard.txt）；**C 面板两区**：树交互抽 `FileTree.vue`，FilesPanel = 会话文件（仅本会话，无会话显空态）+ 公共数据（共享根，badge「所有会话共享 · agent 只读」，用户可传参考数据），前端 +3 两区用例。验收：gateway 225 绿 / 前端 291 绿 + typecheck / multi-turn 真链路 7/7（证据 2026-08-16-p33-acceptance-multiturn.txt）；前端已部署 /var/www/blog/agui。spec：docs/spec/workspace-isolation.md 二期附录。

- [x] **收尾2 长 reasoning 流式渲染卡顿修复**（2026-08-16，72b45ea/27710a1/f971a25/0418a6e/fd01597，FORK#23+#24）：实测长思考（多轮深入逐步思考 + CSV 分析）主线程探针最差 **9687ms** 冻结。两层根因，各修一层——**FORK#23 限频渲染**：`use-throttled-content.ts`（leading 立即 + 120ms 窗口合并 + trailing 对齐），reasoning/assistant 两处 StreamMarkdown content 改限频副本（slot 契约仍拿实时内容），fork 测试实锤 200 delta 全量 re-parse 196/201 次 → ≤12 次。**FORK#24 zod 校验记忆化**：CDP Profiler 栈归因实锤真热点 = 流式期间每个 delta 触发消息列表重渲 → 每条 activity 消息对大 discriminated union 全量 `safeParse` + GC 抖动（单 RunTask 6.5s）；`activity-parse-cache.ts` 按 (message, content引用) WeakMap 记忆化，接入 MessageView + use-render-activity-message 两处 call site（content 引用变即重 parse，不丢 ACTIVITY_SNAPSHOT 更新）。验收 = 真浏览器探针法 `scripts/test-streaming-smoothness.py`（headless_shell 的 longtask/rAF 指标不可信，改用 Python 侧 page.evaluate 往返延迟）：部署后实测 **8 流式探针，p95=50ms / worst=50ms（阈值 500/2000ms）PASS**，证据 docs/evidence/2026-08-16-streaming-smoothness-probe.txt。
- [x] **收尾2 补充 FORK#25 流式高亮降级**（2026-08-17 凌晨，归因充分后按架构师收口指令）：FORK#24 部署后仍观测到内容相关抖动（2946~3237ms），抓内容实锤 = DeepSeek 分析类回答带 ```mermaid 围栏 + 流式期 shiki 高亮分配风暴。两处降级——**codeblock**：streamdown-vue components map 的 `codeblock` 覆盖键，流式期喂 `plain-code-block.ts`（纯 pre>code 零高亮），结束回默认 shiki CodeBlock；**mermaid**：其分支先于 codeblock 键拦截不住，新增 `lib/degrade-mermaid.ts` 流式渲染副本 ```mermaid→```text 改名降级（半截围栏同样降级、无 mermaid 同引用快路径），结束一次性真渲染。fork 测试 631/631 绿（新增 plain-code-block 2 + degrade-mermaid 4 + 两 throttle 各 2 断言）。部署后探针 ×4：**流式窗口 p95 稳定 4~304ms（对比最初 9687ms 持续冻结）**；残留 = 结束瞬间一次性真渲染（mermaid×2 + 全文 shiki，78KB 回答）的单次事件型阻塞 3.1~14.7s，记录在案（后续候选：idle 再升格 / mermaid 异步化，未做）。证据 docs/evidence/2026-08-17-fork25-mermaid-degrade-probe.txt。
- [x] **布局分栏：对话栏 / 中央 A2UI 工作区**（2026-08-17）：宽屏（≥1024px）对话视图改左右分栏——中央大工作区专门渲染 A2UI 产物（render_a2ui/render_report 的图表/看板/表格/表单），右侧窄对话栏（400px/min 340）只放文字消息/思考/工具记录。纯应用侧实现零 fork 改动：新文件 `utils/a2uiOps.ts`（ops 扫描：surfaceId 提取/组件统计/消息判定，容错对齐 fork sanitize 语义）、`A2uiWorkspace.vue`（每条 a2ui-surface activity 消息一个堆叠块，复用 fork `createA2UIMessageRenderer` 同一渲染管线，locate=滚动定位+闪烁高亮）、`A2uiRefCard.vue`（对话栏紧凑引用卡，点击/Enter 定位中央区）。App.vue 经 CopilotChat `#activity-a2ui-surface` 槽接管对话内渲染：宽屏引用卡 / 窄屏（<1024px，matchMedia）回退内联渲染 = 原单栏布局。有产物才出现工作区，否则对话栏占满。TDD 逐步：util 6 + RefCard 3 + Workspace 4 + App 集成 4（fork 渲染器打桩）；前端 **308/308 绿 + typecheck 绿**。已部署，**公网真实 run 实测 7/7 PASS**（render_a2ui 真看板 → 中央区渲染真实内容、对话栏 326px 窄列、引用卡定位高亮、900px 窄屏退化内联；证据 docs/evidence/2026-08-17-split-layout-e2e.txt，截图 docs/screenshots/split-layout-{wide,narrow}.png；脚本 scripts/test-split-layout-e2e.py）。已知：模型偶发不调 render_a2ui 需重跑（模型行为方差，非产品 bug）。
- [x] **会话导出真实化 —— A2UI 引用**（2026-08-17）：既有导出（P-A/P-M：MD/JSON Blob 下载、工具调用配对、耗时/状态/附件）的缺口 = A2UI 产物只剩 render_a2ui 原始 JSON 参数倾倒（activity surface 是运行期 A2UiBridge 合成的，不落 opencode 历史，导出路径拿不到 activity 消息）。修复纯前端 exportThread：`parseA2uiRef` 解析 render_a2ui/render_report 参数 JSON → MD 渲染「🎨 A2UI 看板 `surfaceId` · N 个组件（类型清单）· M 项数据绑定」小节（保留配对结果行；非法 JSON 回退普通工具行不炸），JSON 侧 NormalizedToolCall 新增 `a2uiRef{surfaceId,componentTypes,componentCount,dataKeys}`。TDD 5 新例（exportThread 23/23 绿）。e2e `scripts/test-export-a2ui-e2e.py`：真实 102 消息会话（8 处 A2UI 调用）走 UI 侧边栏导出 → **6/6 PASS**（MD 引用小节/无原始 JSON/结果配对、JSON 8 个 a2uiRef 字段完整），产物 docs/evidence/2026-08-17-thread-export-a2ui.{md,json} + 日志 2026-08-17-export-a2ui-e2e.txt。

- [x] **收尾3 代码-文档一致性 + 干净机器可重建**（2026-08-16，b09e551 + 本次）：一致性 —— 依据代码实读逐项核对修漂移 12 处（gateway 30 类/~5800 行、composables 全量、28 组件白名单、ThreadRepository 重构、.opencode 实部署、scripts/ 17 文件等，详见 b09e551）。可重建 —— DELIVERY-README「重建与运行」逐节在干净 clone（GitHub 直拉 /tmp/dataagent-clean，HEAD 4c1be21）实测跑通：build-opencode.sh 部署 .opencode（含 workspace-guard.ts）→ npm install+build（fork prebuild 含 FORK#23/24）→ mvn package → clone 构建 jar 起 :8091 health UP → **test-multi-turn 7/7 PASS**（与 README §5 声称一致），生产 :8090 全程未动。证据 docs/evidence/2026-08-16-clean-rebuild.txt。**收尾三件套（稳定性/流式卡顿/文档一致性+可重建）全部闭环**。

- [x] **多模态文件预览真实化 —— 图片/PDF/CSV 点击预览全链路**（2026-08-17，P32 续集，架构师指令）：P32 只做了文件面板图片直渲，本轮补全 PDF + 对话附件区。三步落地——**① PDF iframe 预览**：gateway 下载端点恒 `attachment` 且 guessContentType 不识 pdf，直挂 iframe src 会触发下载；纯前端解法 = fetch → `Blob({type:'application/pdf'})` → createObjectURL blob: URL 喂 iframe（filePreview.ts `fetchPdfPreviewUrl` + FilePreviewModal `pdfUrl` 分支 + FileTree PDF 点击接线，>5MB 走超限提示），扩展名白名单加 `.pdf`。**② 对话附件区点击预览**：`attachmentPreview.ts` 按 fork 稳定 testid 委托解析（img → lightbox / document chip → 按 isImage/isPdf/isPreviewable 分流），App.vue `.chat-col` 点击委托 + `ImageLightbox.vue`（Esc/overlay/× 三关、点图不关）+ welcome chip ready 态点击预览（xlsx → toast「暂不支持预览」）。**③ FORK#26 用户消息附件区渲染**：fork 上游 `CopilotChatUserMessage` 把多模态 parts 摊平成纯文本（附件完全不可见，`CopilotChatAttachmentRenderer` 导出无人用）；新增 `attachmentParts` computed 在 message-renderer 槽之上渲染附件条（历史消息无 source 的 document part 靠 filename 出 chip、无源 image 跳过）。**附带 bugfix 冷启动竞态**：`useThreads.init()` 异步窗口内 currentId=''，上传落 legacy 共享根且 threadId watch 抹掉 welcome chip —— `awaitThreadId`（watch 一次 + 10s 超时）闸门接入 useWorkspaceFiles.upload 与 welcomeAttachments.addFiles（公网 e2e 实锤复现后修复）。TDD 全程：filePreview +3 / Modal +5 / Tree PDF +2 / attachmentPreview 6 / Lightbox 4 / App 集成 5 / 竞态 3 / fork FORK#26 4 例。已部署（main-BPQDV3xq），**公网 e2e `scripts/test-multimodal-preview-e2e.py` 11/11 PASS**（真实 PNG/PDF/CSV 生成上传 → 欢迎页 3 chip 预览 → 主输入区队列 → 消息附件区渲染+3 种点击预览 → 文件面板 PDF iframe + P32 图片回归；证据 docs/evidence/2026-08-17-multimodal-preview-e2e.txt，截图 docs/screenshots/mm-{lightbox,msg-lightbox,msg-csv,panel-pdf}.png）。已知残余（记录在案未做）：FORK#25 结束瞬间一次性渲染阻塞 3.1~14.7s。

- [x] **收尾复核三件套（监工指令 2026-08-17，停新能力）**：**① 稳定性验证** —— 前置修复 972dfdb（fork#26 source 判别联合类型：vite 构建不查类型掩盖 vue-tsc 声明构建失败 → .d.mts/.d.cts 缺失炸 app typecheck）；其后前端 337/337 + typecheck 绿、gateway 217/217、真链路 multi-turn 7/7（证据 docs/evidence/2026-08-17-stability-regression.txt）。**② 长思考卡顿复核** —— 生产实测（部署含 FORK#23/24/25）：**原问题（流式期间秒级连续冻结，最差 9687ms）已解决**，delta 流式窗口探针 2~15ms；残余 = 边界一次性升格渲染（reasoning 收尾 0.5~2.5s 偶落探针窗口致官方脚本 4 跑 1 PASS / answer 收尾 mermaid+shiki 本轮 4.8s，即 FORK#25 在案残余类）。idle 再升格/mermaid 异步化属新能力，按监工指令不做，留架构师决策（证据 docs/evidence/2026-08-17-streaming-lag-recheck.txt）。**③ 干净 clone 可重建复核** —— 当前 HEAD 按 DELIVERY-README §0-§3 从零重建全通：GitHub clone（fork 重试 1 次）→ bun install → 扩展部署 → mvn package 217/217 → 前端 build（含 build:types .d.mts/.d.cts 产出，972dfdb 修复在干净环境验证）+ vitest 337/337 → 干净 opencode :4196 + gateway :8190 起服 → up.sh 幂等识别在跑三件套 → multi-turn 打 :8190 **7/7 PASS**；文档步骤无新漂移（证据 docs/evidence/2026-08-17-clean-rebuild-recheck.txt）。

## 下一步（修完 P0/P1 后）

剩余：
1. ~~gateway 重启上生产（4 commit 未部署）→ test-multi-turn 回归~~ ✅ 2026-08-16 已完成两轮（d992ab5 一轮 + ffe2e3c 一轮），multi-turn 7/7。
2. ~~spreadsheetEdits 真实链路复跑~~ ✅ 2026-08-16 PASS（modal → confirm → CSV 999999 落盘）。
3. ~~fork 既有失败（use-frontend-tool.e2e Agent Scoping 等）~~ ✅ 2026-08-16 清零（9→0，P28-A 根治最后 1 例，fork 1155/1155 全绿，见 P2-12）。
4. DeepSeek 伪 `<tool_call>` 文本输出习性：已确认双路径（native + 文本 marker）都会触发，bridge 均兜住；记录为模型行为基线（本条为观察记录，长期有效）。
5. ~~观察项：模型偶发拒用 frontend tool 改用原生 edit 绕过 HITL 直改 CSV~~ ✅ P27 已加固（2026-08-16）：提示词层 client_tools 段落 + 工具描述双重显式禁止；gateway 对原生 edit/write/multiedit 直改 CSV/TSV/XLS 追加警告回执（观测模式不阻断，log.warn 可检索）。长期效果待线上观测。
6. 已知测试噪音（非产品问题）：App.test.ts 末尾 1 个 unhandled rejection（@ag-ui/client getReader 对打桩 Response 的 SSE 模拟缺口），套件全绿不受影响。

## 收尾3：代码文档一致性 + 干净机器可重建（2026-08-16）

- [x] 全仓 docs/*.md × 代码漂移扫描（2 探查代理 + 主线复核），修 14 处：ARCHITECTURE/VERSIONS 加时效横幅（/opencode/ag-ui、agents__unsafe_dev_only 为历史计划）；design.md API 一览补全 17 端点 + catalog/白名单数字对齐（10/28）；CAPABILITIES_DEFINITION 补 workspace-guard.ts；agents/README 目录树 + fork 3 定制提交；copilotkit-capabilities window.confirm→ConfirmDialog；CURRENT_ARCHITECTURE 30 类 ~5800 行 + composables 补全；DEVELOPMENT_STATUS P1#5 误述更正；STATUS dist/ 标注；ACCEPTANCE_TESTS 基线 237→291；MASTER-PROMPT React 措辞；perf/concurrent-threads ChatThreadStore→ThreadRepository（b09e551/6d912a1/f414725）
- [x] 代码修复 2 处：up.sh fork 路径参数化 OPENCODE_FORK_DIR（6be13ba，干净机器重建阻塞项）；build-opencode.sh 收尾提示去掉不存在的 opencode2 命令（1f3871b）
- [x] 干净机器重建实测（/tmp/dataagent-clean-test，按修正后 DELIVERY-README）：mvn package ✓ / 前端 npm install+build ✓ / vitest 291/291 ✓ / 干净 gateway :8190 health UP ✓ / 8090 health UP ✓ / up.sh 幂等 ✓ / test-multi-turn 打干净 gateway **7/7 真链路**（DeepSeek 真实应答、暗号跨轮记忆）。证据 docs/evidence/2026-08-16-clean-rebuild.txt（含两处环境偏差如实记录：GitHub 大传输当日限速 → fork 源码改本机镜像 archive 同源导出；端口 4196/8190 避让共享实例）
