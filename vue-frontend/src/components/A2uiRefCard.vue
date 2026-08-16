<script setup lang="ts">
/**
 * 布局分栏：对话栏内的 A2UI 紧凑引用卡。
 * A2UI 产物渲染在中央工作区，对话流里只留这张卡；点击/Enter → 中央区定位。
 */
const props = defineProps<{
  messageId: string
  surfaceIds: string[]
  componentCount: number
}>()

const emit = defineEmits<{ locate: [messageId: string] }>()
</script>

<template>
  <div
    class="a2ui-ref-card"
    data-testid="a2ui-ref-card"
    role="button"
    tabindex="0"
    title="点击在中央工作区定位该看板"
    @click="emit('locate', props.messageId)"
    @keydown.enter="emit('locate', props.messageId)"
  >
    <span class="a2ui-ref-icon">🎨</span>
    <span class="a2ui-ref-text">
      <strong>UI 看板 · {{ props.surfaceIds[0] ?? 'surface' }}</strong>
      <small>{{ props.surfaceIds.length }} 个 surface · {{ props.componentCount }} 个组件 · 见中央工作区 →</small>
    </span>
  </div>
</template>

<style scoped>
.a2ui-ref-card {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0;
  padding: 8px 12px;
  border: 1px dashed #c7d2fe;
  border-radius: 10px;
  background: #f5f7ff;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.a2ui-ref-card:hover,
.a2ui-ref-card:focus-visible {
  background: #eef2ff;
  border-color: #818cf8;
  outline: none;
}
.a2ui-ref-icon {
  font-size: 15px;
}
.a2ui-ref-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.a2ui-ref-text strong {
  font-size: 12px;
  color: #4338ca;
}
.a2ui-ref-text small {
  font-size: 11px;
  color: #6b7280;
}
</style>
