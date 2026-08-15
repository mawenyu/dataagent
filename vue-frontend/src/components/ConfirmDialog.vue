<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { trapTabKey } from '../composables/focusTrap'

/**
 * P1: 通用确认弹窗（替代原生 confirm）。Promise 化用法见 App.vue askConfirm。
 * Teleport body / Esc=取消 / 遮罩点击=取消 / Tab 焦点圈定 / aria 全套。
 */
const props = withDefaults(defineProps<{
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}>(), {
  confirmLabel: '确定',
  cancelLabel: '取消',
  danger: false,
})

const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()

const overlayEl = ref<HTMLElement | null>(null)
const cardEl = ref<HTMLElement | null>(null)
watch(
  () => props.message,
  () => nextTick(() => overlayEl.value?.focus()),
  { immediate: true },
)

function onOverlayKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('cancel')
    return
  }
  if (e.key === 'Tab' && cardEl.value) {
    trapTabKey(e, cardEl.value)
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      ref="overlayEl"
      class="cf-overlay"
      data-testid="confirm-overlay"
      tabindex="-1"
      @click.self="emit('cancel')"
      @keydown="onOverlayKeydown"
    >
      <div
        ref="cardEl"
        class="cf-card"
        data-testid="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        :aria-label="title"
      >
        <h3 class="cf-title">{{ title }}</h3>
        <p class="cf-body" data-testid="confirm-message">{{ message }}</p>
        <div class="cf-actions">
          <button class="cf-btn" data-testid="confirm-cancel" @click="emit('cancel')">{{ cancelLabel }}</button>
          <button
            class="cf-btn"
            :class="danger ? 'danger' : 'primary'"
            data-testid="confirm-ok"
            @click="emit('confirm')"
          >{{ confirmLabel }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cf-overlay {
  position: fixed;
  inset: 0;
  z-index: 1300;
  background: rgba(15, 23, 42, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: cf-fade 140ms ease-out;
}
.cf-card {
  width: 400px;
  max-width: calc(100vw - 48px);
  background: #ffffff;
  border-radius: 14px;
  box-shadow: 0 12px 40px rgba(15, 23, 42, 0.22);
  padding: 20px;
  animation: cf-pop 160ms ease-out;
}
.cf-title { margin: 0 0 10px; font-size: 15px; font-weight: 700; color: #111827; }
.cf-body { margin: 0; font-size: 13px; line-height: 1.6; color: #4b5563; white-space: pre-wrap; }
.cf-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.cf-btn {
  font-size: 13px; font-weight: 600; padding: 7px 16px; border-radius: 8px;
  border: 1px solid var(--border, #e5e7eb); background: #ffffff; color: #374151; cursor: pointer;
}
.cf-btn:hover { background: #f1f5f9; }
.cf-btn.primary { background: #6366f1; border-color: #6366f1; color: #ffffff; }
.cf-btn.primary:hover { background: #4f46e5; }
.cf-btn.danger { background: #ef4444; border-color: #ef4444; color: #ffffff; }
.cf-btn.danger:hover { background: #dc2626; }
@keyframes cf-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes cf-pop {
  from { opacity: 0; transform: translateY(6px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
</style>
