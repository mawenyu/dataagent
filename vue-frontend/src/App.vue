<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, nextTick, watch, computed } from 'vue'
import { z } from 'zod'
import { CopilotKitProvider, CopilotChat, getThreadClone, createA2UIMessageRenderer } from '@copilotkit/vue'
import { dataAgent } from './agents/dataAgent'
import { dataAgentCatalog } from './a2ui/dataAgentCatalog'
import { isA2uiSurfaceMessage, scanA2uiOps } from './utils/a2uiOps'
import { useContextUsage } from './composables/useContextUsage'
import { useAgentState } from './composables/useAgentState'
import { useThreads } from './composables/useThreads'
import { useWorkspaceFiles } from './composables/useWorkspaceFiles'
import { buildAttachmentsConfig, ATTACH_ACCEPT } from './composables/chatAttachments'
import { useWelcomeAttachments } from './composables/welcomeAttachments'
import { PROMPT_TEMPLATES, templatesByGroup, type PromptTemplate } from './composables/promptTemplates'
import PromptTemplatePanel from './components/PromptTemplatePanel.vue'
import TemplateSidebarPanel from './components/TemplateSidebarPanel.vue'
import { applySpreadsheetEdits } from './composables/spreadsheetEdits'
import { buildThreadJson, buildThreadMarkdown, downloadJson, downloadMarkdown, exportFilename } from './composables/exportThread'
import { useRunErrorRecovery, isAbortError, parseRunError } from './composables/runErrorRecovery'
import { useNetworkStatus } from './composables/networkStatus'
import { useGlobalShortcuts } from './composables/useGlobalShortcuts'
import { uuid } from './composables/uuid'
import RunErrorCard from './components/RunErrorCard.vue'
import BranchDialog from './components/BranchDialog.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import DefaultToolRender from './components/DefaultToolRender.vue'
import RenderA2uiToolCall from './components/RenderA2uiToolCall.vue'
import FilesPanel from './components/FilesPanel.vue'
import CapabilitiesPanel from './components/CapabilitiesPanel.vue'
import ThreadSidebar from './components/ThreadSidebar.vue'
import A2uiWorkspace from './components/A2uiWorkspace.vue'
import A2uiRefCard from './components/A2uiRefCard.vue'
import ImageLightbox from './components/ImageLightbox.vue'
import FilePreviewModal from './components/FilePreviewModal.vue'
import { resolveAttachmentPreview, type AttachmentPreviewTarget } from './composables/attachmentPreview'
import { fetchPdfPreviewUrl, isImage, isPdf, isPreviewable } from './composables/filePreview'

// Registered via the fork's `directAgents` prop (see packages/copilotkit-vue/FORK.md).
// Business code never touches agents__unsafe_dev_only / selfManagedAgents.
const agents = {
  default: dataAgent,
}

// 需求1: 多会话管理（gateway 持久化为权威，localStorage 兜底）
const threadsApi = useThreads(dataAgent)
onMounted(() => threadsApi.init())
// run 结束后 gateway 用首条消息命名 → 刷新侧边栏列表
dataAgent.subscribe({ onRunFinalized: () => { void threadsApi.refresh() } })

// 需求7-5 + P-K: context 用量徽章 + 累计 token(每会话分桶) + 接近上限提示
const {
  contextSize,
  label: contextLabel,
  totalTokens,
  tokenLabel,
  tokenTitle,
  warningLevel: contextWarning,
} = useContextUsage(dataAgent, threadsApi.currentId)
// P-K: 提示级别升级时一次性 toast(降级不打扰;同级不重复)
watch(contextWarning, (level, prev) => {
  if (level === 'amber' && prev === 'none') {
    pushToast({
      title: '上下文用量较高',
      message: '当前会话上下文已超过 80%，继续长对话可能触发截断，建议适时新建会话',
      type: 'warning',
    })
  } else if (level === 'red' && prev !== 'red') {
    pushToast({
      title: '上下文接近上限',
      message: '已超过 95%，下一步回答可能被截断 —— 强烈建议新建会话并导出当前会话',
      type: 'error',
    })
  }
})
// AG-UI shared state（task4）: STATE_SNAPSHOT 的 model 显示为顶栏徽章
const { state: agentState } = useAgentState(dataAgent)

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

// task5-B4: applySpreadsheetEdits 落盘通道（与文件面板同一套 /files API）
// task6: 绑定当前会话 —— 所有文件操作落在会话隔离 workspace
const workspaceFilesApi = useWorkspaceFiles(threadsApi.currentId)

// task6-B: ChatGPT 式上传 —— 输入框"+"添加附件，即传即存当前会话工作目录；
// 发送时附件文件名随消息进 agent prompt（spec: docs/spec/workspace-isolation.md）
const chatAttachments = buildAttachmentsConfig({
  upload: (file) => workspaceFilesApi.upload(file),
  downloadUrl: (name) => workspaceFilesApi.downloadUrl(name),
  onFailed: (e) => pushToast({ title: '附件上传失败', message: e.message, type: 'error' }),
})

// F1b: 欢迎页附件 —— welcome-screen 槽整视图替换（自绘输入区），fork 附件
// 队列不参与，单独维护 chip；复用同一条会话级上传链路（currentId 始终存在，
// gateway 懒建会话目录），发送时附件名拼进消息文本带给 agent
const welcomeAttachments = useWelcomeAttachments({
  upload: (file) => workspaceFilesApi.upload(file),
  onFailed: (message) => pushToast({ title: '附件上传失败', message, type: 'error' }),
  threadId: threadsApi.currentId,
})
const welcomeDrag = ref(false)
const welcomeFileInput = ref<HTMLInputElement | null>(null)

// 多模态预览: 对话附件区点击预览（App 级委托,不改 fork —— 附件 DOM 带稳定 testid）。
// 图片 → lightbox;pdf → blob URL iframe;csv/md 等 → 256KB 文本预览 modal;
// 文本预览复用 workspaceFilesApi.preview（本实例独立于文件面板实例,互不干扰）。
const attachmentLightbox = ref<{ name: string; url: string } | null>(null)
const attachmentPdf = ref<{ name: string; url: string } | null>(null)
const attachmentPdfLoading = ref(false)

function openAttachmentPreview(t: AttachmentPreviewTarget) {
  if (t.kind === 'image') {
    attachmentLightbox.value = { name: t.name, url: t.url }
    return
  }
  if (t.kind === 'pdf') {
    attachmentPdfLoading.value = true
    void fetchPdfPreviewUrl(t.url)
      .then((url) => { attachmentPdf.value = { name: t.name, url } })
      .catch(() => pushToast({ title: '附件预览失败', message: `「${t.name}」加载失败，请下载查看`, type: 'error' }))
      .finally(() => { attachmentPdfLoading.value = false })
    return
  }
  void workspaceFilesApi.previewFile(t.name)
}

function closeAttachmentPdf() {
  if (attachmentPdf.value) URL.revokeObjectURL(attachmentPdf.value.url)
  attachmentPdf.value = null
}

/** 对话栏点击委托：附件元素 → 预览；其余 → 不干预。 */
function onChatColClick(e: MouseEvent) {
  const t = resolveAttachmentPreview(e.target, (name) => workspaceFilesApi.downloadUrl(name))
  if (t) openAttachmentPreview(t)
}

/** 欢迎页附件 chip 点击预览（文件在选取时已传会话 workspace;仅 ready 态可预览）。 */
function previewWelcomeAttachment(name: string) {
  const url = workspaceFilesApi.downloadUrl(name)
  if (isImage(name)) openAttachmentPreview({ kind: 'image', name, url })
  else if (isPdf(name)) openAttachmentPreview({ kind: 'pdf', name, url })
  else if (isPreviewable(name)) openAttachmentPreview({ kind: 'text', name, url })
  else pushToast({ title: '暂不支持预览', message: `「${name}」请下载查看`, type: 'info' })
}
function onWelcomeFilesPicked(e: Event) {
  const input = e.target as HTMLInputElement
  void welcomeAttachments.addFiles(input.files ?? [])
  input.value = '' // 允许再次选择同一文件
}
function onWelcomeDrop(e: DragEvent) {
  welcomeDrag.value = false
  void welcomeAttachments.addFiles(e.dataTransfer?.files ?? [])
}
function submitWelcome(modelValue: string | undefined, onSubmitMessage: (m: string) => void) {
  const msg = welcomeAttachments.consumeForSubmit(modelValue ?? '')
  if (msg !== null) onSubmitMessage(msg)
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
  // task5-B4: agent 编辑 workspace CSV 表格（HITL：自绘确认 modal 确认后才落盘，P1 弃原生 confirm）
  {
    name: 'applySpreadsheetEdits',
    description:
      "Edit cells of a CSV spreadsheet file in the user's workspace. row/col are 0-based (row 0 is the header row); out-of-range rows/cols extend the sheet. The user sees a confirmation dialog (in-app modal) with the change count before anything is written — if they cancel, the file is left untouched. Use this to update or append spreadsheet data. This is the ONLY sanctioned way to modify spreadsheet/data files (CSV/TSV/XLSX): NEVER use native edit/write file tools on them directly.",
    parameters: z.object({
      file: z.string().describe('CSV file name in the workspace (e.g. sales-2026-08.csv)'),
      cells: z.array(z.object({
        row: z.number().int().nonnegative().describe('0-based row index; 0 is the header row'),
        col: z.number().int().nonnegative().describe('0-based column index'),
        value: z.string().describe('New cell text'),
      })).min(1).describe('Cell edits to apply'),
      summary: z.string().optional()
        .describe('Short human-readable summary of the edits, shown in the confirmation dialog'),
    }),
    handler: async (args: { file: string; cells: { row: number; col: number; value: string }[]; summary?: string }) => {
      return applySpreadsheetEdits(args, {
        readFile: async (name) => {
          try { return await workspaceFilesApi.readFile(name) } catch { return null }
        },
        // P15: 落盘携带读取时 mtime → gateway 乐观并发检测（409 不静默覆盖）
        saveFile: (name, content, baseModified) => workspaceFilesApi.saveFile(name, content, baseModified),
        modifiedAtOf: async (name) => {
          await workspaceFilesApi.refresh()
          return workspaceFilesApi.statOf(name)
        },
        confirm: (msg) => askConfirm(msg),
      })
    },
  },
]

// 需求4: 侧边栏可折叠（移动端抽屉化）
const sidebarOpen = ref(true)
// P29: 产品化布局 —— 最左导航 rail 切换主视图；P0-b: 三主视图（对话 / 文件 / 能力），
// 对话视图保持纯粹：只有历史会话列表 + 聊天工作区（Linear/Notion 式 icon rail）
const mainView = ref<'chat' | 'files' | 'caps'>('chat')
function toggleSidebar() { sidebarOpen.value = !sidebarOpen.value }
function closeSidebarOnMobile() {
  if (window.innerWidth <= 720) sidebarOpen.value = false
}

// P-R: 切换会话时消息区 shimmer 骨架(历史拉取期间占位,避免旧会话残影/白屏)
const threadSwitching = ref(false)
async function switchThread(id: string) {
  if (id === threadsApi.currentId.value) {
    closeSidebarOnMobile()
    return
  }
  threadSwitching.value = true
  try {
    await threadsApi.switchTo(id)
  } finally {
    threadSwitching.value = false
  }
  closeSidebarOnMobile()
}
onMounted(() => { if (window.innerWidth <= 720) sidebarOpen.value = false })

// P-O: 全局快捷键 —— Ctrl/Cmd+K 聚焦会话搜索(自动展开侧边栏+会话 Tab);
// Ctrl/Cmd+N 新建会话。Esc 关 modal 由各弹窗自身处理(焦点圈定内生效)
useGlobalShortcuts({
  onFocusSearch: () => {
    mainView.value = 'chat'
    sidebarOpen.value = true
    void nextTick(() => {
      document.querySelector<HTMLInputElement>('[data-testid="thread-search"]')?.focus()
    })
  },
  // 新建会话同时确保落在对话视图（在能力视图按 Ctrl+N 也应看到新会话）
  onNewThread: () => { mainView.value = 'chat'; void threadsApi.createNew() },
})

// P-D: 空会话欢迎页的场景模板卡 —— 点击填充输入框(可编辑后再发送,非直接提交)
// P-b: 数据源迁至 composables/promptTemplates(与顶栏快捷指令面板共享,防漂移)
const promptTemplates = templatesByGroup('开场')
const welcomeTextarea = ref<HTMLTextAreaElement | null>(null)
/** P-E: 当前高亮的模板卡标题(手动编辑/清空时移除) */
const activeTemplate = ref<string | null>(null)

/** P-E: 欢迎页输入框自适应高度 —— 跟随内容,超 3 行封顶出滚动条。 */
const WELCOME_TA_MAX = 82 // 3 行 × 22px 行高 + 上下 padding 16px
const WELCOME_TA_MIN = 40
function autoGrowWelcome() {
  const el = welcomeTextarea.value
  if (!el) return
  el.style.height = 'auto'
  const h = Math.max(WELCOME_TA_MIN, Math.min(el.scrollHeight, WELCOME_TA_MAX))
  el.style.height = `${h}px`
  el.style.overflowY = el.scrollHeight > WELCOME_TA_MAX ? 'auto' : 'hidden'
}

function fillTemplate(sg: { title: string; prompt: string }, onUpdate: (v: string) => void) {
  onUpdate(sg.prompt)
  activeTemplate.value = sg.title
  void nextTick(() => {
    welcomeTextarea.value?.focus()
    autoGrowWelcome()
  })
}

/** 手动编辑: 转接文本 + 移除模板高亮 + 自适应高度。 */
function onWelcomeInput(e: Event, onUpdate: (v: string) => void) {
  activeTemplate.value = null
  onUpdate((e.target as HTMLTextAreaElement).value)
  autoGrowWelcome()
}

// P-b: 顶栏快捷指令面板 —— 选中模板直接作为 user 消息发送到当前会话
const templatePanelOpen = ref(false)
function applyTemplate(t: PromptTemplate) {
  templatePanelOpen.value = false
  const agent = getThreadClone(dataAgent, threadsApi.currentId.value) ?? dataAgent
  if (agentBusy.value || agent.isRunning) {
    pushToast({ title: '运行中', message: '当前会话正在生成，结束后再使用快捷指令', type: 'info' })
    return
  }
  agent.addMessage({ id: uuid(), role: 'user', content: t.prompt })
  void agent.runAgent()
}

/** 一键清空: 清空文本 + 移除高亮 + 复位高度。 */
function clearWelcome(onUpdate: (v: string) => void) {
  onUpdate('')
  activeTemplate.value = null
  void nextTick(() => {
    const el = welcomeTextarea.value
    if (el) {
      el.style.height = ''
      el.style.overflowY = 'hidden'
      el.focus()
    }
  })
}

// 模板库: 主输入框共享值 —— 经 CopilotChat inputValue prop 注入,fork 内部 watch 同步,
// 欢迎页 textarea 与主输入框同源(槽 modelValue 即 resolvedInputValue),故 fillMainInput 一处处双生效
const mainInputText = ref('')
function fillMainInput(t: PromptTemplate) {
  mainInputText.value = t.prompt
  activeTemplate.value = null
}
/** fork 提交时只清内部值、不发 input-change —— 这里同步清 mainInputText 防残留。 */
function onChatSubmit() {
  errorRecovery.clear()
  mainInputText.value = ''
}

// P1: Promise 化自绘确认(替代 window.confirm —— applySpreadsheetEdits HITL)
const confirmState = ref<{ message: string; resolve: (ok: boolean) => void } | null>(null)
function askConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    confirmState.value = { message, resolve }
  })
}
function resolveConfirm(ok: boolean) {
  confirmState.value?.resolve(ok)
  confirmState.value = null
}

// P-Q: 会话分叉 —— 顶栏入口,弹窗选分叉点,gateway 建档后切到新会话
const branchDialogOpen = ref(false)
const branchBusy = ref(false)

// agent.messages 非响应式 —— 用 tick 驱动 computed 重算(clone 事件会冒泡到 registry 订阅)
const messagesTick = ref(0)
dataAgent.subscribe({
  onMessagesChanged: () => { messagesTick.value += 1 },
  onRunFinishedEvent: () => { messagesTick.value += 1 },
  onRunErrorEvent: () => { messagesTick.value += 1 },
})

/** 当前会话可分叉的消息(user/assistant 文本;reasoning/tool 不作分叉点)。 */
const branchMessages = computed(() => {
  void messagesTick.value
  void threadsApi.currentId.value
  const target = (getThreadClone(dataAgent, threadsApi.currentId.value) ?? dataAgent) as any
  const msgs = (target?.messages ?? []) as any[]
  return msgs
    .filter((m) => m?.role === 'user' || m?.role === 'assistant')
    .map((m) => ({ id: String(m.id), role: m.role as string, text: messageText(m.content) }))
    .filter((m) => m.text.trim().length > 0)
})

// 布局分栏：宽屏 = 右侧窄对话栏 + 中央 A2UI 工作区；窄屏(<1024px)退化单栏。
// A2UI 产物（a2ui-surface activity 消息）挪到中央区渲染，对话栏只留引用卡。
const isNarrowLayout = ref(false)
let layoutMql: MediaQueryList | null = null
const syncLayoutMq = () => { isNarrowLayout.value = layoutMql?.matches ?? false }
onMounted(() => {
  if (typeof window.matchMedia === 'function') {
    layoutMql = window.matchMedia('(max-width: 1023px)')
    syncLayoutMq()
    layoutMql.addEventListener('change', syncLayoutMq)
  }
})
onBeforeUnmount(() => layoutMql?.removeEventListener('change', syncLayoutMq))

/** 当前会话的 A2UI 产物消息（按时间序）。 */
const a2uiEntries = computed(() => {
  void messagesTick.value
  void threadsApi.currentId.value
  const target = (getThreadClone(dataAgent, threadsApi.currentId.value) ?? dataAgent) as any
  return ((target?.messages ?? []) as any[])
    .filter(isA2uiSurfaceMessage)
    .map((m) => ({ message: m }))
})
/** 有产物且宽屏 → 显示中央工作区；否则对话栏占满（含窄屏退化）。 */
const showA2uiWorkspace = computed(() => !isNarrowLayout.value && a2uiEntries.value.length > 0)
/** 窄屏内联渲染回退用（与 provider 内建同一渲染管线）。 */
const a2uiInlineRenderer = createA2UIMessageRenderer({ theme: {}, catalog: dataAgentCatalog })
const a2uiWorkspaceRef = ref<InstanceType<typeof A2uiWorkspace> | null>(null)
const a2uiThreadAgent = computed(() => {
  void threadsApi.currentId.value
  return (getThreadClone(dataAgent, threadsApi.currentId.value) ?? dataAgent) as unknown as object
})
function locateA2uiBlock(messageId: string) {
  a2uiWorkspaceRef.value?.locate(messageId)
}
function a2uiCardScan(content: unknown) {
  return scanA2uiOps((content as { a2ui_operations?: unknown } | undefined)?.a2ui_operations)
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const p of content) {
      if (p && typeof p === 'object' && (p as any).type === 'text' && typeof (p as any).text === 'string') {
        parts.push((p as any).text)
      }
    }
    return parts.join('\n')
  }
  return ''
}

async function branchFrom(messageId: string) {
  if (branchBusy.value) return
  branchBusy.value = true
  try {
    const parentId = threadsApi.currentId.value
    const newId = uuid()
    const res = await fetch(`/agui-api/chat/threads/${encodeURIComponent(parentId)}/branch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, newThreadId: newId }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await threadsApi.refresh()
    await threadsApi.switchTo(newId)
    branchDialogOpen.value = false
    pushToast({ title: '已创建分支', message: '分叉点之前的上下文已复制到新会话', type: 'success' })
  } catch (e: any) {
    pushToast({ title: '创建分支失败', message: e?.message ?? '未知错误', type: 'error' })
  } finally {
    branchBusy.value = false
  }
}

// 需求7-6 + P-B: run 超时/失败 → 内联错误卡（原因+重试）+ toast；
// 用户主动停止(abort)不算失败，两者都不弹
const errorRecovery = useRunErrorRecovery({
  // 重试必须打在 UI 实际渲染的 per-thread clone 上（与 useThreads 同一解析规则）
  resolveAgent: () => getThreadClone(dataAgent, threadsApi.currentId.value) ?? dataAgent,
  threadId: threadsApi.currentId,
  run: async (agent) => { await (agent as typeof dataAgent).runAgent() },
})
// P-b: 快捷指令发送的运行态守卫（clone 事件与 base agent 订阅互通，同 errorRecovery.clear 路径）
const agentBusy = ref(false)
dataAgent.subscribe({
  onRunStartedEvent: () => { errorRecovery.clear(); agentBusy.value = true },
  onRunFinishedEvent: () => { agentBusy.value = false },
  onRunErrorEvent: () => { agentBusy.value = false },
})

// P-I: 网络断线检测 —— 顶栏离线徽章;离线期间中断的 run 在恢复后自动续跑
const pendingAutoResume = ref(false)
const { online } = useNetworkStatus({
  onOnline: () => {
    if (!pendingAutoResume.value) return
    pendingAutoResume.value = false
    pushToast({ title: '网络已恢复', message: '正在自动重试中断的运行…', type: 'info' })
    void errorRecovery.retryLastMessage()
  },
})

function handleChatError({ error, code }: { error: Error; code?: string }) {
  if (isAbortError({ code, message: error?.message })) return
  // P-I: 结构化错误码(5xx 等)友好文案 + 徽章;离线期间的失败标记为待恢复
  const parsed = parseRunError({ code, message: error?.message })
  errorRecovery.reportError(parsed.message, parsed.code)
  if (!online.value) pendingAutoResume.value = true
  pushToast({
    title: '运行中断',
    message: `${parsed.message} —— 可点消息流尾部错误卡重试`,
    type: 'error',
  })
}

// P-A/P-M: 会话导出 —— 拉 gateway 历史消息 → 前端生成 Blob 下载(MD 或 JSON)
async function exportThread(id: string, format: 'md' | 'json') {
  const meta = threadsApi.threads.value.find((t) => t.id === id)
  const threadMeta = { id, title: meta?.title ?? id, createdAt: meta?.createdAt, updatedAt: meta?.updatedAt }
  try {
    const res = await fetch(`/agui-api/chat/threads/${encodeURIComponent(id)}/messages`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = await res.json()
    const messages = body.data ?? []
    if (format === 'json') {
      downloadJson(exportFilename(threadMeta, 'json'), buildThreadJson(threadMeta, messages, new Date()))
    } else {
      downloadMarkdown(exportFilename(threadMeta, 'md'), buildThreadMarkdown(threadMeta, messages, new Date()))
    }
    pushToast({
      title: '导出成功',
      message: `已导出 ${messages.length} 条消息为 ${format === 'json' ? 'JSON' : 'Markdown'}`,
      type: 'success',
    })
  } catch (e: any) {
    pushToast({ title: '导出失败', message: e?.message ?? '未知错误', type: 'error' })
  }
}
</script>

<template>
  <div class="app-shell">
    <!-- P29: 主导航 rail（Linear/Notion 式窄 icon 栏）—— P0-b: 对话 / 文件 / 能力 三主视图 -->
    <nav class="nav-rail" aria-label="主导航">
      <div class="rail-logo" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="4" y1="20" x2="4" y2="12" />
          <line x1="10" y1="20" x2="10" y2="6" />
          <line x1="16" y1="20" x2="16" y2="14" />
          <line x1="22" y1="20" x2="22" y2="9" />
        </svg>
      </div>
      <button
        class="rail-btn"
        data-testid="rail-chat"
        :aria-current="mainView === 'chat' ? 'page' : undefined"
        title="对话"
        @click="mainView = 'chat'"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
        <span>对话</span>
      </button>
      <button
        class="rail-btn"
        data-testid="rail-files"
        :aria-current="mainView === 'files' ? 'page' : undefined"
        title="文件"
        @click="mainView = 'files'"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        <span>文件</span>
      </button>
      <button
        class="rail-btn"
        data-testid="rail-caps"
        :aria-current="mainView === 'caps' ? 'page' : undefined"
        title="能力"
        @click="mainView = 'caps'"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
        <span>能力</span>
      </button>
    </nav>
    <div class="page">
    <header class="topbar">
      <div class="brand">
        <button
          v-if="mainView === 'chat'"
          class="sidebar-toggle"
          title="折叠/展开会话栏"
          @click="toggleSidebar"
        >☰</button>
        <div class="brand-text">
          <h1>DataAgent</h1>
          <span class="subtitle">AI 数据分析助手</span>
        </div>
      </div>
      <div class="topbar-right">
        <button
          class="branch-open"
          data-testid="template-open"
          title="提示词模板 / 快捷指令"
          @click="templatePanelOpen = !templatePanelOpen"
        >✨ 模板</button>
        <button
          class="branch-open"
          data-testid="branch-open"
          :disabled="branchMessages.length === 0"
          title="从任意历史消息分叉新会话"
          @click="branchDialogOpen = true"
        >⑂ 分支</button>
        <span
          v-if="!online"
          class="badge offline-badge"
          data-testid="offline-badge"
          title="网络连接已断开,恢复后自动续跑中断的运行"
        >● 离线</span>
        <span
          v-if="agentState.model"
          class="badge model-badge"
          data-testid="model-badge"
          :title="`provider: ${agentState.provider ?? '-'} · workspace: ${agentState.workspace ?? '-'}`"
        >{{ agentState.model }}</span>
        <span
          v-if="contextSize > 0"
          class="badge context-badge"
          :class="`level-${contextWarning}`"
          :title="`当前会话上下文占用 ${contextSize} tokens`"
        >{{ contextLabel }}</span>
        <span
          v-if="totalTokens > 0"
          class="badge tokens-badge"
          data-testid="tokens-badge"
          :title="tokenTitle"
        >{{ tokenLabel }}</span>
      </div>
    </header>
    <PromptTemplatePanel
      :open="templatePanelOpen"
      @close="templatePanelOpen = false"
      @select="applyTemplate"
    />
    <main class="chat-wrap">
      <div
        v-show="mainView === 'chat'"
        class="chat-card"
        data-testid="chat-view"
      >
        <CopilotKitProvider
          :direct-agents="agents"
          :frontend-tools="frontendTools"
          :a2ui="{ catalog: dataAgentCatalog, includeSchema: true }"
        >
          <DefaultToolRender />
          <RenderA2uiToolCall />
          <div class="chat-layout">
            <Transition name="drawer">
              <div v-if="sidebarOpen" class="sidebar-shell">
                <!-- P0-b: 对话视图纯粹化 —— 侧栏只剩会话列表（文件/能力均为 rail 主视图） -->
                <ThreadSidebar
                  :threads="threadsApi.threads.value"
                  :current-id="threadsApi.currentId.value"
                  @new="threadsApi.createNew()"
                  @switch="switchThread($event)"
                  @remove="threadsApi.remove($event)"
                  @rename="(id: string, title: string) => threadsApi.rename(id, title)"
                  @export="(id: string, format: 'md' | 'json') => exportThread(id, format)"
                />
                <!-- 模板库: 侧栏底部模板面板 —— 场景卡填入输入框,支持保存自定义模板 -->
                <TemplateSidebarPanel :draft-prompt="mainInputText" @fill="fillMainInput" />
              </div>
            </Transition>
            <div v-if="sidebarOpen" class="drawer-backdrop" @click="toggleSidebar"></div>
            <!-- 布局分栏：宽屏有 A2UI 产物时中央工作区，对话栏收窄到右侧 -->
            <div v-if="showA2uiWorkspace" class="a2ui-workspace-shell" data-testid="a2ui-workspace-shell">
              <A2uiWorkspace
                ref="a2uiWorkspaceRef"
                :entries="a2uiEntries"
                :agent="a2uiThreadAgent"
                :catalog="dataAgentCatalog"
              />
            </div>
            <div class="chat-col" :class="{ 'chat-col-narrow': showA2uiWorkspace }" @click="onChatColClick">
              <CopilotChat
                agent-id="default"
                class="chat"
                :thread-id="threadsApi.currentId.value"
                :attachments="chatAttachments"
                :input-value="mainInputText"
                :on-error="handleChatError"
                @input-change="(v: string) => (mainInputText = v)"
                @submit-message="onChatSubmit"
              >
              <!-- 布局分栏：A2UI surface 在对话流里只留引用卡（宽屏）；窄屏内联渲染 -->
              <template #activity-a2ui-surface="{ content, message, agent }">
                <A2uiRefCard
                  v-if="showA2uiWorkspace"
                  :message-id="String(message.id)"
                  :surface-ids="a2uiCardScan(content).surfaceIds"
                  :component-count="a2uiCardScan(content).componentCount"
                  @locate="locateA2uiBlock"
                />
                <component
                  :is="a2uiInlineRenderer.render"
                  v-else
                  activity-type="a2ui-surface"
                  :content="content"
                  :message="message"
                  :agent="agent"
                />
              </template>
              <template #welcome-screen="{ modelValue, isRunning, onUpdateModelValue, onSubmitMessage }">
                <div class="welcome" data-testid="welcome-screen">
                  <div class="welcome-logo" aria-hidden="true">
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="4" y1="20" x2="4" y2="12" />
                      <line x1="10" y1="20" x2="10" y2="6" />
                      <line x1="16" y1="20" x2="16" y2="14" />
                      <line x1="22" y1="20" x2="22" y2="9" />
                    </svg>
                  </div>
                  <h2>DataAgent 数据分析助手</h2>
                  <p class="welcome-sub">用自然语言分析 workspace 里的数据，自动生成图表看板</p>
                  <div class="welcome-grid">
                    <button
                      v-for="sg in promptTemplates"
                      :key="sg.title"
                      class="welcome-card"
                      :class="{ 'card-active': activeTemplate === sg.title }"
                      :title="`填充模板：${sg.prompt}`"
                      @click="fillTemplate(sg, onUpdateModelValue)"
                    >
                      <strong>{{ sg.title }}</strong>
                      <span>{{ sg.desc }}</span>
                    </button>
                  </div>
                  <!-- welcome-screen 槽替换整个视图（含输入框），所以这里自绘输入区 -->
                  <!-- F1b: 自绘输入区同样支持 ChatGPT 式附件（📎 + 拖拽 + chip） -->
                  <div
                    class="welcome-input"
                    :class="{ 'drag-over': welcomeDrag }"
                    data-testid="welcome-input"
                    @dragover.prevent="welcomeDrag = true"
                    @dragleave="welcomeDrag = false"
                    @drop.prevent="onWelcomeDrop"
                  >
                    <div
                      v-if="welcomeAttachments.items.value.length"
                      class="welcome-chips"
                      data-testid="welcome-chips"
                    >
                      <span
                        v-for="a in welcomeAttachments.items.value"
                        :key="a.id"
                        class="welcome-chip"
                        :data-status="a.status"
                      >
                        <span
                          class="chip-name"
                          :class="{ clickable: a.status === 'ready' }"
                          :title="a.status === 'ready' ? '点击预览' : undefined"
                          @click="a.status === 'ready' && previewWelcomeAttachment(a.name)"
                        >📄 {{ a.name }}</span>
                        <span v-if="a.status === 'uploading'" class="chip-status">上传中…</span>
                        <span
                          v-else-if="a.status === 'error'"
                          class="chip-status err"
                          :title="a.errorMessage ? `失败原因：${a.errorMessage}` : '上传失败'"
                        >失败ⓘ</span>
                        <button
                          class="chip-remove"
                          :aria-label="`移除附件 ${a.name}`"
                          @click="welcomeAttachments.remove(a.id)"
                        >×</button>
                      </span>
                    </div>
                    <div class="welcome-input-row">
                      <button
                        class="welcome-attach"
                        data-testid="welcome-attach"
                        title="添加附件（CSV/JSON/XLSX/图片等，≤50MB）"
                        :disabled="isRunning"
                        @click="welcomeFileInput?.click()"
                      >📎</button>
                      <input
                        ref="welcomeFileInput"
                        type="file"
                        multiple
                        hidden
                        :accept="ATTACH_ACCEPT"
                        data-testid="welcome-file-input"
                        @change="onWelcomeFilesPicked"
                      />
                      <textarea
                        ref="welcomeTextarea"
                        :value="modelValue"
                        placeholder="输入你的数据问题…"
                        title="回车发送，Shift+Enter 换行"
                        rows="1"
                        :disabled="isRunning"
                        @input="onWelcomeInput($event, onUpdateModelValue)"
                        @keydown.enter.exact.prevent="submitWelcome(modelValue, onSubmitMessage)"
                      ></textarea>
                      <button
                        v-if="(modelValue && modelValue.length > 0) || activeTemplate"
                        class="welcome-clear"
                        data-testid="welcome-clear"
                        title="清空输入"
                        @click="clearWelcome(onUpdateModelValue)"
                      >✕</button>
                      <button
                        class="welcome-send"
                        :disabled="isRunning || welcomeAttachments.hasUploading.value || (!(modelValue && modelValue.trim()) && !welcomeAttachments.hasReady.value)"
                        @click="submitWelcome(modelValue, onSubmitMessage)"
                      >发送</button>
                    </div>
                  </div>
                </div>
              </template>
              </CopilotChat>
              <!-- P-B: 内联错误卡 —— 悬浮在消息流尾部上方,重试=原线程重发最后一条用户消息 -->
              <!-- P-R: 切换会话骨架屏 -->
              <div v-if="threadSwitching" class="thread-skeleton" data-testid="thread-skeleton" aria-hidden="true">
                <div class="sk-row sk-left"><div class="sk-bubble shimmer"></div></div>
                <div class="sk-row sk-right"><div class="sk-bubble shimmer"></div></div>
                <div class="sk-row sk-left"><div class="sk-bubble shimmer"></div></div>
              </div>
              <RunErrorCard
                v-if="errorRecovery.runError.value"
                class="run-error-overlay"
                :message="errorRecovery.runError.value"
                :code="errorRecovery.runErrorCode.value"
                :busy="errorRecovery.retrying.value"
                @retry="errorRecovery.retryLastMessage()"
                @dismiss="errorRecovery.clear()"
              />
            </div>
          </div>
        </CopilotKitProvider>
      </div>
      <!-- P0-b: 文件主视图（rail 切换；绑定当前会话的隔离工作目录） -->
      <div
        v-show="mainView === 'files'"
        class="caps-card"
        data-testid="files-view"
      >
        <FilesPanel :thread-id="threadsApi.currentId.value" />
      </div>
      <!-- P29: 能力主视图（rail 切换；v-show 保活，返回对话不丢状态） -->
      <div
        v-show="mainView === 'caps'"
        class="caps-card"
        data-testid="caps-view"
      >
        <CapabilitiesPanel :frontend-tools="frontendTools" />
      </div>
    </main>
    <!-- P1: HITL 确认弹窗(spreadsheet 编辑等) -->
    <ConfirmDialog
      v-if="confirmState"
      title="确认变更"
      :message="confirmState.message"
      confirm-label="应用"
      @confirm="resolveConfirm(true)"
      @cancel="resolveConfirm(false)"
    />
    <!-- P-Q: 分叉弹窗 -->
    <BranchDialog
      v-if="branchDialogOpen"
      :messages="branchMessages"
      :busy="branchBusy"
      @select="branchFrom"
      @close="branchDialogOpen = false"
    />
    <!-- 多模态预览: 附件图片 lightbox -->
    <ImageLightbox
      v-if="attachmentLightbox"
      :src="attachmentLightbox.url"
      :name="attachmentLightbox.name"
      @close="attachmentLightbox = null"
    />
    <!-- 多模态预览: 附件 PDF iframe(blob URL) -->
    <FilePreviewModal
      v-if="attachmentPdf"
      :name="attachmentPdf.name"
      :pdf-url="attachmentPdf.url"
      @close="closeAttachmentPdf"
    />
    <!-- 多模态预览: 附件文本类(csv 表格/json/md/txt,256KB 截断) -->
    <FilePreviewModal
      v-if="workspaceFilesApi.preview.value"
      :name="workspaceFilesApi.preview.value.name"
      :content="workspaceFilesApi.preview.value.content"
      :truncated="workspaceFilesApi.preview.value.truncated"
      @close="workspaceFilesApi.closePreview()"
    />
    <!-- toast stack for the showNotification frontend tool -->
    <div class="toast-stack" aria-live="polite">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="`toast-${t.type}`">
        <strong>{{ t.title }}</strong>
        <p>{{ t.message }}</p>
      </div>
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

.app-shell { display: flex; height: 100%; }
.page { display: flex; flex-direction: column; height: 100%; flex: 1; min-width: 0; }

/* ---- P29: 主导航 rail（窄 icon 栏） ---- */
.nav-rail {
  width: 60px;
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 0;
  background: #ffffff;
  border-right: 1px solid var(--border);
}
.rail-logo {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: linear-gradient(135deg, #6366f1, #818cf8);
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 2px rgba(99, 102, 241, 0.35);
  margin-bottom: 10px;
}
.rail-btn {
  width: 44px;
  padding: 7px 0 6px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: #6b7280;
  font-size: 11px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.rail-btn:hover { background: var(--muted); color: #374151; }
.rail-btn[aria-current='page'] {
  background: #eef2ff;
  color: #4338ca;
  font-weight: 600;
}

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
.branch-open {
  font-size: 12.5px;
  font-weight: 600;
  color: #6d28d9;
  background: #f5f3ff;
  border: 1px solid #ddd6fe;
  border-radius: 999px;
  padding: 4px 12px;
  cursor: pointer;
  white-space: nowrap;
}
.branch-open:hover:not(:disabled) { background: #ede9fe; }
.branch-open:disabled { opacity: 0.45; cursor: not-allowed; }
@media (max-width: 720px) { .branch-open { display: none; } }
.context-badge {
  color: #047857;
  background: #ecfdf5;
  border-color: #a7f3d0;
  font-variant-numeric: tabular-nums;
}
/* P-K: 接近上限的级别色 */
.context-badge.level-amber { color: #b45309; background: #fffbeb; border-color: #fde68a; }
.context-badge.level-red { color: #b91c1c; background: #fef2f2; border-color: #fecaca; }
.tokens-badge {
  color: #0369a1;
  background: #f0f9ff;
  border-color: #bae6fd;
  font-variant-numeric: tabular-nums;
}
/* P-I: 离线徽章(琥珀呼吸点) */
.offline-badge {
  color: #b45309;
  background: #fffbeb;
  border-color: #fde68a;
  animation: offline-pulse 1.6s ease-in-out infinite;
}
@keyframes offline-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
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
  /* 2026-08-17: 卡片外框不再设 max-width,随窗口自适应铺满(用户明确要求);
     对话内容可读性上限由 fork CopilotChatView 的 cpk:max-w-5xl(64rem)居中约束 */
  display: flex;
  flex-direction: column;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: calc(var(--radius) + 4px);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06), 0 8px 24px rgba(15, 23, 42, 0.04);
  overflow: hidden;
}
.chat { flex: 1; min-height: 0; min-width: 0; }
/* P29: 能力主视图 —— 比聊天列更宽的工作画布 */
/* 2026-08-17: 能力页/文件页工作画布去掉 max-width 上限(原 72rem 钉死),
   随窗口自适应铺满 —— 文件表格/能力卡片需要宽画布 */
.caps-card {
  flex: 1;
  min-height: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: calc(var(--radius) + 4px);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06), 0 8px 24px rgba(15, 23, 42, 0.04);
  overflow: auto;
}
.chat-layout { flex: 1; min-height: 0; display: flex; }
/* 布局分栏：中央 A2UI 工作区 + 右侧窄对话栏（仅宽屏出现；窄屏不渲染，天然单栏） */
.a2ui-workspace-shell {
  flex: 1; min-width: 0; min-height: 0;
  border-right: 1px solid var(--border);
  background: #f8fafc;
  border-radius: calc(var(--radius) + 4px) 0 0 calc(var(--radius) + 4px);
  overflow: hidden;
}
.chat-col-narrow { flex: 0 1 400px; min-width: 340px; }
/* P-R: 切换会话骨架屏 */
.thread-skeleton {
  position: absolute;
  inset: 0;
  z-index: 15;
  background: #ffffff;
  padding: 28px 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.sk-row { display: flex; }
.sk-row.sk-right { justify-content: flex-end; }
.sk-bubble { border-radius: 14px; }
.sk-left .sk-bubble { width: 46%; height: 52px; }
.sk-right .sk-bubble { width: 34%; height: 40px; }
.sk-row.sk-left:last-child .sk-bubble { width: 58%; height: 64px; }

/* P-B: 聊天列容器(相对定位,承载内联错误卡悬浮层) */
.chat-col { flex: 1; min-height: 0; min-width: 0; display: flex; position: relative; }
.run-error-overlay {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: 92px;
  width: min(520px, calc(100% - 32px));
  z-index: 20;
}

/* ---- 需求4: 侧边栏折叠/抽屉 ---- */
/* task5-A: 会话/文件 Tab 容器承载原 .sidebar 的栏位样式 */
.sidebar-shell {
  width: 240px;
  flex: none;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border-right: 1px solid var(--border);
  min-height: 0;
}
.sidebar-shell .sidebar { width: auto; border-right: none; flex: 1; min-height: 0; }
.sidebar-tabs { display: flex; gap: 6px; padding: 10px 14px 4px; }
.sidebar-tabs button {
  flex: 1; font-size: 12.5px; padding: 5px 0; cursor: pointer;
  border: 1px solid var(--border); border-radius: 8px; background: #fff; color: #6b7280;
}
.sidebar-tabs button.on { background: #eef2ff; color: #4338ca; border-color: #e0e7ff; font-weight: 600; }
.sidebar-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  color: #4b5563;
  font-size: 15px;
  cursor: pointer;
  margin-right: 4px;
  transition: background 0.15s ease;
}
.sidebar-toggle:hover { background: var(--muted); }
.chat-layout { position: relative; }
.drawer-enter-active, .drawer-leave-active { transition: transform 0.2s ease, opacity 0.2s ease; }
.drawer-enter-from, .drawer-leave-to { transform: translateX(-12px); opacity: 0; }
.drawer-backdrop { display: none; }

@media (max-width: 720px) {
  .chat-layout .sidebar-shell {
    position: absolute;
    left: 0; top: 0; bottom: 0;
    z-index: 30;
    box-shadow: 4px 0 24px rgba(15, 23, 42, 0.12);
  }
  .chat-layout .drawer-backdrop {
    display: block;
    position: absolute;
    inset: 0;
    z-index: 25;
    background: rgba(15, 23, 42, 0.35);
  }
}

/* ---- 需求4: A2UI 卡片悬停阴影过渡 ---- */
.da-card {
  transition: box-shadow 0.18s ease, transform 0.18s ease;
}
.da-card:hover {
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.10), 0 1px 3px rgba(15, 23, 42, 0.06);
  transform: translateY(-1px);
}

/* ---- 需求4: 空会话欢迎页 ---- */
.welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 48px 24px 32px;
  min-height: 100%;
}
.welcome-input {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 640px;
  margin-top: 28px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 8px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
}
.welcome-input.drag-over { border-color: var(--accent); box-shadow: 0 0 0 3px var(--ring); }
.welcome-input-row { display: flex; gap: 8px; align-items: center; }
.welcome-attach {
  flex: none;
  width: 34px;
  height: 34px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  font-size: 15px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.welcome-attach:hover:not(:disabled) { background: var(--muted); }
.welcome-attach:disabled { opacity: 0.45; cursor: not-allowed; }
.welcome-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 2px 4px 0; }
.welcome-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--foreground);
  background: var(--muted);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 4px 8px 4px 10px;
}
.welcome-chip[data-status='error'] { border-color: #fecaca; background: #fef2f2; }
.chip-name.clickable { cursor: pointer; }
.chip-name.clickable:hover { text-decoration: underline; text-underline-offset: 2px; }

/* 多模态预览: 消息附件可点击提示（fork 渲染 DOM,App 级委托接管点击） */
.chat-col img[data-testid='copilot-chat-attachment-renderer-image'] { cursor: zoom-in; }
.chat-col [data-testid='copilot-chat-attachment-renderer-document'] { cursor: pointer; }
.chip-status { color: var(--muted-foreground); font-size: 11.5px; }
.chip-status.err { color: #dc2626; }
.chip-remove {
  border: none;
  background: transparent;
  color: var(--muted-foreground);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  padding: 0 2px;
}
.chip-remove:hover { color: #dc2626; }
.welcome-input:focus-within { border-color: #c7d2fe; box-shadow: 0 0 0 3px var(--ring); }
.welcome-input textarea {
  flex: 1;
  border: none;
  outline: none;
  resize: none;
  font-size: 14px;
  padding: 8px 10px;
  font-family: inherit;
  color: var(--foreground);
}
.welcome-send {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 8px 18px;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease;
}
.welcome-send:hover:not(:disabled) { background: #4f46e5; }
.welcome-send:disabled { opacity: 0.45; cursor: not-allowed; }
.welcome-logo {
  width: 64px;
  height: 64px;
  border-radius: 18px;
  background: linear-gradient(135deg, #6366f1, #818cf8);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 24px rgba(99, 102, 241, 0.35);
  margin-bottom: 20px;
}
.welcome h2 { font-size: 20px; margin: 0 0 8px; color: #111827; letter-spacing: -0.01em; }
.welcome-sub { font-size: 14px; color: var(--muted-foreground); margin: 0 0 28px; }
.welcome-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  width: 100%;
  max-width: 640px;
}
.welcome-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: left;
  padding: 16px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 12px;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}
.welcome-card:hover {
  border-color: #c7d2fe;
  box-shadow: 0 4px 14px rgba(99, 102, 241, 0.12);
  transform: translateY(-2px);
}
.welcome-card strong { font-size: 14px; color: #111827; }
.welcome-card span { font-size: 12.5px; color: var(--muted-foreground); }
/* P-E: 模板卡高亮态 */
.welcome-card.card-active {
  border-color: var(--accent);
  background: #eef2ff;
  box-shadow: 0 0 0 3px var(--ring);
}
/* P-E: 一键清空按钮 */
.welcome-clear {
  flex: none;
  align-self: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #9ca3af;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.welcome-clear:hover { background: #fef2f2; color: #ef4444; }

/* ---- shimmer 加载动画（suggestion/加载占位通用） ---- */
@keyframes shimmer {
  0% { background-position: -400px 0; }
  100% { background-position: 400px 0; }
}
.shimmer {
  background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%);
  background-size: 400px 100%;
  animation: shimmer 1.2s infinite linear;
}

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
