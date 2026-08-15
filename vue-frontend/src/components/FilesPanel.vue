<script setup lang="ts">
import { onMounted, ref, toRef } from 'vue'
import { formatSize, useWorkspaceFiles } from '../composables/useWorkspaceFiles'
import { isPreviewable } from '../composables/filePreview'
import SpreadsheetEditor from './SpreadsheetEditor.vue'
import FilePreviewModal from './FilePreviewModal.vue'

/**
 * workspace 文件面板（spec: docs/spec/workspace-files.md）：
 * 列表 / 在线预览 / 上传 / 下载 / 删除。与会话栏同栏位 Tab 切换（App.vue 驱动）。
 * task5-B4：.csv 文件可"表格编辑"打开 SpreadsheetEditor（PUT 覆盖写保存）。
 * task6：threadId prop —— 面板显示当前会话的隔离 workspace（spec: workspace-isolation.md）。
 * P-C：预览升级为全屏 modal（csv 表格 / json 美化 / md 渲染，Teleport+ESC）；
 *      同时清掉原生 alert/confirm —— 错误走内联 notice，删除走两段确认。
 */
const props = defineProps<{ threadId?: string }>()
const api = useWorkspaceFiles(toRef(props, 'threadId'))
onMounted(() => api.refresh())

const uploading = ref(false)
const fileInput = ref<HTMLInputElement>()
/** 内联提示（上传/删除/编辑器错误、不可预览提示）—— 不用原生弹窗 */
const notice = ref('')

function pickFile() { fileInput.value?.click() }

async function onPick(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  uploading.value = true
  notice.value = ''
  try {
    await api.upload(f)
  } catch (err: any) {
    notice.value = `上传失败：${err?.message ?? err}`
  } finally {
    uploading.value = false
    ;(e.target as HTMLInputElement).value = ''
  }
}

function onNameClick(name: string) {
  notice.value = ''
  if (!isPreviewable(name)) {
    notice.value = `「${name}」不支持在线预览，请下载查看`
    return
  }
  void api.previewFile(name)
}

// 两段确认删除：第一次点击 × → 按钮变"确认删除？"(3s 超时复位);再点才真删
const confirmingDel = ref<string | null>(null)
let confirmTimer: number | undefined
async function confirmRemove(name: string) {
  if (confirmingDel.value !== name) {
    confirmingDel.value = name
    window.clearTimeout(confirmTimer)
    confirmTimer = window.setTimeout(() => { confirmingDel.value = null }, 3000)
    return
  }
  confirmingDel.value = null
  window.clearTimeout(confirmTimer)
  notice.value = ''
  try {
    await api.remove(name)
  } catch (err: any) {
    notice.value = `删除失败：${err?.message ?? err}`
  }
}

// task5-B4: CSV 表格编辑器（打开前读取完整内容）
const editing = ref<{ name: string; content: string } | null>(null)
function isCsv(name: string) { return name.toLowerCase().endsWith('.csv') }
async function openEditor(name: string) {
  notice.value = ''
  try {
    const content = await api.readFile(name)
    editing.value = { name, content }
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
  <div class="files-panel" data-testid="files-panel">
    <div class="sidebar-head">
      <span class="sidebar-title">数据文件</span>
      <button class="new-btn" data-testid="upload-btn" :disabled="uploading" @click="pickFile">
        {{ uploading ? '上传中…' : '⇪ 上传' }}
      </button>
      <input ref="fileInput" type="file" hidden data-testid="file-input" @change="onPick" />
    </div>
    <p class="hint">本会话独立文件区，agent 可直接读取做分析</p>
    <div v-if="api.error.value" class="error">{{ api.error }}</div>
    <div v-if="notice" class="error" data-testid="files-notice">{{ notice }}</div>
    <div class="file-list">
      <div v-for="f in api.files.value" :key="f.name" class="file-item" :data-file="f.name">
        <button class="file-name" :title="f.name" @click="onNameClick(f.name)">{{ f.name }}</button>
        <span class="file-meta">{{ formatSize(f.size) }} · {{ formatTime(f.modifiedAt) }}</span>
        <span class="file-actions">
          <button
            v-if="isCsv(f.name)"
            class="act"
            :data-testid="`edit-${f.name}`"
            title="表格编辑"
            @click="openEditor(f.name)"
          >✎</button>
          <a class="act" :href="api.downloadUrl(f.name)" :download="f.name" title="下载">⬇</a>
          <button
            class="act del"
            :class="{ confirming: confirmingDel === f.name }"
            :data-testid="`del-${f.name}`"
            :title="confirmingDel === f.name ? '再次点击确认删除' : '删除'"
            @click="confirmRemove(f.name)"
          >{{ confirmingDel === f.name ? '确认删除？' : '×' }}</button>
        </span>
      </div>
      <div v-if="!api.loading.value && api.files.value.length === 0" class="empty">
        暂无文件，点击"上传"添加 CSV/数据文件
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
    <!-- task5-B4: CSV 表格编辑器（弹层卡片） -->
    <SpreadsheetEditor
      v-if="editing"
      :name="editing.name"
      :content="editing.content"
      @close="closeEditor"
      @saved="closeEditor"
    />
  </div>
</template>

<style scoped>
.files-panel { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.sidebar-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 14px 6px; }
.sidebar-title { font-size: 13px; font-weight: 600; color: #6b7280; }
.new-btn {
  font-size: 12.5px; color: #4338ca; background: #eef2ff;
  border: 1px solid #e0e7ff; border-radius: 8px; padding: 5px 10px; cursor: pointer;
}
.new-btn:hover { background: #e0e7ff; }
.new-btn:disabled { opacity: 0.5; cursor: default; }
.hint { font-size: 11.5px; color: #9ca3af; margin: 0 14px 8px; }
.error { font-size: 12px; color: #b91c1c; margin: 0 14px 6px; }
.file-list { flex: 1; overflow-y: auto; padding: 0 8px 12px; }
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
.file-meta { font-size: 11px; color: #9ca3af; white-space: nowrap; }
.file-actions { display: flex; gap: 2px; opacity: 0; align-items: center; }
.file-item:hover .file-actions { opacity: 1; }
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
.empty { padding: 20px; text-align: center; color: #9ca3af; font-size: 12.5px; }
</style>
