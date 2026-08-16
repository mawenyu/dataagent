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
