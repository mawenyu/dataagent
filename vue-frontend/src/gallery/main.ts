/**
 * vision-P2: A2UI 组件画廊入口（截图留证专用页，不进主导航）。
 * /agui/a2ui-gallery.html?batch=layout|form|media|charts|content
 * 用与聊天区完全相同的渲染链路（A2UISurfaceActivityRenderer + dataAgentCatalog）
 * 渲染固定 surface —— 截图所见即 agent render_a2ui 产出所渲染。
 */
import { createApp, h, nextTick } from 'vue'
import { CopilotKitProvider, A2UISurfaceActivityRenderer, CopilotChatMessageView } from '@copilotkit/vue'
import { dataAgentCatalog } from '../a2ui/dataAgentCatalog'
import { GALLERY_BATCHES } from './surfaces'
import RunErrorCard from '../components/RunErrorCard.vue'
import '@copilotkit/vue/styles.css'

const params = new URLSearchParams(location.search)
const batchKey = params.get('batch') ?? 'layout'
const batch = GALLERY_BATCHES[batchKey] ?? GALLERY_BATCHES.layout

// P11: 长会话性能实测页 ?batch=longchat&n=500 —— 真实浏览器渲染
// CopilotChatMessageView + N 条混合消息（含工具卡），首屏耗时上屏
const isLongChat = batchKey === 'longchat'
const longChatN = Number(params.get('n') ?? 500)
function makeLongChatMessages(n: number) {
  const out: any[] = []
  for (let i = 0; i < n; i++) {
    if (i % 5 === 4) {
      out.push({
        id: `a${i}`, role: 'assistant', content: `分析结论 ${i}：华北区领跑。`,
        toolCalls: [{ id: `call_${i}`, type: 'function', function: { name: 'shell', arguments: `{"command":"awk 统计 ${i}"}` } }],
      })
      out.push({ id: `t${i}`, role: 'tool', toolCallId: `call_${i}`, content: `file-${i}.csv 统计完成` })
    } else {
      out.push({
        id: `m${i}`, role: i % 2 === 0 ? 'user' : 'assistant',
        content: `第 ${i} 条消息内容，包含一段正常长度的中文文本用于模拟真实会话消息体积。`,
      })
    }
  }
  return out
}
const longChatMessages = isLongChat ? makeLongChatMessages(longChatN) : []

// P19: ?opsUrl=<url> —— 加载真实 agent run 捕获的 surface ops（ACTIVITY_SNAPSHOT
// content.a2ui_operations 数组 JSON），用真实渲染链回放留证
const opsUrl = params.get('opsUrl')

async function boot() {
const t0 = performance.now()
  // opsUrl 模式：先拉取再挂载（包装成 async 避免顶层 await 目标限制）
  const batchOps = opsUrl
    ? await Promise.resolve(null).then(async () => {
        const res = await fetch(opsUrl)
        return await res.json()
      }).catch(() => null)
    : null
  if (batchOps) {
    batch.operations = batchOps
    batch.label = `真实 run 回放（${opsUrl!.split('/').pop()}）`
    batch.components = [...new Set(batchOps.flatMap((o: any) =>
      (o.updateComponents?.components ?? []).map((c: any) => c.component)))]
  }
  const app = createApp({
    render() {
      if (batchKey === 'uistates') {
      // P23: 错误恢复 UI 取证页 —— 真实 RunErrorCard 组件 + 与 App.vue 同款
      // 离线徽章/恢复 toast（样式镜像，注释见下）
      return h('div', { style: { maxWidth: '820px', margin: '0 auto', padding: '16px', background: '#f8fafc', minHeight: '100vh' } }, [
        h('p', { style: { fontSize: '12px', color: '#6b7280', margin: '0 0 12px' } },
          '错误恢复 UI 取证（P-B/P-I）· RunErrorCard 为生产组件直挂；徽章/toast 与 App.vue 同款样式镜像'),
        // 顶栏镜像 + 离线徽章（样式与 App.vue .badge/.offline-badge 一致）
        h('div', { style: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' } }, [
          h('strong', { style: { fontSize: '14px', color: '#111827', flex: 1 } }, 'DataAgent 顶栏（镜像）'),
          h('span', {
            class: 'badge offline-badge',
            title: '网络连接已断开,恢复后自动续跑中断的运行',
            style: {
              fontSize: '12px', padding: '4px 12px', borderRadius: '999px', whiteSpace: 'nowrap',
              color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a',
              animation: 'offline-pulse 1.6s ease-in-out infinite',
            },
          }, '● 离线'),
        ]),
        h('p', { style: { fontSize: '12px', color: '#6b7280', margin: '0 0 6px' } }, '① 运行中断错误卡（含结构化错误码徽章 + 重试按钮）'),
        h(RunErrorCard as any, {
          message: '网关 502 Bad Gateway —— 可点重试，将重发最后一条消息',
          code: '502',
          onRetry: () => {}, onDismiss: () => {},
        }),
        h('div', { style: { height: '12px' } }),
        h('p', { style: { fontSize: '12px', color: '#6b7280', margin: '0 0 6px' } }, '② 重试中（busy 态，按钮禁用）'),
        h(RunErrorCard as any, {
          message: '运行超时（120s 无响应）', code: 'RUN_TIMEOUT', busy: true,
          onRetry: () => {}, onDismiss: () => {},
        }),
        h('div', { style: { height: '12px' } }),
        h('p', { style: { fontSize: '12px', color: '#6b7280', margin: '0 0 6px' } }, '③ 网络恢复 → 自动续跑 toast（App.vue toast 样式镜像）'),
        h('div', { style: {
          width: '320px', background: '#fff', border: '1px solid #e5e7eb', borderLeft: '4px solid #6366f1',
          borderRadius: '10px', boxShadow: '0 4px 16px rgba(15,23,42,0.12)', padding: '12px 14px',
        } }, [
          h('strong', { style: { display: 'block', fontSize: '13px', color: '#111827', marginBottom: '2px' } }, '网络已恢复'),
          h('p', { style: { margin: 0, fontSize: '12.5px', color: '#4b5563', lineHeight: 1.45 } }, '正在自动重试中断的运行…'),
        ]),
      ])
    }
    if (isLongChat) {
        return h(CopilotKitProvider, { runtimeUrl: '/unused' }, () =>
          h('div', { style: { maxWidth: '760px', margin: '0 auto', padding: '16px', background: '#f8fafc' } }, [
            h(CopilotChatMessageView as any, { messages: longChatMessages, isRunning: false }),
          ]),
        )
      }
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
    el.textContent = `真实浏览器首屏渲染耗时: ${ms}ms（batch=${batchKey}，组件数=${isLongChat ? longChatN + ' 条消息' : (batch.operations[1]?.updateComponents?.components?.length ?? '-')}）`
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
  
}
void boot()
