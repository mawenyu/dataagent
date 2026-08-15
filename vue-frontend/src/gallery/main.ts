/**
 * vision-P2: A2UI 组件画廊入口（截图留证专用页，不进主导航）。
 * /agui/a2ui-gallery.html?batch=layout|form|media|charts|content
 * 用与聊天区完全相同的渲染链路（A2UISurfaceActivityRenderer + dataAgentCatalog）
 * 渲染固定 surface —— 截图所见即 agent render_a2ui 产出所渲染。
 */
import { createApp, h, nextTick } from 'vue'
import { CopilotKitProvider, A2UISurfaceActivityRenderer } from '@copilotkit/vue'
import { dataAgentCatalog } from '../a2ui/dataAgentCatalog'
import { GALLERY_BATCHES } from './surfaces'
import '@copilotkit/vue/styles.css'

const params = new URLSearchParams(location.search)
const batchKey = params.get('batch') ?? 'layout'
const batch = GALLERY_BATCHES[batchKey] ?? GALLERY_BATCHES.layout

const t0 = performance.now()
const app = createApp({
  render() {
    return h(CopilotKitProvider, { a2ui: { catalog: dataAgentCatalog, includeSchema: false } }, () =>
      h('div', { style: { maxWidth: '760px', margin: '0 auto', padding: '16px', background: '#f8fafc', minHeight: '100vh' } }, [
        h('p', { style: { fontSize: '12px', color: '#6b7280', margin: '0 0 8px' } },
          `A2UI 画廊 · ${batch.label} · batch=${batchKey} · 组件: ${batch.components.join(' / ')}`),
        h(A2UISurfaceActivityRenderer as any, {
          activityType: 'a2ui-surface',
          content: { operations: batch.operations },
          message: { id: `gallery-${batchKey}`, role: 'activity', activityType: 'a2ui-surface', content: {} },
          catalog: dataAgentCatalog,
        }),
      ]),
    )
  },
})
app.mount('#app')

// vision-P5-2: 真实浏览器渲染耗时上屏（截图留证用）
nextTick(() => nextTick(() => {
  const ms = (performance.now() - t0).toFixed(1)
  const el = document.createElement('p')
  el.id = 'perf-timing'
  el.style.cssText = 'font-size:12px;color:#047857;margin:8px 16px;font-weight:600'
  el.textContent = `真实浏览器首屏渲染耗时: ${ms}ms（batch=${batchKey}，组件数=${batch.operations[1]?.updateComponents?.components?.length ?? '-'}）`
  document.body.firstChild ? document.body.insertBefore(el, document.body.firstChild) : document.body.appendChild(el)
}))

// 截图留证钩子：?autoclick=1 自动点击第一个 ActionButton，
// 截图可看到点击后的 disabled/loading 态（HITL 按钮可点性证据，2026-08-15）
if (params.get('autoclick') === '1') {
  setTimeout(() => {
    const btn = document.querySelector('.a2ui-surface button') as HTMLButtonElement | null
    btn?.click()
  }, 800)
}
