<script setup lang="ts">
/**
 * P-B: run 失败/中断的内联错误卡（消息流尾部上方悬浮）。
 * 原因 + 重试按钮（重发最后一条用户消息）+ 关闭；不用任何原生弹窗。
 */
defineProps<{
  message: string
  busy?: boolean
}>()

const emit = defineEmits<{
  (e: 'retry'): void
  (e: 'dismiss'): void
}>()
</script>

<template>
  <div class="run-error-card" data-testid="run-error-card" role="alert">
    <span class="rec-icon" aria-hidden="true">⚠️</span>
    <div class="rec-body">
      <strong>运行中断</strong>
      <p data-testid="run-error-message">{{ message }}</p>
    </div>
    <button
      class="rec-retry"
      data-testid="run-error-retry"
      :disabled="busy"
      @click="emit('retry')"
    >{{ busy ? '重试中…' : '重试' }}</button>
    <button class="rec-dismiss" data-testid="run-error-dismiss" aria-label="关闭错误提示" @click="emit('dismiss')">×</button>
  </div>
</template>

<style scoped>
.run-error-card {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #fffbfb;
  border: 1px solid #fecaca;
  border-left: 4px solid #ef4444;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.14);
  padding: 12px 14px;
  animation: rec-in 180ms ease-out;
}
.rec-icon { font-size: 16px; flex: none; }
.rec-body { flex: 1; min-width: 0; }
.rec-body strong { display: block; font-size: 13px; color: #991b1b; }
.rec-body p {
  margin: 2px 0 0;
  font-size: 12.5px;
  color: #6b7280;
  line-height: 1.45;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.rec-retry {
  flex: none;
  font-size: 12.5px;
  font-weight: 600;
  color: #ffffff;
  background: #ef4444;
  border: none;
  border-radius: 8px;
  padding: 7px 14px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.rec-retry:hover:not(:disabled) { background: #dc2626; }
.rec-retry:disabled { opacity: 0.55; cursor: not-allowed; }
.rec-dismiss {
  flex: none;
  border: none;
  background: transparent;
  color: #9ca3af;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  border-radius: 6px;
  padding: 2px 5px;
}
.rec-dismiss:hover { color: #ef4444; background: #fef2f2; }
@keyframes rec-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
