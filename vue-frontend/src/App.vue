<script setup lang="ts">
import { ref } from 'vue'
import { z } from 'zod'
import { CopilotKitProvider, CopilotChat } from '@copilotkit/vue'
import { dataAgent } from './agents/dataAgent'
import { dataAgentCatalog } from './a2ui/dataAgentCatalog'
import { useContextUsage } from './composables/useContextUsage'
import DefaultToolRender from './components/DefaultToolRender.vue'

// Registered via the fork's `directAgents` prop (see packages/copilotkit-vue/FORK.md).
// Business code never touches agents__unsafe_dev_only / selfManagedAgents.
const agents = {
  default: dataAgent,
}

// 需求7-5: context 用量徽章（gateway 在每个 step 结束发 CUSTOM context_usage）
const { contextSize, label: contextLabel } = useContextUsage(dataAgent)

// ---- Frontend tool: showNotification (executed in the browser) ----
type NotificationType = 'info' | 'success' | 'warning' | 'error'
interface Toast { id: number; title: string; message: string; type: NotificationType }
const toasts = ref<Toast[]>([])
let toastSeq = 0
function pushToast(t: Omit<Toast, 'id'>) {
  const id = ++toastSeq
  toasts.value.push({ id, ...t })
  window.setTimeout(() => {
    toasts.value = toasts.value.filter((x) => x.id !== id)
  }, 6000)
}

const frontendTools = [
  {
    name: 'showNotification',
    description:
      "Show a notification toast in the user's web UI. Use this when the user asks to be notified or when you want to surface a short alert.",
    parameters: z.object({
      title: z.string().describe('Short notification title'),
      message: z.string().describe('Notification body text'),
      type: z.enum(['info', 'success', 'warning', 'error']).optional()
        .describe('Visual severity of the notification'),
    }),
    handler: async (args: { title: string; message: string; type?: NotificationType }) => {
      pushToast({ title: args.title, message: args.message, type: args.type ?? 'info' })
      return `Notification displayed to the user (title="${args.title}").`
    },
  },
]

// 需求7-6: run 超时/失败时给用户明确提示（而不是无声卡死），告知可重试
function handleChatError({ error }: { error: Error }) {
  pushToast({
    title: '运行中断',
    message: `${error?.message ?? '未知错误'} —— 可重新发送消息重试`,
    type: 'error',
  })
}
</script>

<template>
  <div class="page">
    <header class="topbar">
      <div class="brand">
        <div class="logo" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="4" y1="20" x2="4" y2="12" />
            <line x1="10" y1="20" x2="10" y2="6" />
            <line x1="16" y1="20" x2="16" y2="14" />
            <line x1="22" y1="20" x2="22" y2="9" />
          </svg>
        </div>
        <div class="brand-text">
          <h1>DataAgent</h1>
          <span class="subtitle">AG-UI Data Assistant</span>
        </div>
      </div>
      <div class="topbar-right">
        <span
          v-if="contextSize > 0"
          class="badge context-badge"
          :title="`当前会话上下文占用 ${contextSize} tokens`"
        >{{ contextLabel }}</span>
        <span class="badge">Vue + CopilotKit · No Node Runtime · DeepSeek via OpenCode</span>
      </div>
    </header>
    <main class="chat-wrap">
      <div class="chat-card">
        <CopilotKitProvider
          :direct-agents="agents"
          :frontend-tools="frontendTools"
          :a2ui="{ catalog: dataAgentCatalog, includeSchema: true }"
        >
          <DefaultToolRender />
          <CopilotChat agent-id="default" class="chat" :on-error="handleChatError" />
        </CopilotKitProvider>
      </div>
    </main>
    <!-- toast stack for the showNotification frontend tool -->
    <div class="toast-stack" aria-live="polite">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="`toast-${t.type}`">
        <strong>{{ t.title }}</strong>
        <p>{{ t.message }}</p>
      </div>
    </div>
  </div>
</template>

<style>
/* ---- Design tokens: Apple-style light B2B SaaS palette ---- */
:root {
  --background: #f8fafc;
  --foreground: #374151;
  --card: #ffffff;
  --card-foreground: #374151;
  --accent: #6366f1;
  --accent-foreground: #ffffff;
  --muted: #f1f5f9;
  --muted-foreground: #4b5563;
  --border: #e5e7eb;
  --ring: rgba(99, 102, 241, 0.5);
  --chart-1: #6366f1;
  --chart-2: #10b981;
  --chart-3: #f59e0b;
  --chart-4: #ef4444;
  --chart-5: #8b5cf6;
  --radius: 0.5rem;
}

/* ---- Re-theme CopilotKit chat (its styles.css scopes vars under [data-copilotkit]) ---- */
[data-copilotkit] {
  --background: #ffffff;
  --foreground: #374151;
  --card: #ffffff;
  --card-foreground: #374151;
  --popover: #ffffff;
  --popover-foreground: #374151;
  --primary: #6366f1;
  --primary-foreground: #ffffff;
  --secondary: #eef2ff;
  --secondary-foreground: #4338ca;
  --muted: #f1f5f9;
  --muted-foreground: #4b5563;
  --accent: #6366f1;
  --accent-foreground: #ffffff;
  --destructive: #be123c;
  --destructive-foreground: #ffffff;
  --border: #e5e7eb;
  --input: #ffffff;
  --ring: rgba(99, 102, 241, 0.5);
}

* { box-sizing: border-box; }
html, body, #app { height: 100%; margin: 0; }
body {
  font-family: 'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  -webkit-font-smoothing: antialiased;
  background: var(--background);
  color: var(--foreground);
}

.page { display: flex; flex-direction: column; height: 100%; }

/* ---- Header ---- */
.topbar {
  padding: 0 24px;
  height: 60px;
  flex: none;
  background: #ffffff;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
.logo {
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 9px;
  background: linear-gradient(135deg, #6366f1, #818cf8);
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 2px rgba(99, 102, 241, 0.35);
}
.brand-text { display: flex; flex-direction: column; line-height: 1.2; }
.brand-text h1 { font-size: 15px; margin: 0; font-weight: 700; letter-spacing: -0.01em; color: #111827; }
.subtitle { font-size: 12px; color: var(--muted-foreground); }
.badge {
  font-size: 12px;
  color: #4338ca;
  background: #eef2ff;
  border: 1px solid #e0e7ff;
  padding: 4px 12px;
  border-radius: 999px;
  white-space: nowrap;
}
@media (max-width: 720px) { .badge { display: none; } }
.topbar-right { display: flex; align-items: center; gap: 8px; }
.context-badge {
  color: #047857;
  background: #ecfdf5;
  border-color: #a7f3d0;
  font-variant-numeric: tabular-nums;
}

/* ---- Chat area ---- */
.chat-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  justify-content: center;
  padding: 24px;
}
.chat-card {
  flex: 1;
  min-height: 0;
  width: 100%;
  max-width: 56rem;
  display: flex;
  flex-direction: column;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: calc(var(--radius) + 4px);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06), 0 8px 24px rgba(15, 23, 42, 0.04);
  overflow: hidden;
}
.chat { flex: 1; min-height: 0; }

/* ---- Toasts (showNotification frontend tool) ---- */
.toast-stack {
  position: fixed;
  top: 76px;
  right: 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  z-index: 1000;
  pointer-events: none;
}
.toast {
  width: 320px;
  background: #ffffff;
  border: 1px solid var(--border);
  border-left: 4px solid var(--accent);
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.12);
  padding: 12px 14px;
  animation: toast-in 180ms ease-out;
}
.toast strong { display: block; font-size: 13px; color: #111827; margin-bottom: 2px; }
.toast p { margin: 0; font-size: 12.5px; color: var(--muted-foreground); line-height: 1.45; }
.toast-success { border-left-color: #10b981; }
.toast-warning { border-left-color: #f59e0b; }
.toast-error { border-left-color: #ef4444; }
@keyframes toast-in {
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
