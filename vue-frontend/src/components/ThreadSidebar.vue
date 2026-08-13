<script setup lang="ts">
import type { ThreadMeta } from '../composables/useThreads'

/**
 * 需求1: 会话侧边栏 —— 列表（标题取首条用户消息截断，gateway 侧生成）、
 * 新建、切换、删除、重命名（双击标题）。
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
}>()

function startRename(t: ThreadMeta) {
  const title = window.prompt('重命名会话', t.title)
  if (title && title.trim() && title.trim() !== t.title) {
    emit('rename', t.id, title.trim())
  }
}

function confirmRemove(t: ThreadMeta) {
  if (window.confirm(`删除会话「${t.title}」？此操作不可撤销。`)) {
    emit('remove', t.id)
  }
}
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
          class="del-btn"
          :data-testid="`del-${t.id}`"
          title="删除会话"
          @click.stop="confirmRemove(t)"
        >×</button>
      </div>
      <div v-if="threads.length === 0" class="empty">暂无会话</div>
    </div>
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
.del-btn {
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
.thread-item:hover .del-btn { opacity: 1; }
.del-btn:hover { color: #ef4444; background: #fef2f2; }
.empty { padding: 20px; text-align: center; color: #9ca3af; font-size: 12.5px; }
</style>
