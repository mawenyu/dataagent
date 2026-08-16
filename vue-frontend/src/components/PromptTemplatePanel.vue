<script setup lang="ts">
/**
 * P-b: 提示词模板 / 快捷指令面板（顶栏 ✨ 模板入口）。
 * 纯展示组件：open 控制显隐，select 携带模板对象上抛（发送逻辑在 App），
 * close 由关闭按钮/遮罩/Esc 触发。数据源唯一：composables/promptTemplates。
 */
import { computed, onBeforeUnmount, watch } from 'vue'
import { templatesByGroup, type PromptTemplate } from '../composables/promptTemplates'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'select', t: PromptTemplate): void
}>()

const groups = computed(() => [
  { name: '开场模板', items: templatesByGroup('开场') },
  { name: '追问指令', items: templatesByGroup('追问') },
])

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open) emit('close')
}
watch(() => props.open, (v) => {
  if (v) window.addEventListener('keydown', onKeydown)
  else window.removeEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="tpl-backdrop" data-testid="template-backdrop" @click="emit('close')" />
    <div
      v-if="open"
      class="tpl-panel"
      data-testid="template-panel"
      role="dialog"
      aria-label="提示词模板与快捷指令"
      tabindex="-1"
      @keydown.esc="emit('close')"
    >
      <div class="tpl-head">
        <span class="tpl-head-title">提示词模板 / 快捷指令</span>
        <button class="tpl-close" data-testid="template-close" title="关闭" @click="emit('close')">×</button>
      </div>
      <div v-for="g in groups" :key="g.name" class="tpl-group">
        <div class="tpl-group-name">{{ g.name }}</div>
        <button
          v-for="t in g.items"
          :key="t.id"
          class="tpl-item"
          :data-testid="`template-item-${t.id}`"
          :title="t.prompt"
          @click="emit('select', t)"
        >
          <span class="tpl-title">{{ t.title }}</span>
          <span class="tpl-desc">{{ t.desc }}</span>
        </button>
      </div>
      <p class="tpl-foot">开场模板填充输入框可编辑；追问指令直接发送到当前会话。</p>
    </div>
  </Teleport>
</template>

<style scoped>
.tpl-backdrop {
  position: fixed;
  inset: 0;
  z-index: 900;
  background: transparent;
}
.tpl-panel {
  position: fixed;
  top: 52px;
  right: 16px;
  z-index: 901;
  width: 280px;
  max-height: min(560px, calc(100vh - 80px));
  overflow-y: auto;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.14);
  padding: 10px 12px;
}
.tpl-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.tpl-head-title {
  font-size: 13px;
  font-weight: 600;
  color: #374151;
}
.tpl-close {
  border: none;
  background: none;
  font-size: 16px;
  cursor: pointer;
  color: #9ca3af;
  padding: 2px 6px;
  border-radius: 6px;
}
.tpl-close:hover {
  background: #f3f4f6;
  color: #374151;
}
.tpl-group-name {
  font-size: 11px;
  color: #9ca3af;
  margin: 8px 2px 4px;
}
.tpl-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  background: none;
  border-radius: 8px;
  padding: 7px 9px;
  cursor: pointer;
}
.tpl-item:hover,
.tpl-item:focus-visible {
  background: #f5f7ff;
  border-color: #e0e7ff;
}
.tpl-title {
  font-size: 13px;
  color: #1f2937;
  font-weight: 500;
}
.tpl-desc {
  font-size: 11px;
  color: #6b7280;
}
.tpl-foot {
  font-size: 11px;
  color: #9ca3af;
  margin: 10px 2px 2px;
}
</style>
