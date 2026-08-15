<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { ThreadMeta } from '../composables/useThreads'

/**
 * 需求1/F2: 会话侧边栏 —— 列表（标题取首条用户消息截断，gateway 侧生成）、
 * 新建、切换、删除、重命名（双击标题）。
 * F2: 删除确认 / 重命名均为自绘 modal（Teleported 到 body），ESC/遮罩关闭，
 * 不再使用原生 confirm/prompt。
 * P7: 搜索过滤（标题子序列模糊匹配）+ 置顶（pin 排最前，localStorage 持久化，
 * 纯表现层状态 —— 与网关线程数据无关，故不入库）。
 */
const props = defineProps<{
  threads: ThreadMeta[]
  currentId: string
}>()

// ---- P7: 搜索过滤 ----
const search = ref('')

/** 子序列模糊匹配（大小写不敏感；中文字符逐字匹配）。 */
function fuzzyMatch(title: string, query: string): boolean {
  const t = title.toLowerCase()
  const q = query.toLowerCase()
  let i = 0
  for (const ch of t) {
    if (ch === q[i]) i++
    if (i >= q.length) return true
  }
  return q.length === 0
}

// ---- P7: 置顶（localStorage 持久化）----
const PIN_KEY = 'dataagent.pinnedThreads'
function loadPinned(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(PIN_KEY) ?? '[]')
    return new Set(Array.isArray(raw) ? raw : [])
  } catch {
    return new Set()
  }
}
const pinned = ref<Set<string>>(loadPinned())

function togglePin(t: ThreadMeta) {
  const next = new Set(pinned.value)
  if (next.has(t.id)) next.delete(t.id)
  else next.add(t.id)
  pinned.value = next
  try {
    localStorage.setItem(PIN_KEY, JSON.stringify([...next]))
  } catch { /* localStorage 不可用时静默降级为会话内状态 */ }
}

/** 过滤 + 置顶排序后的可见列表（sort 稳定，同级保持原相对顺序）。 */
const visibleThreads = computed(() => {
  const q = search.value.trim()
  const filtered = q ? props.threads.filter((t) => fuzzyMatch(t.title, q)) : props.threads
  return [...filtered].sort((a, b) => Number(pinned.value.has(b.id)) - Number(pinned.value.has(a.id)))
})

// ---- P-G: 归档(localStorage 持久化,纯表现层,与网关数据无关) ----
const ARCHIVE_KEY = 'dataagent.archivedThreads'
function loadArchived(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(ARCHIVE_KEY) ?? '[]')
    return new Set(Array.isArray(raw) ? raw : [])
  } catch {
    return new Set()
  }
}
const archived = ref<Set<string>>(loadArchived())
/** 归档区折叠态(默认折叠,会话内状态不持久化) */
const archiveOpen = ref(false)

function toggleArchive(t: ThreadMeta) {
  const next = new Set(archived.value)
  if (next.has(t.id)) next.delete(t.id)
  else next.add(t.id)
  archived.value = next
  try {
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify([...next]))
  } catch { /* localStorage 不可用时静默降级 */ }
}

/** 主列表 = 可见列表去掉已归档;归档区继承同一搜索过滤。 */
const activeThreads = computed(() => visibleThreads.value.filter((t) => !archived.value.has(t.id)))
const archivedThreads = computed(() => visibleThreads.value.filter((t) => archived.value.has(t.id)))

// ---- P-H: 多选批量操作(批量归档复用 P-G 语义;批量删除走确认 modal) ----
const selectMode = ref(false)
const selected = ref<Set<string>>(new Set())

function toggleSelectMode() {
  selectMode.value = !selectMode.value
  selected.value = new Set()
}
function toggleSelect(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}
const allSelected = computed(
  () => activeThreads.value.length > 0 && activeThreads.value.every((t) => selected.value.has(t.id)),
)
function toggleSelectAll() {
  selected.value = allSelected.value
    ? new Set()
    : new Set(activeThreads.value.map((t) => t.id))
}
/** 多选模式下点行 = 切换选中;普通模式 = 切换会话。 */
function onRowClick(t: ThreadMeta) {
  if (selectMode.value) {
    toggleSelect(t.id)
    return
  }
  emit('switch', t.id)
}
function batchArchive() {
  if (selected.value.size === 0) return
  const next = new Set(archived.value)
  for (const id of selected.value) next.add(id)
  archived.value = next
  try {
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify([...next]))
  } catch { /* 静默降级 */ }
  selectMode.value = false
  selected.value = new Set()
}
function requestBatchRemove() {
  if (selected.value.size === 0) return
  dialog.value = { kind: 'batch-remove', ids: [...selected.value] }
  void nextTick(() => overlayEl.value?.focus())
}

const emit = defineEmits<{
  (e: 'new'): void
  (e: 'switch', id: string): void
  (e: 'remove', id: string): void
  (e: 'rename', id: string, title: string): void
  (e: 'export', id: string): void
}>()

type DialogState =
  | { kind: 'remove'; thread: ThreadMeta }
  | { kind: 'rename'; thread: ThreadMeta }
  | { kind: 'batch-remove'; ids: string[] }
  | null

const dialog = ref<DialogState>(null)
const renameDraft = ref('')
const renameInput = ref<HTMLInputElement | null>(null)
const overlayEl = ref<HTMLElement | null>(null)

function startRename(t: ThreadMeta) {
  renameDraft.value = t.title
  dialog.value = { kind: 'rename', thread: t }
  void nextTick(() => {
    renameInput.value?.focus()
    renameInput.value?.select()
  })
}

function confirmRemove(t: ThreadMeta) {
  dialog.value = { kind: 'remove', thread: t }
  // 焦点移到遮罩,ESC 才能冒泡到关闭处理器(删除按钮在 body 外,焦点不会自动进来)
  void nextTick(() => overlayEl.value?.focus())
}

function closeDialog() {
  dialog.value = null
}

function submitDialog() {
  const d = dialog.value
  if (!d) return
  if (d.kind === 'remove') {
    emit('remove', d.thread.id)
  } else if (d.kind === 'batch-remove') {
    for (const id of d.ids) emit('remove', id)
    // 批量删除确认后退出多选
    selectMode.value = false
    selected.value = new Set()
  } else {
    const title = renameDraft.value.trim()
    if (title && title !== d.thread.title) {
      emit('rename', d.thread.id, title)
    }
  }
  closeDialog()
}

const renameInvalid = () => !renameDraft.value.trim()
</script>

<template>
  <aside class="sidebar" data-testid="thread-sidebar">
    <div class="sidebar-head">
      <span class="sidebar-title">会话</span>
      <span class="head-actions">
        <button
          class="new-btn"
          :class="{ on: selectMode }"
          data-testid="multiselect-toggle"
          title="多选批量操作"
          @click="toggleSelectMode"
        >☑ 多选</button>
        <button class="new-btn" data-testid="new-thread" title="新建会话" @click="emit('new')">+ 新建</button>
      </span>
    </div>
    <!-- P7: 搜索过滤 -->
    <div class="search-wrap">
      <input
        v-model="search"
        class="search-input"
        data-testid="thread-search"
        placeholder="搜索会话标题…"
      />
    </div>
    <!-- P-H: 多选批量操作栏 -->
    <div v-if="selectMode" class="bulk-bar" data-testid="bulk-bar">
      <button class="bulk-btn" data-testid="bulk-select-all" @click="toggleSelectAll">
        {{ allSelected ? '全不选' : '全选' }}
      </button>
      <span class="bulk-count" data-testid="bulk-count">已选 {{ selected.size }} 项</span>
      <button
        class="bulk-btn"
        data-testid="bulk-archive"
        :disabled="selected.size === 0"
        @click="batchArchive"
      >归档</button>
      <button
        class="bulk-btn danger"
        data-testid="bulk-delete"
        :disabled="selected.size === 0"
        @click="requestBatchRemove"
      >删除</button>
      <button class="bulk-btn" data-testid="bulk-cancel" @click="toggleSelectMode">取消</button>
    </div>
    <div class="thread-list">
      <div
        v-for="t in activeThreads"
        :key="t.id"
        class="thread-item"
        :class="{ active: t.id === currentId, pinned: pinned.has(t.id), selecting: selectMode }"
        :data-thread-id="t.id"
        @click="onRowClick(t)"
        @dblclick="startRename(t)"
      >
        <input
          v-if="selectMode"
          type="checkbox"
          class="select-box"
          :data-testid="`select-${t.id}`"
          :checked="selected.has(t.id)"
          @click.stop="toggleSelect(t.id)"
        />
        <span class="thread-title" :title="t.title">{{ t.title }}</span>
        <template v-if="!selectMode">
          <button
            class="icon-btn pin-btn"
            :class="{ on: pinned.has(t.id) }"
            :data-testid="`pin-${t.id}`"
            :title="pinned.has(t.id) ? '取消置顶' : '置顶'"
            @click.stop="togglePin(t)"
          >📌</button>
          <button
            class="icon-btn archive-btn"
            :data-testid="`archive-${t.id}`"
            title="归档会话(移入底部归档区)"
            @click.stop="toggleArchive(t)"
          >📥</button>
          <button
            class="icon-btn export-btn"
            :data-testid="`export-${t.id}`"
            title="导出会话为 Markdown"
            @click.stop="emit('export', t.id)"
          >⤓</button>
          <button
            class="icon-btn del-btn"
            :data-testid="`del-${t.id}`"
            title="删除会话"
            @click.stop="confirmRemove(t)"
          >×</button>
        </template>
      </div>
      <div v-if="threads.length === 0" class="empty">暂无会话</div>
      <div v-else-if="activeThreads.length === 0 && archivedThreads.length === 0" class="empty">无匹配会话</div>
    </div>

    <!-- P-G: 归档折叠区(默认折叠,钉在侧边栏底部) -->
    <div v-if="archivedThreads.length > 0" class="archive-section">
      <button
        class="archive-toggle"
        data-testid="archive-toggle"
        :aria-expanded="archiveOpen"
        @click="archiveOpen = !archiveOpen"
      >
        <span class="chev">{{ archiveOpen ? '▾' : '▸' }}</span> 已归档 · {{ archivedThreads.length }}
      </button>
      <div v-show="archiveOpen" class="archive-list" data-testid="archive-list">
        <div
          v-for="t in archivedThreads"
          :key="t.id"
          class="thread-item archived"
          :class="{ active: t.id === currentId }"
          :data-thread-id="t.id"
          @click="emit('switch', t.id)"
          @dblclick="startRename(t)"
        >
          <span class="thread-title" :title="t.title">{{ t.title }}</span>
          <button
            class="icon-btn unarchive-btn"
            :data-testid="`unarchive-${t.id}`"
            title="取消归档"
            @click.stop="toggleArchive(t)"
          >📤</button>
          <button
            class="icon-btn export-btn"
            :data-testid="`export-${t.id}`"
            title="导出会话为 Markdown"
            @click.stop="emit('export', t.id)"
          >⤓</button>
          <button
            class="icon-btn del-btn"
            :data-testid="`del-${t.id}`"
            title="删除会话"
            @click.stop="confirmRemove(t)"
          >×</button>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="dialog"
        ref="overlayEl"
        class="dlg-overlay"
        data-testid="dialog-overlay"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        @click.self="closeDialog"
        @keydown.esc="closeDialog"
      >
        <div class="dlg-card" data-testid="thread-dialog">
          <template v-if="dialog.kind === 'remove'">
            <h3 class="dlg-title">删除会话</h3>
            <p class="dlg-body">
              删除会话「{{ dialog.thread.title }}」？该会话的消息记录与工作目录将一并删除，此操作不可撤销。
            </p>
            <div class="dlg-actions">
              <button class="dlg-btn" data-testid="dialog-cancel" @click="closeDialog">取消</button>
              <button class="dlg-btn danger" data-testid="dialog-confirm" @click="submitDialog">删除</button>
            </div>
          </template>
          <template v-else-if="dialog.kind === 'batch-remove'">
            <h3 class="dlg-title">批量删除会话</h3>
            <p class="dlg-body">
              删除选中的 {{ dialog.ids.length }} 个会话？这些会话的消息记录与工作目录将一并删除，此操作不可撤销。
            </p>
            <div class="dlg-actions">
              <button class="dlg-btn" data-testid="dialog-cancel" @click="closeDialog">取消</button>
              <button class="dlg-btn danger" data-testid="dialog-confirm" @click="submitDialog">删除</button>
            </div>
          </template>
          <template v-else>
            <h3 class="dlg-title">重命名会话</h3>
            <input
              ref="renameInput"
              v-model="renameDraft"
              class="dlg-input"
              maxlength="60"
              placeholder="输入新标题"
              @keydown.enter.prevent="!renameInvalid() && submitDialog()"
            />
            <div class="dlg-actions">
              <button class="dlg-btn" data-testid="dialog-cancel" @click="closeDialog">取消</button>
              <button
                class="dlg-btn primary"
                data-testid="dialog-confirm"
                :disabled="renameInvalid()"
                @click="submitDialog"
              >确定</button>
            </div>
          </template>
        </div>
      </div>
    </Teleport>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 240px;
  flex: none;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border-right: 1px solid var(--border, #e5e7eb);
  min-height: 0;
}
.sidebar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 14px 10px;
}
.sidebar-title { font-size: 13px; font-weight: 600; color: #6b7280; }
.new-btn {
  font-size: 12.5px;
  color: #4338ca;
  background: #eef2ff;
  border: 1px solid #e0e7ff;
  border-radius: 8px;
  padding: 5px 10px;
  cursor: pointer;
}
.new-btn:hover { background: #e0e7ff; }
.head-actions { display: flex; gap: 6px; }
.new-btn.on { background: #4338ca; color: #ffffff; border-color: #4338ca; }

/* ---- P-H: 多选批量操作 ---- */
.bulk-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 14px 8px;
  flex-wrap: wrap;
}
.bulk-btn {
  font-size: 11.5px;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 7px;
  border: 1px solid var(--border, #e5e7eb);
  background: #ffffff;
  color: #4b5563;
  cursor: pointer;
}
.bulk-btn:hover:not(:disabled) { background: #f1f5f9; }
.bulk-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.bulk-btn.danger { color: #ef4444; border-color: #fecaca; }
.bulk-btn.danger:hover:not(:disabled) { background: #fef2f2; }
.bulk-count { flex: 1; text-align: center; font-size: 11.5px; color: #6b7280; white-space: nowrap; }
.select-box { flex: none; accent-color: #6366f1; cursor: pointer; }
.thread-item.selecting { user-select: none; }
.thread-list { flex: 1; overflow-y: auto; padding: 0 8px 12px; }
.thread-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 10px;
  margin-bottom: 2px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  color: #374151;
}
.thread-item:hover { background: #f1f5f9; }
.thread-item.active { background: #eef2ff; color: #4338ca; font-weight: 600; }
.thread-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.icon-btn {
  opacity: 0;
  border: none;
  background: transparent;
  color: #9ca3af;
  font-size: 15px;
  cursor: pointer;
  border-radius: 6px;
  padding: 0 5px;
  line-height: 1.4;
}
.thread-item:hover .icon-btn { opacity: 1; }
/* P7: 搜索框 + 置顶 */
.search-wrap { padding: 0 14px 8px; }
.search-input {
  width: 100%;
  font-size: 12.5px;
  padding: 6px 10px;
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 8px;
  outline: none;
  color: #374151;
  background: #f8fafc;
  box-sizing: border-box;
}
.search-input:focus { border-color: #c7d2fe; box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.18); background: #fff; }
.pin-btn { font-size: 12px; }
.pin-btn.on { opacity: 1; color: #6366f1; }
.thread-item.pinned .thread-title { font-weight: 600; }
.export-btn { font-size: 13px; }
.export-btn:hover { color: #6366f1; background: #eef2ff; }
.del-btn:hover { color: #ef4444; background: #fef2f2; }
.empty { padding: 20px; text-align: center; color: #9ca3af; font-size: 12.5px; }

/* ---- P-G: 归档折叠区 ---- */
.archive-section {
  flex: none;
  border-top: 1px solid var(--border, #e5e7eb);
  padding: 6px 8px 10px;
}
.archive-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  border: none;
  background: transparent;
  font-size: 12px;
  font-weight: 600;
  color: #6b7280;
  padding: 6px 8px;
  cursor: pointer;
  border-radius: 8px;
  text-align: left;
}
.archive-toggle:hover { background: #f1f5f9; }
.archive-toggle .chev { font-size: 10px; color: #9ca3af; }
.archive-list { max-height: 180px; overflow-y: auto; }
.thread-item.archived { color: #6b7280; }
.thread-item.archived .thread-title { font-style: normal; opacity: 0.85; }
.archive-btn:hover { color: #4338ca; background: #eef2ff; }
.unarchive-btn:hover { color: #4338ca; background: #eef2ff; }

/* ---- F2: 自绘 modal(scoped 样式经 :deep 不适用 Teleport,故用全局类名但加 dlg- 前缀避免冲突) ---- */
</style>

<!-- Teleport 到 body 后 scoped 样式依然生效(vue 会把 data-v 属性带到 teleported 节点) -->
<style scoped>
.dlg-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(15, 23, 42, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: dlg-fade 140ms ease-out;
}
.dlg-card {
  width: 360px;
  max-width: calc(100vw - 48px);
  background: #ffffff;
  border-radius: 14px;
  box-shadow: 0 12px 40px rgba(15, 23, 42, 0.22);
  padding: 20px;
  animation: dlg-pop 160ms ease-out;
}
.dlg-title { margin: 0 0 10px; font-size: 15px; font-weight: 700; color: #111827; }
.dlg-body { margin: 0; font-size: 13px; line-height: 1.6; color: #4b5563; }
.dlg-input {
  width: 100%;
  font-size: 13.5px;
  padding: 8px 10px;
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 8px;
  outline: none;
  color: #374151;
}
.dlg-input:focus { border-color: #c7d2fe; box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.18); }
.dlg-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.dlg-btn {
  font-size: 13px;
  font-weight: 600;
  padding: 7px 16px;
  border-radius: 8px;
  border: 1px solid var(--border, #e5e7eb);
  background: #ffffff;
  color: #374151;
  cursor: pointer;
  transition: background 0.15s ease;
}
.dlg-btn:hover { background: #f1f5f9; }
.dlg-btn.primary { background: #6366f1; border-color: #6366f1; color: #ffffff; }
.dlg-btn.primary:hover:not(:disabled) { background: #4f46e5; }
.dlg-btn.primary:disabled { opacity: 0.45; cursor: not-allowed; }
.dlg-btn.danger { background: #ef4444; border-color: #ef4444; color: #ffffff; }
.dlg-btn.danger:hover { background: #dc2626; }
@keyframes dlg-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes dlg-pop {
  from { opacity: 0; transform: translateY(6px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
</style>
