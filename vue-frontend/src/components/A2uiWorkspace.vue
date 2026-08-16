<script setup lang="ts">
import { computed, ref } from 'vue'
import { createA2UIMessageRenderer } from '@copilotkit/vue'
import { scanA2uiOps } from '../utils/a2uiOps'

/**
 * 布局分栏：中央 A2UI 工作区。
 * 每条 a2ui-surface activity 消息一个块（堆叠，多 surface 消息在块头列出
 * 全部 surfaceId）；对话栏引用卡 locate → 滚动定位 + 闪烁高亮。
 * 渲染本体复用 fork 的 createA2UIMessageRenderer（与对话内渲染同一管线）。
 */
const props = defineProps<{
  entries: Array<{ message: { id: string; content?: unknown } & Record<string, unknown> }>
  agent?: object
  catalog?: unknown
}>()

const a2ui = createA2UIMessageRenderer({ theme: {}, catalog: props.catalog as never })
const a2uiRenderer = a2ui.render

interface WorkspaceBlock {
  messageId: string
  surfaceIds: string[]
  componentCount: number
  message: Record<string, unknown>
}

const blocks = computed<WorkspaceBlock[]>(() =>
  props.entries.map((e) => {
    const ops = (e.message.content as { a2ui_operations?: unknown } | undefined)?.a2ui_operations
    const scan = scanA2uiOps(ops)
    return {
      messageId: String(e.message.id),
      surfaceIds: scan.surfaceIds,
      componentCount: scan.componentCount,
      message: e.message as Record<string, unknown>,
    }
  }),
)

const root = ref<HTMLElement | null>(null)
const flashId = ref<string | null>(null)
let flashTimer: ReturnType<typeof setTimeout> | null = null

function locate(messageId: string): void {
  const els = root.value?.querySelectorAll('[data-message-id]') ?? []
  const el = Array.from(els).find((n) => (n as HTMLElement).dataset.messageId === messageId)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  flashId.value = messageId
  if (flashTimer) clearTimeout(flashTimer)
  flashTimer = setTimeout(() => { flashId.value = null }, 1600)
}

defineExpose({ locate })
</script>

<template>
  <div ref="root" class="a2ui-workspace" data-testid="a2ui-workspace">
    <div v-if="blocks.length === 0" class="a2ui-workspace-empty" data-testid="a2ui-workspace-empty">
      <p class="empty-title">中央工作区</p>
      <p class="empty-hint">agent 生成 UI 看板 / 图表 / 表单后，会在这里渲染。</p>
    </div>
    <div
      v-for="b in blocks"
      :key="b.messageId"
      class="a2ui-workspace-block"
      :class="{ 'a2ui-block-flash': flashId === b.messageId }"
      data-testid="a2ui-workspace-block"
      :data-message-id="b.messageId"
    >
      <div class="a2ui-block-header">
        <span class="a2ui-block-title">🎨 {{ b.surfaceIds.join(' · ') || 'surface' }}</span>
        <span class="a2ui-block-meta">{{ b.surfaceIds.length }} surface · {{ b.componentCount }} 组件</span>
      </div>
      <component
        :is="a2uiRenderer"
        activity-type="a2ui-surface"
        :content="b.message.content"
        :message="b.message"
        :agent="props.agent"
      />
    </div>
  </div>
</template>

<style scoped>
.a2ui-workspace {
  height: 100%;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.a2ui-workspace-empty {
  margin: auto;
  text-align: center;
  color: #9ca3af;
}
.empty-title {
  font-size: 15px;
  font-weight: 600;
  color: #6b7280;
}
.empty-hint {
  font-size: 12px;
}
.a2ui-workspace-block {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #fff;
  padding: 10px 12px;
  transition: box-shadow 0.3s ease, border-color 0.3s ease;
}
.a2ui-block-flash {
  border-color: #818cf8;
  box-shadow: 0 0 0 3px rgba(129, 140, 248, 0.35);
}
.a2ui-block-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 6px;
}
.a2ui-block-title {
  font-size: 12px;
  font-weight: 600;
  color: #4338ca;
}
.a2ui-block-meta {
  font-size: 11px;
  color: #9ca3af;
}
</style>
