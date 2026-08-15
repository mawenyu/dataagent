<script setup lang="ts">
import { nextTick, ref } from 'vue'
import type { ThreadMeta } from '../composables/useThreads'

/**
 * 需求1/F2: 会话侧边栏 —— 列表（标题取首条用户消息截断，gateway 侧生成）、
 * 新建、切换、删除、重命名（双击标题）。
 * F2: 删除确认 / 重命名均为自绘 modal（Teleported 到 body），ESC/遮罩关闭，
 * 不再使用原生 confirm/prompt。
 */
defineProps<{
  threads: ThreadMeta[]
  currentId: string
}>()

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
      <button class="new-btn" data-testid="new-thread" title="新建会话" @click="emit('new')">+ 新建</button>
    </div>
    <div class="thread-list">
      <div
        v-for="t in threads"
        :key="t.id"
        class="thread-item"
        :class="{ active: t.id === currentId }"
        :data-thread-id="t.id"
        @click="emit('switch', t.id)"
        @dblclick="startRename(t)"
      >
        <span class="thread-title" :title="t.title">{{ t.title }}</span>
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
      <div v-if="threads.length === 0" class="empty">暂无会话</div>
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
.export-btn { font-size: 13px; }
.export-btn:hover { color: #6366f1; background: #eef2ff; }
.del-btn:hover { color: #ef4444; background: #fef2f2; }
.empty { padding: 20px; text-align: center; color: #9ca3af; font-size: 12.5px; }

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
