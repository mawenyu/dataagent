<script setup lang="ts">
import { computed, onMounted, ref, toRef, watch } from 'vue'
import { formatSize, useWorkspaceFiles, type WorkspaceFile } from '../composables/useWorkspaceFiles'
import { fetchPdfPreviewUrl, isImage, isPdf, isPreviewable } from '../composables/filePreview'
import SpreadsheetEditor from './SpreadsheetEditor.vue'
import FilePreviewModal from './FilePreviewModal.vue'

/**
 * 单区文件树（P33-C 从 FilesPanel 抽出）：
 * 列表 / 目录树导航 / 在线预览 / 上传 / 下载 / 删除 / CSV 表格编辑。
 * 由 FilesPanel 以两个实例驱动：会话文件（threadId 隔离 API）+ 公共数据（共享根 API）。
 * api 由父组件注入（useWorkspaceFiles 实例），本组件只管导航/交互状态。
 */
const props = defineProps<{
  api: ReturnType<typeof useWorkspaceFiles>
  threadId?: string
}>()
const api = props.api
onMounted(() => api.refresh())

/** P-N: 大文件阈值 —— 超过则预览改为下载提示。 */
const OVERSIZE_PREVIEW_BYTES = 1024 * 1024
/** P32: 图片阈值放宽到 5MB —— 浏览器流式解码,agent 生成的图表远小于此;
 *  超过仍走下载提示(避免超大图撑爆页面内存)。 */
const OVERSIZE_IMAGE_BYTES = 5 * 1024 * 1024

const uploading = ref(false)
const fileInput = ref<HTMLInputElement>()
/** 内联提示（上传/删除/编辑器错误、不可预览提示）—— 不用原生弹窗 */
const notice = ref('')

// ---- P-N: 目录导航状态 ----
const currentPath = ref('')
const expanded = ref<Set<string>>(new Set())
const childrenCache = ref(new Map<string, { dirs: string[]; files: WorkspaceFile[] }>())

interface Row {
  kind: 'dir' | 'file'
  name: string
  rel: string
  depth: number
  file?: WorkspaceFile
}

/** 打平的可见行: 当前目录(dirs 在前) + 已展开目录的递归子行(缩进)。 */
const visibleRows = computed<Row[]>(() => {
  const rows: Row[] = []
  const walk = (path: string, dirs: string[], files: WorkspaceFile[], depth: number) => {
    for (const d of dirs) {
      const rel = path ? `${path}/${d}` : d
      rows.push({ kind: 'dir', name: d, rel, depth })
      if (expanded.value.has(rel) && depth < 8) {
        const c = childrenCache.value.get(rel)
        if (c) walk(rel, c.dirs, c.files, depth + 1)
      }
    }
    for (const f of files) {
      rows.push({ kind: 'file', name: f.name, rel: path ? `${path}/${f.name}` : f.name, depth, file: f })
    }
  }
  walk(currentPath.value, api.dirs.value, api.files.value, 0)
  return rows
})

const breadcrumbs = computed(() => {
  const segs = currentPath.value ? currentPath.value.split('/') : []
  const crumbs: { label: string; path: string }[] = [{ label: '根目录', path: '' }]
  segs.forEach((seg, i) => crumbs.push({ label: seg, path: segs.slice(0, i + 1).join('/') }))
  return crumbs
})

function navigate(path: string) {
  currentPath.value = path
  notice.value = ''
  void api.refresh(path)
}

function enterDir(rel: string) {
  navigate(rel)
}

async function toggleExpand(rel: string) {
  const next = new Set(expanded.value)
  if (next.has(rel)) {
    next.delete(rel)
  } else {
    if (!childrenCache.value.has(rel)) {
      try {
        const children = await api.fetchDir(rel)
        const m = new Map(childrenCache.value)
        m.set(rel, children)
        childrenCache.value = m
      } catch (err: any) {
        notice.value = `读取目录失败：${err?.message ?? err}`
        return
      }
    }
    next.add(rel)
  }
  expanded.value = next
}

// 切会话: 导航状态复位(目录属于旧会话)
watch(toRef(props, 'threadId'), () => {
  currentPath.value = ''
  expanded.value = new Set()
  childrenCache.value = new Map()
})

function pickFile() { fileInput.value?.click() }

async function onPick(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  uploading.value = true
  notice.value = ''
  try {
    await api.upload(f, currentPath.value)
  } catch (err: any) {
    notice.value = `上传失败：${err?.message ?? err}`
  } finally {
    uploading.value = false
    ;(e.target as HTMLInputElement).value = ''
  }
}

/** P-N: 大文件预览替代态(modal 内给下载入口)。 */
const oversizePreview = ref<{ name: string; size: number; url: string } | null>(null)
/** P32: 图片预览态 —— 不拉文本内容,直接用下载 URL 渲 <img>。 */
const imagePreview = ref<{ name: string; url: string } | null>(null)
/** 多模态预览: PDF 预览态 —— blob: URL(iframe 内嵌渲染)。 */
const pdfPreview = ref<{ name: string; url: string } | null>(null)
const pdfLoading = ref(false)

async function openPdfPreview(row: { name: string; rel: string }) {
  pdfLoading.value = true
  try {
    const url = await fetchPdfPreviewUrl(api.downloadUrl(row.rel))
    pdfPreview.value = { name: row.rel, url }
  } catch {
    notice.value = `「${row.name}」预览加载失败，请下载查看`
  } finally {
    pdfLoading.value = false
  }
}

function closePdfPreview() {
  if (pdfPreview.value) URL.revokeObjectURL(pdfPreview.value.url)
  pdfPreview.value = null
}

function onNameClick(row: { name: string; rel: string; file?: WorkspaceFile }) {
  notice.value = ''
  if (!isPreviewable(row.name)) {
    notice.value = `「${row.name}」不支持在线预览，请下载查看`
    return
  }
  // P32: 图片走 imageUrl 直渲分支(阈值 5MB,超了走下载提示)
  if (isImage(row.name)) {
    if (row.file && row.file.size > OVERSIZE_IMAGE_BYTES) {
      oversizePreview.value = {
        name: row.rel,
        size: row.file.size,
        url: api.downloadUrl(row.rel),
      }
      return
    }
    imagePreview.value = { name: row.rel, url: api.downloadUrl(row.rel) }
    return
  }
  // 多模态预览: PDF 拉字节转 blob URL(下载端点是 attachment disposition,直链 iframe 会变下载)
  if (isPdf(row.name)) {
    if (row.file && row.file.size > OVERSIZE_IMAGE_BYTES) {
      oversizePreview.value = {
        name: row.rel,
        size: row.file.size,
        url: api.downloadUrl(row.rel),
      }
      return
    }
    void openPdfPreview(row)
    return
  }
  // P-N: 大文件不拉内容,直接给下载提示
  if (row.file && row.file.size > OVERSIZE_PREVIEW_BYTES) {
    oversizePreview.value = {
      name: row.rel,
      size: row.file.size,
      url: api.downloadUrl(row.rel),
    }
    return
  }
  void api.previewFile(row.rel)
}

// 两段确认删除：第一次点击 × → 按钮变"确认删除？"(3s 超时复位);再点才真删
const confirmingDel = ref<string | null>(null)
let confirmTimer: number | undefined
async function confirmRemove(rel: string) {
  if (confirmingDel.value !== rel) {
    confirmingDel.value = rel
    window.clearTimeout(confirmTimer)
    confirmTimer = window.setTimeout(() => { confirmingDel.value = null }, 3000)
    return
  }
  confirmingDel.value = null
  window.clearTimeout(confirmTimer)
  notice.value = ''
  try {
    await api.remove(rel)
  } catch (err: any) {
    notice.value = `删除失败：${err?.message ?? err}`
  }
}

// task5-B4: CSV 表格编辑器（打开前读取完整内容）
const editing = ref<{ name: string; content: string; baseModified?: number } | null>(null)
function isCsv(name: string) { return name.toLowerCase().endsWith('.csv') }
async function openEditor(rel: string) {
  notice.value = ''
  try {
    const content = await api.readFile(rel)
    // P15: 打开时记录 mtime —— 保存携带 baseModified 做乐观并发检测
    editing.value = { name: rel, content, baseModified: api.statOf(rel.split('/').pop() ?? rel) ?? undefined }
  } catch (err: any) {
    notice.value = `打开编辑器失败：${err?.message ?? err}`
  }
}
function closeEditor() { editing.value = null }

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}
</script>

<template>
  <div class="file-tree">
    <div class="tree-toolbar">
      <nav class="crumbs" data-testid="breadcrumbs">
        <template v-for="(c, i) in breadcrumbs" :key="c.path">
          <span v-if="i > 0" class="crumb-sep">/</span>
          <button
            class="crumb"
            :class="{ current: i === breadcrumbs.length - 1 }"
            :data-testid="`crumb-${c.path || 'root'}`"
            @click="navigate(c.path)"
          >{{ c.label }}</button>
        </template>
      </nav>
      <button class="new-btn" data-testid="upload-btn" :disabled="uploading" @click="pickFile">
        {{ uploading ? '上传中…' : '⇪ 上传' }}
      </button>
      <input ref="fileInput" type="file" hidden data-testid="file-input" @change="onPick" />
    </div>
    <div v-if="api.error.value" class="error">{{ api.error.value }}</div>
    <div v-if="notice" class="error" data-testid="files-notice">{{ notice }}</div>
    <div v-if="pdfLoading" class="pdf-loading" data-testid="files-pdf-loading">PDF 加载中…</div>
    <div class="file-list">
      <div
        v-for="row in visibleRows"
        :key="row.rel"
        class="file-item"
        :class="{ 'is-dir': row.kind === 'dir' }"
        :data-file="row.kind === 'file' ? row.rel : undefined"
        :data-dir="row.kind === 'dir' ? row.rel : undefined"
        :style="{ paddingLeft: `${10 + row.depth * 16}px` }"
      >
        <!-- 目录行: chevron 折叠展开 + 名字进入 -->
        <template v-if="row.kind === 'dir'">
          <button
            class="dir-chev"
            :data-testid="`expand-${row.rel}`"
            :title="expanded.has(row.rel) ? '折叠' : '展开'"
            @click="toggleExpand(row.rel)"
          >{{ expanded.has(row.rel) ? '▾' : '▸' }}</button>
          <button class="file-name dir-name" :title="`进入 ${row.rel}`" @click="enterDir(row.rel)">
            📁 {{ row.name }}
          </button>
        </template>
        <!-- 文件行 -->
        <template v-else>
          <button class="file-name" :title="row.rel" @click="onNameClick(row)">{{ row.name }}</button>
          <span class="file-meta">{{ formatSize(row.file!.size) }} · {{ formatTime(row.file!.modifiedAt) }}</span>
          <span class="file-actions">
            <button
              v-if="isCsv(row.name)"
              class="act"
              :data-testid="`edit-${row.rel}`"
              title="表格编辑"
              @click="openEditor(row.rel)"
            >✎</button>
            <a class="act" :href="api.downloadUrl(row.rel)" :download="row.name" title="下载">⬇</a>
            <button
              class="act del"
              :class="{ confirming: confirmingDel === row.rel }"
              :data-testid="`del-${row.rel}`"
              :title="confirmingDel === row.rel ? '再次点击确认删除' : '删除'"
              @click="confirmRemove(row.rel)"
            >{{ confirmingDel === row.rel ? '确认删除？' : '×' }}</button>
          </span>
        </template>
      </div>
      <div v-if="!api.loading.value && visibleRows.length === 0" class="empty" data-testid="files-empty">
        <span class="empty-icon" aria-hidden="true">📂</span>
        <p class="empty-title">这个目录还没有文件</p>
        <button class="empty-upload" data-testid="empty-upload" @click="pickFile">⇪ 上传数据文件</button>
        <p class="empty-sub">支持 CSV / JSON / XLSX / 图片等，agent 可直接读取分析</p>
      </div>
    </div>
    <!-- P-C: 在线预览 modal(csv 表格 / json 美化 / md 渲染;Teleport + ESC) -->
    <FilePreviewModal
      v-if="api.preview.value"
      :name="api.preview.value.name"
      :content="api.preview.value.content"
      :truncated="api.preview.value.truncated"
      @close="api.closePreview()"
    />
    <!-- P32: 图片预览 modal(<img> 直渲下载 URL) -->
    <FilePreviewModal
      v-if="imagePreview"
      :name="imagePreview.name"
      :image-url="imagePreview.url"
      @close="imagePreview = null"
    />
    <!-- 多模态预览: PDF 预览 modal(<iframe> 内嵌 blob URL) -->
    <FilePreviewModal
      v-if="pdfPreview"
      :name="pdfPreview.name"
      :pdf-url="pdfPreview.url"
      @close="closePdfPreview"
    />
    <!-- P-N: 大文件下载提示 modal -->
    <FilePreviewModal
      v-if="oversizePreview"
      :name="oversizePreview.name"
      :oversize="true"
      :size-label="formatSize(oversizePreview.size)"
      :download-url="oversizePreview.url"
      @close="oversizePreview = null"
    />
    <!-- task5-B4: CSV 表格编辑器（弹层卡片） -->
    <SpreadsheetEditor
      v-if="editing"
      :name="editing.name"
      :content="editing.content"
      :thread-id="props.threadId"
      :base-modified="editing.baseModified"
      @close="closeEditor"
      @saved="closeEditor"
    />
  </div>
</template>

<style scoped>
.file-tree { display: flex; flex-direction: column; min-height: 0; }
.tree-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 0 14px 6px; }
.new-btn {
  flex: none;
  font-size: 12.5px; color: #4338ca; background: #eef2ff;
  border: 1px solid #e0e7ff; border-radius: 8px; padding: 5px 10px; cursor: pointer;
}
.new-btn:hover { background: #e0e7ff; }
.new-btn:disabled { opacity: 0.5; cursor: default; }
/* P-N: 面包屑 */
.crumbs { display: flex; align-items: center; flex-wrap: wrap; gap: 2px; min-width: 0; }
.crumb {
  border: none; background: transparent; font-size: 12px; color: #4f46e5;
  cursor: pointer; padding: 1px 4px; border-radius: 5px;
}
.crumb:hover { background: #eef2ff; }
.crumb.current { color: #6b7280; font-weight: 600; cursor: default; }
.crumb.current:hover { background: transparent; }
.crumb-sep { font-size: 11px; color: #cbd5e1; }
.error { font-size: 12px; color: #b91c1c; margin: 0 14px 6px; }
.pdf-loading { font-size: 12px; color: #6366f1; margin: 0 14px 6px; }
.file-list { padding: 0 8px 12px; }
.file-item {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 10px; margin-bottom: 2px; border-radius: 8px;
}
.file-item:hover { background: #f1f5f9; }
.file-name {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  border: none; background: none; text-align: left; cursor: pointer;
  font-size: 13px; color: #374151; padding: 0;
}
.file-name:hover { color: #4338ca; }
.dir-name { font-weight: 600; color: #1f2937; }
.dir-chev {
  flex: none; width: 18px; border: none; background: transparent;
  color: #9ca3af; font-size: 11px; cursor: pointer; padding: 0;
}
.dir-chev:hover { color: #4338ca; }
.file-meta { font-size: 11px; color: #9ca3af; white-space: nowrap; }
/* 隐形即不可点(同 ThreadSidebar 实测 bug: opacity:0 仍拦截点击) */
.file-actions { display: flex; gap: 2px; opacity: 0; pointer-events: none; align-items: center; }
.file-item:hover .file-actions, .file-item:focus-within .file-actions { opacity: 1; pointer-events: auto; }
@media (hover: none) {
  .file-actions { opacity: 0.65; pointer-events: auto; }
}
.act {
  border: none; background: transparent; color: #9ca3af; font-size: 14px;
  cursor: pointer; border-radius: 6px; padding: 0 5px; text-decoration: none; line-height: 1.4;
}
.act:hover { color: #4338ca; background: #eef2ff; }
.act.del:hover { color: #ef4444; background: #fef2f2; }
/* P-C: 两段确认态 */
.act.del.confirming {
  opacity: 1;
  font-size: 11.5px;
  color: #ffffff;
  background: #ef4444;
  padding: 2px 8px;
  white-space: nowrap;
}
.act.del.confirming:hover { background: #dc2626; }
.empty { padding: 20px; text-align: center; color: #9ca3af; font-size: 12.5px; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.empty-icon { font-size: 28px; }
.empty-title { margin: 0; font-size: 13px; font-weight: 600; color: #6b7280; }
.empty-upload {
  margin-top: 4px;
  font-size: 12.5px; font-weight: 600; color: #4338ca;
  background: #eef2ff; border: 1px solid #e0e7ff; border-radius: 8px;
  padding: 7px 16px; cursor: pointer;
}
.empty-upload:hover { background: #e0e7ff; }
.empty-sub { margin: 0; font-size: 11.5px; }
</style>
