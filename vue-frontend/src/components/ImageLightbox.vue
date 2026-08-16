<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { trapTabKey } from '../composables/focusTrap'

/**
 * 多模态预览: 图片 lightbox —— 全屏遮罩 + 大图的查看体验。
 * 用于对话附件区图片点击放大（附件上传后即会话文件,src = 下载链）。
 * ESC / 遮罩点击 / × 关闭；点图片本身不关闭（防误触）。
 */
defineProps<{
  src: string
  name: string
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

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
</script>

<template>
  <Teleport to="body">
    <div
      ref="overlayEl"
      class="ilb-overlay"
      data-testid="image-lightbox-overlay"
      tabindex="-1"
      @click.self="emit('close')"
      @keydown="onOverlayKeydown"
    >
      <figure
        ref="cardEl"
        class="ilb-card"
        data-testid="image-lightbox"
        role="dialog"
        aria-modal="true"
        :aria-label="`查看图片 ${name}`"
      >
        <button class="ilb-close" data-testid="image-lightbox-close" aria-label="关闭大图" @click="emit('close')">×</button>
        <img :src="src" :alt="name" data-testid="image-lightbox-img" />
        <figcaption class="ilb-caption">{{ name }}</figcaption>
      </figure>
    </div>
  </Teleport>
</template>

<style scoped>
.ilb-overlay {
  position: fixed;
  inset: 0;
  z-index: 1300;
  background: rgba(10, 12, 20, 0.78);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: ilb-fade 140ms ease-out;
}
.ilb-card {
  margin: 0;
  position: relative;
  max-width: calc(100vw - 64px);
  max-height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  align-items: center;
  animation: ilb-pop 160ms ease-out;
}
.ilb-card img {
  max-width: 100%;
  max-height: calc(100vh - 130px);
  object-fit: contain;
  border-radius: 10px;
  box-shadow: 0 16px 60px rgba(0, 0, 0, 0.5);
  background: repeating-conic-gradient(#334155 0% 25%, #1e293b 0% 50%) 0 0 / 18px 18px;
}
.ilb-caption {
  margin-top: 10px;
  font-size: 12.5px;
  color: #cbd5e1;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ilb-close {
  position: absolute;
  top: -14px;
  right: -14px;
  z-index: 1;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: #f8fafc;
  color: #334155;
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
}
.ilb-close:hover { background: #fee2e2; color: #b91c1c; }
@keyframes ilb-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes ilb-pop {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}
</style>
