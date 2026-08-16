<script setup lang="ts">
/**
 * 模板库 step3: 侧栏模板面板（聊天视图侧栏常驻，折叠收纳）。
 * 场景模板（内置只读）+ 我的模板（localStorage 持久化，可删）；
 * 点击卡片 emit fill 由 App 填入输入框（可编辑后再发送，非直接提交）；
 * 「保存当前输入为模板」自绘表单（禁原生弹窗）。
 */
import { nextTick, ref, watch } from 'vue'
import { templatesByGroup, useUserTemplates, type PromptTemplate } from '../composables/promptTemplates'

const props = defineProps<{ draftPrompt?: string }>()
const emit = defineEmits<{
  (e: 'fill', t: PromptTemplate): void
  (e: 'saved', t: PromptTemplate): void
}>()

const expanded = ref(false)
const builtin = templatesByGroup('开场')
const userTpls = useUserTemplates()

// ---- 保存表单 ----
const saveOpen = ref(false)
const saveTitle = ref('')
const savePrompt = ref('')
const saveError = ref('')

function openSave() {
  saveTitle.value = ''
  savePrompt.value = props.draftPrompt ?? ''
  saveError.value = ''
  saveOpen.value = true
}
function cancelSave() {
  saveOpen.value = false
  saveError.value = ''
}
function submitSave() {
  try {
    const t = userTpls.save({ title: saveTitle.value, prompt: savePrompt.value })
    saveOpen.value = false
    emit('saved', t)
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : String(err)
  }
}

function onDelete(id: string) {
  userTpls.remove(id)
}

// 收起时关掉未完成的表单，避免状态残留
watch(expanded, (v) => { if (!v) cancelSave() })
</script>

<template>
  <section class="tpl-side" data-testid="template-sidebar">
    <button
      class="tpl-side-toggle"
      data-testid="template-sidebar-toggle"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <span>✨ 提示词模板</span>
      <span class="tpl-side-caret">{{ expanded ? '▾' : '▸' }}</span>
    </button>

    <div v-if="expanded" class="tpl-side-panel" data-testid="template-sidebar-panel">
      <div class="tpl-side-group">场景模板</div>
      <button
        v-for="t in builtin"
        :key="t.id"
        class="tpl-card"
        data-testid="template-fill-item"
        :title="`填入输入框：${t.prompt}`"
        @click="emit('fill', t)"
      >
        <span class="tpl-title">{{ t.title }}</span>
        <span class="tpl-desc">{{ t.desc }}</span>
      </button>

      <div class="tpl-side-group">
        我的模板
        <button
          class="tpl-save-open"
          data-testid="template-save-open"
          title="把当前输入框内容保存为我的模板"
          @click="openSave"
        >+ 保存当前输入</button>
      </div>

      <form v-if="saveOpen" class="tpl-save-form" data-testid="template-save-form" @submit.prevent="submitSave">
        <input
          v-model="saveTitle"
          class="tpl-save-title"
          data-testid="template-save-title"
          placeholder="模板标题（如：月度复盘）"
          maxlength="30"
        />
        <textarea
          v-model="savePrompt"
          class="tpl-save-prompt"
          data-testid="template-save-prompt"
          placeholder="模板内容（提示词全文）"
          rows="3"
        ></textarea>
        <div v-if="saveError" class="tpl-save-error" data-testid="template-save-error" role="alert">{{ saveError }}</div>
        <div class="tpl-save-actions">
          <!-- type=button + click：jsdom 不会由 submit 按钮触发 form submit；Enter 提交走 form @submit -->
          <button type="button" class="tpl-save-submit" data-testid="template-save-submit" @click="submitSave">保存</button>
          <button type="button" class="tpl-save-cancel" data-testid="template-save-cancel" @click="cancelSave">取消</button>
        </div>
      </form>

      <div v-if="userTpls.templates.value.length === 0" class="tpl-mine-empty" data-testid="template-mine-empty">
        还没有自定义模板 —— 在输入框写好提示词后点「+ 保存当前输入」
      </div>
      <div
        v-for="t in userTpls.templates.value"
        :key="t.id"
        class="tpl-card tpl-card-mine"
        data-testid="template-mine-item"
        role="button"
        tabindex="0"
        :title="`填入输入框：${t.prompt}`"
        @click="emit('fill', t)"
        @keydown.enter="emit('fill', t)"
      >
        <span class="tpl-title">{{ t.title }}</span>
        <span class="tpl-desc">{{ t.desc }}</span>
        <button
          class="tpl-delete"
          data-testid="template-delete"
          :title="`删除模板：${t.title}`"
          @click.stop="onDelete(t.id)"
        >✕</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.tpl-side { border-top: 1px solid #eceef2; }
.tpl-side-toggle {
  width: 100%; display: flex; justify-content: space-between; align-items: center;
  padding: 10px 14px; background: none; border: none; cursor: pointer;
  font-size: 13px; font-weight: 600; color: #4b5563;
}
.tpl-side-toggle:hover { background: #f5f6fa; }
.tpl-side-caret { color: #9ca3af; }
.tpl-side-panel { padding: 2px 10px 10px; display: flex; flex-direction: column; gap: 6px; }
.tpl-side-group {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 11px; color: #9ca3af; font-weight: 600; margin-top: 6px; padding: 0 2px;
}
.tpl-card {
  position: relative; text-align: left; background: #f8f9fc; border: 1px solid #eceef2;
  border-radius: 8px; padding: 7px 10px; cursor: pointer; display: flex; flex-direction: column; gap: 2px;
}
.tpl-card:hover { border-color: #c7d2fe; background: #f5f7ff; }
.tpl-title { font-size: 12.5px; font-weight: 600; color: #374151; }
.tpl-desc { font-size: 11px; color: #9ca3af; }
.tpl-card-mine { padding-right: 30px; }
.tpl-delete {
  position: absolute; right: 6px; top: 6px; width: 18px; height: 18px;
  border: none; border-radius: 4px; background: none; color: #c4c9d4; cursor: pointer; font-size: 11px;
}
.tpl-delete:hover { background: #fee2e2; color: #dc2626; }
.tpl-save-open {
  border: none; background: none; color: var(--accent, #4f6ef7); cursor: pointer;
  font-size: 11px; font-weight: 600; padding: 0;
}
.tpl-save-open:hover { text-decoration: underline; }
.tpl-save-form { display: flex; flex-direction: column; gap: 6px; padding: 4px 2px; }
.tpl-save-title, .tpl-save-prompt {
  border: 1px solid #dfe3ec; border-radius: 6px; padding: 6px 8px; font-size: 12px;
  font-family: inherit; resize: vertical;
}
.tpl-save-title:focus, .tpl-save-prompt:focus { outline: none; border-color: #c7d2fe; box-shadow: 0 0 0 2px rgba(199, 210, 254, 0.5); }
.tpl-save-error { font-size: 11px; color: #dc2626; }
.tpl-save-actions { display: flex; gap: 8px; }
.tpl-save-submit {
  background: var(--accent, #4f6ef7); color: #fff; border: none; border-radius: 6px;
  padding: 4px 12px; font-size: 12px; cursor: pointer;
}
.tpl-save-cancel {
  background: none; border: 1px solid #dfe3ec; border-radius: 6px;
  padding: 4px 12px; font-size: 12px; cursor: pointer; color: #6b7280;
}
.tpl-mine-empty { font-size: 11px; color: #b6bcc9; padding: 4px 2px; line-height: 1.5; }
</style>
