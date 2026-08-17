# Internal fork: @copilotkit/vue 1.67.1 + `directAgents`

**Base**: upstream `CopilotKit/CopilotKit` tag `v1.67.1`
(git tag object `9228710232c47f0795e6da9e2d3c6df126be26cf`), `packages/vue` only.
Upstream license (MIT, Copyright (c) Atai Barkai) is preserved in `LICENSE`.

## Why this fork exists

Project red lines forbid a Node.js CopilotKit Runtime, `runtimeUrl`, Copilot
Cloud, and business code touching `agents__unsafe_dev_only` or the
Enterprise-marked `selfManagedAgents`. The Vue app must register a local
`HttpAgent` (pointing at the Java Spring Boot backend) under a supported prop.

## Complete diff vs upstream v1.67.1

1. `src/v2/providers/CopilotKitProvider.types.ts`
   - `CopilotKitProviderProps` gains `directAgents?: Record<string, AbstractAgent>`.
2. `src/v2/providers/CopilotKitProvider.vue`
   - `withDefaults` gains `directAgents: () => ({})`.
   - `mergedAgents` now delegates to `mergeAgents(...)`, i.e.
     `{ ...agents__unsafe_dev_only, ...selfManagedAgents, ...directAgents }`.
   - added `import { mergeAgents } from "./mergeAgents"`.
3. `src/v2/providers/mergeAgents.ts` (new) — pure merge helper.
4. `src/v2/providers/__tests__/CopilotKitProvider.directAgents.test.ts` (new).
5. `src/v2/index.ts` — explicit re-export of `createVueComponent` /
   `createBinderlessVueComponent` from `./components/a2ui/adapter` (upstream
   never surfaces them: the `./a2ui` barrel resolves to `a2ui.ts`, shadowing
   the `a2ui/` directory). Needed so the app can register whitelisted custom
   A2UI catalog components (TASK §15).
6. `src/v2/hooks/use-agent.ts` — `resolveAgent` unwraps the core-registry
   agent with `toRaw()` before per-thread cloning. Without it, the registry's
   Vue-reactive wrapper makes `AbstractAgent.clone()`'s `structuredClone(this.
   messages)` throw `DataCloneError`, breaking any `threadId`-scoped
   CopilotChat (direct-agent multi-session setups).
7. `src/v2/hooks/index.ts` — re-export `getThreadClone` so direct-agent apps
   can write loaded history into the per-thread clone that CopilotChat renders.
8. `src/v2/components/chat/CopilotChatView.vue` — welcome-screen gating drops
   the `!hasExplicitThreadId` condition. In direct-agent setups an explicit
   threadId with zero messages is a fresh chat and must show the welcome
   screen (upstream assumes explicit threadId implies a runtime /connect
   history replay).
9. Packaging only (not shipped to npm): `package.json` name stays
   `@copilotkit/vue`, version `1.67.1-fork.1`, `workspace:*` deps rewritten to
   pinned published versions, devDeps trimmed; `tsconfig.json` inlined
   (`@copilotkit/typescript-config` removed).
10. `src/v2/hooks/use-default-render-tool.ts` (F3, mainline) — default
    tool-call renderer gains duration tracking, status icons (spinner/✓/✗)
    and failure/interrupt marking via agent run-lifecycle subscription.
    UI-only; no protocol change.
11. `src/v2/components/chat/CopilotChatInput.vue` (P-F, mainline) —
    `maxRows` default 5 → 3 (marked `FORK-PATCH(P-F)` inline), matching the
    product input spec (auto-grow, scroll past 3 rows). Enter-to-send /
    Shift+Enter-newline / IME guard are upstream behavior, unchanged.

12. `src/v2/components/chat/CopilotChatMessageView.vue` +
    `CopilotChatAssistantMessage.vue` (P-S, mainline) — message-level actions:
    regenerate wired (last assistant message only, truncates that answer and
    re-runs via `core.runAgent`); per-message time captions (history
    `createdAt` ?? first-seen); assistant toolbar becomes hover-only
    (`group`/`group-hover`, matching user message); regenerate button gains
    `data-testid="copilot-regenerate-button"`. Copy buttons were already
    upstream default UI on both sides.
13. `src/v2/hooks/use-default-render-tool.ts` (F3 补全, mainline) —
    tool-level failure detection: a `complete` call whose result starts with
    the gateway `session.tool.failed` contract prefix `"工具执行失败: "`
    (AguiEventTranslator) now renders the failed state (✗失败 / red dot /
    `data-run-end=failed`) instead of a misleading ✓Done. Prefix is matched
    at line start only. Covered by 2 new cases in
    `use-default-render-tool.test.ts`.

14. `src/v2/components/chat/CopilotChatAssistantMessage.vue` (touch-safe,
    mainline) — upstream image download button is hover-revealed via
    `opacity-0` only; on touch devices (no hover) the invisible button
    intercepted taps (same bug class as app-side ThreadSidebar/FilesPanel,
    verified via playwright elementFromPoint). Added `pointer-events-none` +
    `group-hover:pointer-events-auto` (marked `FORK-PATCH(touch-safe)`).
    Covered by a class-guard case in `CopilotChatAssistantMessage.test.ts`.

15. `src/v2/hooks/use-agent.ts` — `getThreadClone` unwraps the registry agent
    with `toRaw()` before the `globalThreadCloneMap` WeakMap lookup. Entry 6
    made `resolveAgent` key the map by the raw instance, so callers passing
    `core.getAgent(id)`'s reactive proxy back into `getThreadClone` always
    missed (returned `undefined`). `toRaw` is a no-op on raw instances.

16. `src/v2/components/a2ui/{catalog.ts, utils.ts, VueSurface.ts}` + new
    `__tests__/` (5 files, 29 cases) (2026-08-16, vision line) — A2UI Vue
    catalog visual polish & missing-state fill: utils.ts gains design tokens
    (A2UI_PALETTE/A2UI_PRIMARY*/A2UI_FOCUS_RING), shared form style helpers
    (getA2uiInputStyle/getA2uiLabelStyle/getA2uiErrorTextStyle/
    getWarningChipStyle) and ensureA2uiCatalogStyles (idempotent one-shot
    static keyframes injection). All 18 basic-catalog components polished:
    Text type ramp, Card/Button/Tabs/Modal/form controls/Image hover/pressed/
    disabled/focus/error/empty states + aria; Modal ESC-to-close. VueSurface:
    unknown-component/cycle placeholders unified into warning chip (replacing
    bare red text); shimmer keyframes moved out of innerHTML (no innerHTML
    use remains on the render path).

17. `src/v2/components/chat/CopilotChatMessageView.vue` — the P11 `v-memo`
    signature now includes `stateTick`. Mid-run STATE_SNAPSHOT/STATE_DELTA
    events change neither message content, `isRunning`, nor `messages.length`,
    so the memoized per-message block was skipped and `renderCustomMessages`
    renderers kept a stale `stateSnapshot` prop (baseline e2e failure
    "re-renders custom message when state updates within the same run").
    `stateTick` is the component's existing agent state/run-lifecycle
    counter; adding it re-renders message blocks exactly when run state
    advances. Perf impact: state/lifecycle changes re-render all memoized
    blocks (same as upstream-without-memo); streaming deltas stay memoized
    per message via the content/tool signature.

18. `src/v2/components/a2ui.ts` + `A2UIMessageRenderer.ts` +
    `A2UISurfaceActivityRenderer.vue` (2026-08-16, 协议边界降级) — new
    `sanitizeA2uiOperations()` boundary helper: malformed `a2ui_operations`
    entries (null/string/number/array) are dropped with console.warn instead
    of throwing in `getOperationSurfaceId` during grouping (one bad entry
    previously killed the whole batch AND the render pass); a string payload
    is parsed tolerantly as JSONL (bad lines skipped, good lines rendered).
    `A2UIMessageRenderer` renders a payload-error warning chip
    (`data-testid="a2ui-payload-error"`, same warning-chip family as the
    unknown-component/cycle placeholders) when a payload is present but
    yields zero usable ops — replacing the previous infinite
    "Generating UI..." skeleton. Absent/empty payload still means loading.
    `A2UISurfaceActivityRenderer` sanitizes defensively in both
    `processOperations` and the `surfaceEntries` render path. Covered by
    `__tests__/A2UIBoundaryPayloads.test.ts` (10 cases incl. 300KB props).

19. `src/v2/components/chat/CopilotChatAssistantMessage.vue` +
    `CopilotChatReasoningMessage.vue` (P28-A, mainline) — `StreamMarkdown`
    (streamdown-vue) 静态 import 改为 `defineAsyncComponent` 动态加载。
    streamdown 静态链会把 shiki+mermaid 拖进入口 chunk（实测主入口初始
    JS gzip 481KB，占 500KB 预算 96%）；改异步后首条 markdown 消息到达
    时才加载，初始 JS 降出红线。行为差异仅首条消息 markdown 晚一个
    microtask+网络往返渲染；三个同步断言的 fork 测试相应改 waitFor。
    预算断言脚本：vue-frontend/scripts/check-bundle-budget.mjs。

20. `src/v2/components/a2ui.ts` (2026-08-16, 协议边界第二批) —
    `sanitizeA2uiOperations()` 消毒管线追加三段（第一批见条目 18）：
    超大 payload 截断（单条 string >1MB 截断留 `…[truncated]` marker，
    整条 op 序列化 >4MB 整条丢弃，上限可经 opts 注入）；重复 op 去重
    （断连重放/快照重叠重复送达时，逐字节相同的 op 与同 surfaceId 的
    重复 createSurface 只留第一条 —— web_core 对重复 createSurface
    直接 throw "already exists"）；out-of-order 归一化（createSurface
    稳定提前、deleteSurface 押后，乱序到达的 updateComponents/
    updateDataModel 不再被逐 op 容错永久丢弃）。Covered by
    `__tests__/A2UIBoundaryBatch2.test.ts` (10 cases，含 2MB 截断渲染)。

21. `src/v2/components/a2ui/{catalog.ts,utils.ts}` (2026-08-16, P28-B,
    architect-dispatched) — Button 禁用态弃用 `opacity: 0.5`（半透明在
    primary 白字蓝底上对比度塌陷，过不了 WCAG AA），改为任何 variant
    禁用后统一实心 muted 配色：新调色板 token `surfaceDisabled #e5e7eb`
    + `textDisabled #4b5563`（实测 6.1:1）。cursor/disabled 属性/灭
    hover 语义不变。Covered by `__tests__/catalogCardButton.test.ts`
    （含 WCAG 对比度公式断言 ≥4.5:1）。

22. `src/v2/components/a2ui.ts` (2026-08-16, 协议边界第三批) —
    第二批的全局 rank 排序（create 一律提前 / delete 一律押后）被
    [create, delete, create] 复活序列实锤双重出错：吞掉复活 create、
    把 delete 挪到复活点之后（终态 = 面被删、内容全丢）。归一化改为
    **per-surface 分段**：deleteSurface 是段屏障，任何重排/去重不得
    越过；段内才做字节级去重（key 取自截断后的 op）并把 createSurface
    提到段首（同段重复 create 仍去重 + warn）。管线顺序固定为：解析
    （数组/JSONL 容错）→ 整条 op 4MB 闸口 → string 1MB 截断 → 分段
    归一化。Batch2 纯函数用例期望同步修订（队首 delete 保持原位）。
    Covered by `__tests__/A2UIBoundaryBatch3.test.ts` (11 cases：
    截断后 dedupe key 稳定性 / 复活屏障 / 27 行 JSONL 混合流 /
    30 op 多 surface 总集成，含 21 op 三轮复活渲染级回归）。
23. `src/v2/lib/use-throttled-content.ts` (new, 2026-08-16, 收尾2 流式渲染
    限频) — 长 reasoning/assistant 流式期间，每个 SSE delta 直喂
    StreamMarkdown 会全量 re-parse（含 shiki），内容越长越贵 → 长思考卡顿。
    本 composable 提供限频跟随 ref：流式中 leading 立即 + 窗口内合并 +
    trailing 补最新（默认 120ms 一次），active=false 立即对齐最终值/直通，
    stop()/卸载后不再写值。供 chat 组件喂给 StreamMarkdown 的 content 使用。
    Covered by `src/v2/lib/__tests__/use-throttled-content.test.ts` (5 cases)。
    接线：`CopilotChatReasoningMessage.vue` + `CopilotChatAssistantMessage.vue`
    的 StreamMarkdown content 改用限频副本（slot 契约仍拿实时内容）。
    Covered by `__tests__/CopilotChatReasoningMessage.throttle.test.ts` /
    `CopilotChatAssistantMessage.throttle.test.ts`（mock streamdown 计数：
    200 delta 从 196/201 次全量 re-parse 降到 ≤12 次，结束立即对齐）。
24. `src/v2/lib/activity-parse-cache.ts` (new, 2026-08-16, 收尾2) —
    `safeParseActivityContent`：activity 消息内容的 zod 校验按
    (message, content引用) WeakMap 记忆化。CDP profiler 实锤：流式期间
    热点 = zod `_parse`/`_parseSync`（消息列表每个 delta 重渲 → 每条
    activity 消息全量 safeParse 大 discriminated union）+ GC 抖动 →
    秒级主线程冻结。content 引用变（ACTIVITY_SNAPSHOT 更新）即重 parse。
    接线：`CopilotChatMessageView.vue` resolveActivityRenderer 与
    `hooks/use-render-activity-message.ts` 两处 safeParse call site。
    Covered by `src/v2/lib/__tests__/activity-parse-cache.test.ts` (3 cases)。
25. `src/v2/components/chat/plain-code-block.ts` (new) + 两处 chat 组件接线
    (2026-08-16, 收尾2 收口) — 流式期间 codeblock 降级 plain highlight：
    归因实锤流式期每次 markdown 重渲都触发默认 CodeBlock 的 shiki 高亮
    （分配风暴）。利用 streamdown-vue components map 的 `codeblock` 覆盖键
    （dist: `const N = l.codeblock || se`），isStreaming 时喂 PlainCodeBlock
    （纯 pre>code，零高亮），结束回默认 shiki CodeBlock（一次性高亮 +
    复制/下载按钮，assistant 侧与既有 img/table 覆盖合并）。
    Covered by `__tests__/plain-code-block.test.ts` (2 cases) + 两个
    throttle 测试新增 components prop 断言（流式有 codeblock、结束无）。
    补充（同日 mermaid 残留热点）：部署后实测仍有内容相关的 ~3.2s 探针
    冻结，抓内容实锤 = DeepSeek 分析类回答带 ```mermaid 围栏，而
    streamdown-vue 的 mermaid 分支（`if (v === "mermaid") return m(rt,...)`）
    先于 codeblock 覆盖键 —— 流式期每个限频 tick 对半截 mermaid 源码重跑
    parse+layout。新增 `src/v2/lib/degrade-mermaid.ts`：流式渲染副本把
    ```mermaid 围栏改名 ```text（未闭合半截围栏同样降级；无 mermaid 走
    同引用快路径），结束用原始内容一次性真渲染。两处 chat 组件的
    StreamMarkdown content 改喂 streamdownContent（限频+mermaid 降级合成）。
    Covered by `__tests__/degrade-mermaid.test.ts` (4 cases) + 两个 throttle
    测试各新增 mermaid 断言（流式收到 ```text、结束回 ```mermaid）。
26. `src/v2/components/chat/CopilotChatUserMessage.vue`
    (2026-08-17, 多模态文件预览) — 用户消息附件区接线：上游把多模态
    content parts 摊平成纯文本（`flattenUserMessageContent` 只取 text
    part），已发送消息的附件完全不可见（`CopilotChatAttachmentRenderer`
    导出但无人使用）。新增 `attachmentParts` computed：非文本 parts
    （image/audio/video/document）→ 在默认 message-renderer 槽之上渲染
    附件条（容器 `data-testid="copilot-user-message-attachments"`，复用
    AttachmentRenderer）。历史消息里 gateway 还原的 document part 可能
    没有 source —— chip 只靠 metadata.filename 也渲染（App 侧点击委托
    按文件名解析会话下载链做预览）；无可用 URL 的 image/audio/video
    part 跳过（不出 broken img）。附件区放在 message-renderer 槽之外，
    覆盖槽不丢附件。
    Covered by `__tests__/CopilotChatUserMessage.test.ts` 新增
    "FORK#26 用户消息附件区渲染" describe（4 cases）。
27. `src/v2/lib/use-idle-upgrade.ts` (new) + 两处 chat 组件接线
    (2026-08-17, FORK#25 残余收口, architect-dispatched) — 流式结束的一次性
    "升格渲染"（shiki 高亮 + mermaid 真渲染）延迟到主线程空闲：FORK#25 把
    流式期降级做掉后，残余阻塞 = `isStreaming` 翻 false 的同一 commit 里
    StreamMarkdown 同步全量 re-parse + shiki + mermaid layout（实测 reasoning
    收尾 0.5~2.5s / answer 收尾 4.8s，证据
    docs/evidence/2026-08-17-streaming-lag-recheck.txt）。`useIdleUpgrade`
    返回 `upgradeReady`：流式中恒 false；active 翻 false 时挂
    `requestIdleCallback`（带 timeout 2000ms 兜底；无 rIC 的 Safari/jsdom 走
    setTimeout(50) 降级），idle 回调才置 true；重新进入流式复位并取消
    pending；卸载/stop 后迟到回调（rIC timeout 竞态）不再写值；挂载即
    非流式（历史回放）立即 true 保持现行行为。接线：两处组件渲染态改判
    `renderDegraded = isStreaming || !upgradeReady`，喂 codeblock 降级 map
    与 mermaid 降级副本的判定从 isStreaming 换成 renderDegraded ——
    RUN_FINISHED 后 loading 立即解除、全文以降级形态（plain code + mermaid
    源码文本）立即可读，真渲染升格 idle 静默进行。
    Covered by `src/v2/lib/__tests__/use-idle-upgrade.test.ts`（8 cases：
    rIC 打桩路径 + setTimeout 降级路径 + 卸载取消 + 复位 + 历史回放直通）；
    两个 throttle 测试各新增"翻 false 同一 tick 仍降级、idle flush 后升格"
    断言。
28. `src/v2/components/chat/CopilotChatView.vue` 三处 + `CopilotChatInput.vue`
    两处内容容器 `cpk:max-w-3xl` → `cpk:max-w-5xl`（2026-08-17, bug 修复,
    architect-dispatched）— 欢迎页（CopilotChatView L504）、消息列表
    （copilot-scroll-content 内层, L603）、输入区附件队列
    （copilot-input-overlay 内层, L702）、输入框本体容器
    （copilot-chat-input-container 内层, CopilotChatInput L969）、输入区
    disclaimer（L1268）原先钉死 48rem，宽屏下对话列大片留白。放宽到 64rem
    （可读性上限保留），五处同步放宽保持消息列与输入列对齐；窄列/分栏模式
    由外层列宽约束不受影响。配套 App 侧 `.chat-card` max-width 56rem → 72rem。
    Covered by `__tests__/CopilotChatView.width.test.ts`（5 cases：五处容器
    类名断言 + 不再含 max-w-3xl 回归闸）。

(A2UI surface renderer/catalog extensions under `src/v2/components/a2ui/` are
maintained by the vision line — see their own notes.)

Because `hasLocalAgents` derives from `mergedAgents`, a provider with only
`directAgents` (no `runtimeUrl`, no publicApiKey) does not trigger the
missing-config error.

## Upgrade procedure

1. Sparse-checkout the new upstream tag's `packages/vue` over `src/`
   (discard local changes).
2. Re-apply the numbered changes above (or `git diff` this dir against the
   tag and re-apply the patch).
3. Bump dependency pins to the versions published with that tag.
4. `npm install && npm run build && npm test -- directAgents`.

## Build / test

```bash
npm install
npm run build     # vite build + tailwind css + vue-tsc types
npm test -- directAgents
```
