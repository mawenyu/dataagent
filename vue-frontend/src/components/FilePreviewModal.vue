<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { parseCsvPreview, prettyJson, renderMarkdownLite } from '../composables/filePreview'
import { trapTabKey } from '../composables/focusTrap'

/**
 * P-C: 文件在线预览 modal（Teleport body / ESC·遮罩关闭）。
 * csv/tsv → 表格(首行表头,超 500 行截断提示);json → 美化;md → 轻量渲染;
 * txt/log → 等宽原文。
 * P32: 图片(png/jpg/gif/webp/svg/bmp/avif/ico) → imageUrl 分支 <img> 直渲
 *      （URL 即下载端点,gateway 按扩展名给 Content-Type,浏览器流式解码）。
 * 多模态预览: pdf → pdfUrl 分支 <iframe> 内嵌（浏览器原生分页/缩放）+ 下载兜底。
 */
const props = withDefaults(defineProps<{
  name: string
  content?: string
  truncated?: boolean
  /** P32: 图片预览 —— 传下载 URL,组件渲 <img> 而非文本内容 */
  imageUrl?: string
  /** 多模态预览: PDF —— 传下载 URL,组件渲 <iframe> 内嵌(浏览器原生分页/缩放) */
  pdfUrl?: string
  /** P-N: 大文件(>1MB)替代预览 —— 展示下载入口而非内容 */
  oversize?: boolean
  sizeLabel?: string
  downloadUrl?: string
}>(), {
  content: '',
})

const emit = defineEmits<{ (e: 'close'): void }>()

const overlayEl = ref<HTMLElement | null>(null)
const cardEl = ref<HTMLElement | null>(null)
onMounted(() => nextTick(() => overlayEl.value?.focus()))

/** P-O: Esc 关闭 + Tab 焦点圈定。 */
function onOverlayKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('close')
    return
  }
  if (e.key === 'Tab' && cardEl.value) {
    trapTabKey(e, cardEl.value)
  }
}

const ext = computed(() => {
  const i = props.name.lastIndexOf('.')
  return i < 0 ? '' : props.name.slice(i + 1).toLowerCase()
})

const MAX_TABLE_ROWS = 500

const csvRows = computed(() => {
  if (ext.value !== 'csv' && ext.value !== 'tsv') return null
  const rows = ext.value === 'tsv'
    ? props.content.replace(/\r\n?/g, '\n').split('\n').filter((l) => l !== '').map((l) => l.split('\t'))
    : parseCsvPreview(props.content)
  return rows
})
const tableRows = computed(() => csvRows.value?.slice(0, MAX_TABLE_ROWS + 1) ?? [])
const tableOverflow = computed(() => Math.max(0, (csvRows.value?.length ?? 0) - 1 - MAX_TABLE_ROWS))

const prettyJsonContent = computed(() => (ext.value === 'json' ? prettyJson(props.content) : ''))
const markdownHtml = computed(() => (ext.value === 'md' ? renderMarkdownLite(props.content) : ''))
</script>

<template>
  <Teleport to="body">
    <div
      ref="overlayEl"
      class="fpv-overlay"
      data-testid="file-preview-overlay"
      tabindex="-1"
      @click.self="emit('close')"
      @keydown="onOverlayKeydown"
    >
      <div
        ref="cardEl"
        class="fpv-card"
        data-testid="file-preview-modal"
        role="dialog"
        aria-modal="true"
        :aria-label="`预览文件 ${name}`"
      >
        <div class="fpv-head">
          <strong class="fpv-name" :title="name">📄 {{ name }}</strong>
          <button class="fpv-close" data-testid="file-preview-close" aria-label="关闭预览" @click="emit('close')">×</button>
        </div>

        <div class="fpv-body">
          <!-- P-N: 大文件下载提示(不渲染内容) -->
          <div v-if="oversize" class="fpv-oversize" data-testid="file-preview-oversize">
            <span class="fpv-oversize-icon" aria-hidden="true">📦</span>
            <p class="fpv-oversize-title">文件较大（{{ sizeLabel }}），在线预览已停用</p>
            <p class="fpv-oversize-sub">超过 1MB 的文件请下载后查看，避免拖慢页面</p>
            <a v-if="downloadUrl" class="fpv-dl" :href="downloadUrl" :download="name" data-testid="file-preview-download">⬇ 下载文件</a>
          </div>
          <!-- P32: 图片直渲 -->
          <div v-else-if="imageUrl" class="fpv-image-wrap" data-testid="file-preview-image-wrap">
            <img :src="imageUrl" :alt="name" data-testid="file-preview-image" />
          </div>
          <!-- 多模态预览: PDF 内嵌(浏览器原生分页/缩放) + 下载兜底 -->
          <div v-else-if="pdfUrl" class="fpv-pdf-wrap" data-testid="file-preview-pdf-wrap">
            <iframe :src="pdfUrl" :title="`预览 ${name}`" class="fpv-pdf-frame" data-testid="file-preview-pdf"></iframe>
            <p class="fpv-note fpv-pdf-fallback">
              浏览器不支持内嵌 PDF？
              <a :href="pdfUrl" :download="name" data-testid="file-preview-download">⬇ 下载查看</a>
            </p>
          </div>
          <!-- csv/tsv: 表格 -->
          <template v-else>
          <div v-if="csvRows" class="fpv-table-wrap" data-testid="file-preview-table">
            <table v-if="tableRows.length">
              <thead>
                <tr><th v-for="(h, ci) in tableRows[0]" :key="ci">{{ h }}</th></tr>
              </thead>
              <tbody>
                <tr v-for="(row, ri) in tableRows.slice(1)" :key="ri">
                  <td v-for="(cell, ci) in row" :key="ci">{{ cell }}</td>
                </tr>
              </tbody>
            </table>
            <p v-else class="fpv-note">（空文件）</p>
            <p v-if="tableOverflow > 0" class="fpv-note">仅显示前 {{ MAX_TABLE_ROWS }} 行数据，剩余 {{ tableOverflow }} 行请下载查看</p>
          </div>
          <!-- json: 美化 -->
          <pre v-else-if="ext === 'json'" class="fpv-pre" data-testid="file-preview-json">{{ prettyJsonContent }}</pre>
          <!-- md: 轻量渲染 -->
          <div v-else-if="ext === 'md'" class="fpv-md" data-testid="file-preview-md" v-html="markdownHtml"></div>
          <!-- txt/log: 原文 -->
          <pre v-else class="fpv-pre" data-testid="file-preview-text">{{ content }}</pre>
          </template>
        </div>

        <p v-if="truncated" class="fpv-note fpv-trunc">（内容超过 256KB，仅显示前 256KB）</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.fpv-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(15, 23, 42, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fpv-fade 140ms ease-out;
}
.fpv-card {
  width: min(860px, calc(100vw - 48px));
  max-height: min(76vh, 720px);
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border-radius: 14px;
  box-shadow: 0 12px 40px rgba(15, 23, 42, 0.22);
  animation: fpv-pop 160ms ease-out;
  overflow: hidden;
}
.fpv-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border, #e5e7eb);
}
.fpv-name {
  font-size: 14px;
  color: #111827;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fpv-close {
  flex: none;
  border: none;
  background: transparent;
  color: #9ca3af;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  border-radius: 6px;
  padding: 2px 7px;
}
.fpv-close:hover { color: #ef4444; background: #fef2f2; }
.fpv-body { flex: 1; min-height: 0; overflow: auto; padding: 16px 18px; }
.fpv-pre {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: #374151;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap;
  word-break: break-all;
}
.fpv-table-wrap { overflow: auto; }
.fpv-table-wrap table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
.fpv-table-wrap th, .fpv-table-wrap td {
  border: 1px solid #e5e7eb;
  padding: 6px 10px;
  text-align: left;
  white-space: nowrap;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fpv-table-wrap th { background: #f8fafc; font-weight: 600; color: #111827; position: sticky; top: 0; }
.fpv-table-wrap td { color: #374151; }
.fpv-table-wrap tbody tr:hover { background: #f8fafc; }
.fpv-note { font-size: 12px; color: #9ca3af; margin: 10px 0 0; }
.fpv-trunc { padding: 0 18px 12px; }
/* md 渲染排版 */
.fpv-md { font-size: 13.5px; line-height: 1.7; color: #374151; }
.fpv-md :deep(h1), .fpv-md :deep(h2) { font-size: 17px; color: #111827; margin: 14px 0 8px; }
.fpv-md :deep(h3), .fpv-md :deep(h4) { font-size: 14.5px; color: #111827; margin: 12px 0 6px; }
.fpv-md :deep(p) { margin: 8px 0; }
.fpv-md :deep(code) {
  background: #f1f5f9; border-radius: 4px; padding: 1px 5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
}
.fpv-md :deep(pre) { background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 12px; overflow: auto; }
.fpv-md :deep(pre code) { background: none; padding: 0; }
.fpv-md :deep(ul) { margin: 8px 0; padding-left: 22px; }
.fpv-md :deep(table) { border-collapse: collapse; margin: 10px 0; }
.fpv-md :deep(th), .fpv-md :deep(td) { border: 1px solid #e5e7eb; padding: 5px 10px; }
.fpv-md :deep(a) { color: #4f46e5; }
/* P32: 图片预览 */
.fpv-image-wrap { display: flex; align-items: center; justify-content: center; min-height: 120px; }
.fpv-image-wrap img {
  max-width: 100%; max-height: calc(min(76vh, 720px) - 150px);
  object-fit: contain; border-radius: 8px;
  background: repeating-conic-gradient(#f1f5f9 0% 25%, #ffffff 0% 50%) 0 0 / 16px 16px;
}
/* 多模态预览: PDF 内嵌 */
.fpv-pdf-wrap { display: flex; flex-direction: column; height: 100%; min-height: 320px; }
.fpv-pdf-frame {
  flex: 1; width: 100%; min-height: min(60vh, 560px);
  border: 1px solid #e5e7eb; border-radius: 8px; background: #525659;
}
.fpv-pdf-fallback { margin-top: 8px; }
.fpv-pdf-fallback a { color: #4f46e5; text-decoration: none; }
.fpv-pdf-fallback a:hover { text-decoration: underline; }
/* P-N: 大文件下载提示 */
.fpv-oversize { display: flex; flex-direction: column; align-items: center; padding: 32px 0; gap: 6px; }
.fpv-oversize-icon { font-size: 34px; }
.fpv-oversize-title { margin: 0; font-size: 14px; font-weight: 600; color: #111827; }
.fpv-oversize-sub { margin: 0 0 10px; font-size: 12.5px; color: #9ca3af; }
.fpv-dl {
  display: inline-block; font-size: 13px; font-weight: 600; color: #ffffff;
  background: #6366f1; border-radius: 8px; padding: 8px 18px; text-decoration: none;
}
.fpv-dl:hover { background: #4f46e5; }
@keyframes fpv-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes fpv-pop {
  from { opacity: 0; transform: translateY(6px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
</style>
