<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { trapTabKey } from '../composables/focusTrap'

/**
 * P-Q: 会话分叉 —— 从任意历史消息分叉新会话。
 * 列出当前会话的 user/assistant 消息,点选一条即以其为分叉点
 * (该消息之前的上下文复制为新会话起点,见 gateway /chat/threads/{id}/branch)。
 */
export interface BranchMessage {
  id: string
  role: string
  text: string
}

defineProps<{
  messages: BranchMessage[]
  busy?: boolean
}>()

const emit = defineEmits<{
  (e: 'select', messageId: string): void
  (e: 'close'): void
}>()

const overlayEl = ref<HTMLElement | null>(null)
const cardEl = ref<HTMLElement | null>(null)
onMounted(() => nextTick(() => overlayEl.value?.focus()))

function onOverlayKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('close')
    return
  }
  if (e.key === 'Tab' && cardEl.value) {
    trapTabKey(e, cardEl.value)
  }
}

function preview(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > 80 ? oneLine.slice(0, 80) + '…' : oneLine
}
</script>

<template>
  <Teleport to="body">
    <div
      ref="overlayEl"
      class="br-overlay"
      data-testid="branch-overlay"
      tabindex="-1"
      @click.self="emit('close')"
      @keydown="onOverlayKeydown"
    >
      <div
        ref="cardEl"
        class="br-card"
        data-testid="branch-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="从消息分叉新会话"
      >
        <div class="br-head">
          <strong>从消息分叉</strong>
          <button class="br-close" data-testid="branch-close" aria-label="关闭" @click="emit('close')">×</button>
        </div>
        <p class="br-hint">选择一条消息，其之前的上下文将复制为新会话的起点（该消息本身不包含在内）</p>
        <div class="br-list" data-testid="branch-list">
          <button
            v-for="m in messages"
            :key="m.id"
            class="br-item"
            :data-testid="`branch-at-${m.id}`"
            :disabled="busy"
            @click="emit('select', m.id)"
          >
            <span class="br-role">{{ m.role === 'user' ? '👤' : '🤖' }}</span>
            <span class="br-text">{{ preview(m.text) }}</span>
            <span class="br-go">⑂</span>
          </button>
          <div v-if="messages.length === 0" class="br-empty">暂无可分叉的消息</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.br-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(15, 23, 42, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: br-fade 140ms ease-out;
}
.br-card {
  width: min(560px, calc(100vw - 48px));
  max-height: min(70vh, 600px);
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border-radius: 14px;
  box-shadow: 0 12px 40px rgba(15, 23, 42, 0.22);
  padding: 18px;
  animation: br-pop 160ms ease-out;
}
.br-head { display: flex; align-items: center; justify-content: space-between; }
.br-head strong { font-size: 15px; color: #111827; }
.br-close {
  border: none; background: transparent; color: #9ca3af; font-size: 18px;
  line-height: 1; cursor: pointer; border-radius: 6px; padding: 2px 7px;
}
.br-close:hover { color: #ef4444; background: #fef2f2; }
.br-hint { margin: 8px 0 10px; font-size: 12px; color: #9ca3af; line-height: 1.5; }
.br-list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
.br-item {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 10px;
  background: #ffffff;
  padding: 9px 12px;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.br-item:hover:not(:disabled) { border-color: #c7d2fe; background: #eef2ff; }
.br-item:disabled { opacity: 0.5; cursor: not-allowed; }
.br-role { flex: none; font-size: 13px; }
.br-text {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 12.5px; color: #374151;
}
.br-go { flex: none; color: #9ca3af; font-size: 13px; }
.br-item:hover:not(:disabled) .br-go { color: #4338ca; }
.br-empty { padding: 24px; text-align: center; color: #9ca3af; font-size: 12.5px; }
@keyframes br-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes br-pop {
  from { opacity: 0; transform: translateY(6px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
</style>
