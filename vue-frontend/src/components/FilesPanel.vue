<script setup lang="ts">
import { toRef } from 'vue'
import { useWorkspaceFiles } from '../composables/useWorkspaceFiles'
import FileTree from './FileTree.vue'

/**
 * workspace 文件面板（spec: docs/spec/workspace-files.md + workspace-isolation.md）。
 * P33-C 两区布局：
 *  - 会话文件：当前 threadId 的隔离目录（workspace/threads/<id>/），仅本会话可见；
 *    未选会话时显示空态引导，不发请求。
 *  - 公共数据：共享根（workspace/，legacy /agui-api/files），所有会话可见；
 *    agent 侧只读（P33-A 提示词约定 + P33-B workspace-guard 插件硬拦），
 *    用户可在此上传/管理各会话共用的参考数据。
 * 树交互（导航/预览/上传/删除/编辑）在 FileTree.vue，两区各一个实例互不串状态。
 */
const props = defineProps<{ threadId?: string }>()
const sessionApi = useWorkspaceFiles(toRef(props, 'threadId'))
const sharedApi = useWorkspaceFiles()
</script>

<template>
  <div class="files-panel" data-testid="files-panel">
    <div class="sidebar-head">
      <span class="sidebar-title">数据文件</span>
    </div>
    <div class="zones">
      <section class="zone" data-testid="zone-session">
        <header class="zone-head">
          <span class="zone-title">会话文件</span>
          <span class="zone-badge">仅本会话</span>
        </header>
        <p v-if="!props.threadId" class="zone-empty" data-testid="zone-session-empty">
          选择或新建一个会话后，这里展示该会话独立的数据文件（各会话相互隔离）。
        </p>
        <FileTree v-else :api="sessionApi" :thread-id="props.threadId" />
      </section>
      <section class="zone" data-testid="zone-shared">
        <header class="zone-head">
          <span class="zone-title">公共数据</span>
          <span class="zone-badge shared">所有会话共享 · agent 只读</span>
        </header>
        <FileTree :api="sharedApi" />
      </section>
    </div>
  </div>
</template>

<style scoped>
.files-panel { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.sidebar-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 14px 6px; }
.sidebar-title { font-size: 13px; font-weight: 600; color: #6b7280; }
.zones { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }
.zone { padding-bottom: 10px; }
.zone + .zone { border-top: 1px solid #f1f5f9; }
.zone-head { display: flex; align-items: center; gap: 8px; padding: 10px 14px 6px; }
.zone-title { font-size: 12.5px; font-weight: 600; color: #374151; }
.zone-badge {
  font-size: 11px; color: #6b7280; background: #f1f5f9;
  border-radius: 999px; padding: 1px 8px; white-space: nowrap;
}
.zone-badge.shared { color: #0369a1; background: #e0f2fe; }
.zone-empty { font-size: 12px; color: #9ca3af; margin: 0 14px 8px; line-height: 1.6; }
</style>
