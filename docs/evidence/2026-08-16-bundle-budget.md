# P28-A Bundle 预算与懒加载证据（2026-08-16）

## 结论

| 入口 | 优化前初始 JS gzip | 优化后初始 JS gzip | 预算 |
|---|---|---|---|
| index.html（主聊天） | 481.4KB（预算 96%） | **287.3KB** | <500KB ✅ |
| a2ui-gallery.html | 429.9KB | **235.8KB** | <500KB ✅ |

口径：vite `--manifest` 产物里每个 entry 的静态 imports 递归闭包逐文件
gzipSync 求和（dynamic import 不计入）。断言脚本：
`vue-frontend/scripts/check-bundle-budget.mjs`，npm 脚本 `npm run budget`，
任一入口超预算 exit 1（CI 可挂即报红）。

## 根因

`streamdown-vue` 被 fork 的 `CopilotChatAssistantMessage.vue` /
`CopilotChatReasoningMessage.vue` **静态** import，把 shiki（全部语言包）
+ mermaid 拖进入口共享 chunk（该 chunk 优化前 ~1.5MB 原始）。markdown 渲染
只有首条 assistant/reasoning 消息到达才需要，属典型可懒加载重依赖。

## 处置（FORK#19）

两处静态 import 改为 `defineAsyncComponent(() => import('streamdown-vue'))`。
首条 markdown 消息到达时才加载 shiki/mermaid；初始 JS 降出红线。
行为差异：首条消息 markdown 晚一个动态 import 往返渲染——fork 三个同步
断言测试改 `waitFor`，app 侧 `chatHistoryRender.test.ts` 加 `waitForText`
轮询助手（vue-frontend 无 @testing-library/vue）。

## 复跑方式

```bash
cd vue-frontend && npm run budget
```

## 顺手修复（同 commit）

- `formChecks.test.ts` 红框断言字面量 'red' → 调色板 danger 色
  `rgb(220, 38, 38)`/#dc2626 兼容（vision 线 9ef7905 表单控件统一输入风格
  把错误边框改为 A2UI_PALETTE.danger 后该断言即红，与本次懒加载无关，
  属既有红线一并清零）。
