<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { formatSize, useWorkspaceFiles } from '../composables/useWorkspaceFiles'
import SpreadsheetEditor from './SpreadsheetEditor.vue'

/**
 * workspace 文件面板（spec: docs/spec/workspace-files.md）：
 * 列表 / 文本预览 / 上传 / 下载 / 删除。与会话栏同栏位 Tab 切换（App.vue 驱动）。
 * task5-B4：.csv 文件可"表格编辑"打开 SpreadsheetEditor（PUT 覆盖写保存）。
 */
const api = useWorkspaceFiles()
onMounted(() => api.refresh())

const uploading = ref(false)
const fileInput = ref<HTMLInputElement>()

function pickFile() { fileInput.value?.click() }

async function onPick(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  uploading.value = true
  try {
    await api.upload(f)
  } catch (err: any) {
    window.alert(`上传失败：${err?.message ?? err}`)
  } finally {
    uploading.value = false
    ;(e.target as HTMLInputElement).value = ''
  }
}

async function confirmRemove(name: string) {
  if (!window.confirm(`删除文件「${name}」？agent 将再也读不到它。`)) return
  try {
    await api.remove(name)
  } catch (err: any) {
    window.alert(`删除失败：${err?.message ?? err}`)
  }
}

// task5-B4: CSV 表格编辑器（打开前读取完整内容）
const editing = ref<{ name: string; content: string } | null>(null)
function isCsv(name: string) { return name.toLowerCase().endsWith('.csv') }
async function openEditor(name: string) {
  try {
    const content = await api.readFile(name)
    editing.value = { name, content }
  } catch (err: any) {
    window.alert(`打开编辑器失败：${err?.message ?? err}`)
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
    <p class="hint">agent 可直接读取这里的文件做分析</p>
    <div v-if="api.error.value" class="error">{{ api.error }}</div>
    <div class="file-list">
      <div v-for="f in api.files.value" :key="f.name" class="file-item" :data-file="f.name">
        <button class="file-name" :title="f.name" @click="api.previewFile(f.name)">{{ f.name }}</button>
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
          <button class="act del" :data-testid="`del-${f.name}`" title="删除" @click="confirmRemove(f.name)">×</button>
        </span>
      </div>
      <div v-if="!api.loading.value && api.files.value.length === 0" class="empty">
        暂无文件，点击"上传"添加 CSV/数据文件
      </div>
    </div>
    <!-- 文本预览 -->
    <div v-if="api.preview.value" class="preview" data-testid="file-preview">
      <div class="preview-head">
        <strong>{{ api.preview.value.name }}</strong>
        <button class="act" title="关闭预览" @click="api.closePreview()">×</button>
      </div>
      <pre class="preview-body">{{ api.preview.value.content }}</pre>
      <p v-if="api.preview.value.truncated" class="hint">（内容超过 256KB，仅显示前 256KB）</p>
    </div>
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
.file-actions { display: flex; gap: 2px; opacity: 0; }
.file-item:hover .file-actions { opacity: 1; }
.act {
  border: none; background: transparent; color: #9ca3af; font-size: 14px;
  cursor: pointer; border-radius: 6px; padding: 0 5px; text-decoration: none; line-height: 1.4;
}
.act:hover { color: #4338ca; background: #eef2ff; }
.act.del:hover { color: #ef4444; background: #fef2f2; }
.empty { padding: 20px; text-align: center; color: #9ca3af; font-size: 12.5px; }
.preview {
  border-top: 1px solid var(--border, #e5e7eb);
  max-height: 45%; display: flex; flex-direction: column;
}
.preview-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 14px; font-size: 12.5px; color: #111827;
}
.preview-body {
  margin: 0; padding: 8px 14px 12px; overflow: auto;
  font-size: 11.5px; line-height: 1.5; color: #374151;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap; word-break: break-all;
}
</style>
