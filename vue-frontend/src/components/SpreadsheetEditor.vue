<script setup lang="ts">
import { computed, ref } from 'vue'
import { parseCsv, serializeCsv } from '../composables/spreadsheetEdits'
import { useWorkspaceFiles } from '../composables/useWorkspaceFiles'

/**
 * task5-B4 spreadsheet 编辑器（spec: docs/spec/copilotkit-capabilities.md B4，
 * 参考 copilotkit-examples/showcases/spreadsheet 的 SingleSpreadsheet）。
 *
 * CSV → contenteditable 网格（首行为表头）。单元格失焦时同步内部状态
 * （输入期间以 DOM 为准，避免重渲染重置光标）；保存经 PUT /files/{name}
 * 覆盖写回真实文件。
 */
const props = defineProps<{ name: string; content: string }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved', name: string): void }>()

const api = useWorkspaceFiles()

// 内部表格状态；baseline 用于脏标记比较（规范化末尾换行差异）
const rows = ref<string[][]>(parseCsv(props.content))
const baseline = serializeCsv(parseCsv(props.content))
const saving = ref(false)
const saveError = ref('')

const dirty = computed(() => serializeCsv(rows.value) !== baseline)
const colCount = computed(() => Math.max(1, ...rows.value.map((r) => r.length)))
const headerCells = computed(() => rows.value[0] ?? [])
const bodyRows = computed(() => rows.value.slice(1))

/** 单元格失焦时把 DOM 文本写回内部状态（自动扩展行列）。 */
function onCellBlur(r: number, c: number, e: Event) {
  const text = ((e.target as HTMLElement).textContent ?? '').replace(/\n/g, '')
  const row = rows.value[r]
  while (row.length <= c) row.push('')
  if (row[c] !== text) row[c] = text
}

function addRow() {
  rows.value.push(new Array(colCount.value).fill(''))
}

function addCol() {
  if (rows.value.length === 0) rows.value.push([''])
  else for (const r of rows.value) r.push('')
}

async function save() {
  saving.value = true
  saveError.value = ''
  try {
    await api.saveFile(props.name, serializeCsv(rows.value))
    emit('saved', props.name)
  } catch (err: any) {
    saveError.value = err?.message ?? '保存失败'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="editor-overlay" data-testid="spreadsheet-editor">
    <div class="editor-card">
      <div class="editor-head">
        <strong class="editor-title" :title="name">{{ name }}</strong>
        <span v-if="dirty" class="dirty" data-testid="dirty-mark">● 未保存</span>
        <span class="spacer" />
        <button class="tool-btn" data-testid="add-row-btn" title="在末尾追加一行" @click="addRow">+ 行</button>
        <button class="tool-btn" data-testid="add-col-btn" title="在末尾追加一列" @click="addCol">+ 列</button>
        <button class="save-btn" data-testid="save-btn" :disabled="saving || !dirty" @click="save">
          {{ saving ? '保存中…' : '保存' }}
        </button>
        <button class="close-btn" data-testid="close-editor-btn" title="关闭编辑器" @click="emit('close')">×</button>
      </div>
      <p v-if="saveError" class="error">{{ saveError }}</p>
      <div class="grid-wrap">
        <table v-if="rows.length > 0" class="grid">
          <thead>
            <tr>
              <th
                v-for="(h, c) in headerCells"
                :key="c"
                :data-testid="`cell-0-${c}`"
                contenteditable
                spellcheck="false"
                @blur="onCellBlur(0, c, $event)"
              >{{ h }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, ri) in bodyRows" :key="ri">
              <td
                v-for="c in colCount"
                :key="c"
                :data-testid="`cell-${ri + 1}-${c - 1}`"
                contenteditable
                spellcheck="false"
                @blur="onCellBlur(ri + 1, c - 1, $event)"
              >{{ row[c - 1] ?? '' }}</td>
            </tr>
          </tbody>
        </table>
        <div v-else class="empty">
          文件为空，点击「+ 行」开始编辑
        </div>
      </div>
      <p class="hint">单元格失焦后生效；「保存」覆盖写回 workspace 真实文件，agent 随即读到新内容</p>
    </div>
  </div>
</template>

<style scoped>
/* 对齐设计系统：浅色卡片、--accent #6366f1、圆角 10px */
.editor-overlay {
  position: fixed; inset: 0; z-index: 900;
  background: rgba(15, 23, 42, 0.35);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
}
.editor-card {
  background: #ffffff; border: 1px solid var(--border, #e5e7eb);
  border-radius: 10px; box-shadow: 0 12px 40px rgba(15, 23, 42, 0.18);
  width: min(860px, 100%); max-height: 100%;
  display: flex; flex-direction: column; overflow: hidden;
}
.editor-head {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 16px; border-bottom: 1px solid var(--border, #e5e7eb);
}
.editor-title {
  font-size: 13.5px; color: #111827;
  max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dirty { font-size: 11.5px; color: #b45309; background: #fffbeb; border: 1px solid #fde68a; border-radius: 999px; padding: 2px 8px; }
.spacer { flex: 1; }
.tool-btn {
  font-size: 12.5px; color: #4338ca; background: #eef2ff;
  border: 1px solid #e0e7ff; border-radius: 8px; padding: 5px 10px; cursor: pointer;
}
.tool-btn:hover { background: #e0e7ff; }
.save-btn {
  font-size: 12.5px; font-weight: 600; color: #fff; background: var(--accent, #6366f1);
  border: none; border-radius: 8px; padding: 6px 14px; cursor: pointer;
}
.save-btn:hover:not(:disabled) { background: #4f46e5; }
.save-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.close-btn {
  border: none; background: transparent; color: #9ca3af; font-size: 16px;
  cursor: pointer; border-radius: 6px; padding: 0 6px; line-height: 1.4;
}
.close-btn:hover { color: #374151; background: #f1f5f9; }
.error { font-size: 12px; color: #b91c1c; margin: 8px 16px 0; }
.grid-wrap { overflow: auto; padding: 12px 16px; flex: 1; min-height: 120px; }
.grid { border-collapse: collapse; min-width: 100%; }
.grid th, .grid td {
  border: 1px solid var(--border, #e5e7eb);
  padding: 6px 10px; font-size: 12.5px; color: #374151;
  min-width: 72px; max-width: 240px; outline: none;
  white-space: pre-wrap; word-break: break-all;
}
.grid th { background: #f8fafc; font-weight: 600; color: #111827; text-align: left; }
.grid th:focus, .grid td:focus { box-shadow: inset 0 0 0 2px var(--ring, rgba(99, 102, 241, 0.5)); background: #eef2ff; }
.empty { padding: 32px; text-align: center; color: #9ca3af; font-size: 12.5px; }
.hint { font-size: 11.5px; color: #9ca3af; margin: 0; padding: 8px 16px 12px; }
</style>
