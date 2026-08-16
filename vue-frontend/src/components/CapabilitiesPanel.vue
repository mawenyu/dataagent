<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useCapabilities, type ServerTool } from '../composables/useCapabilities'

/**
 * 能力清单面板：一览 DataAgent 全部能力。
 * server 侧五类（工具/插件/agents/skills/commands）走 GET /agui-api/capabilities（useCapabilities）；
 * 前端 frontend tools 由 App.vue 从既有 frontendTools 数组经 props 传入（不经网络）。
 * 交互模式对齐 FilesPanel（侧栏 Tab 切换，App.vue 驱动接线）。
 */

export interface FrontendToolInfo { name: string; description?: string }

const props = withDefaults(defineProps<{ frontendTools?: FrontendToolInfo[] }>(), {
  frontendTools: () => [],
})

const api = useCapabilities()
onMounted(() => void api.ensureLoaded())

/** server 工具按 source 分组：builtin → plugin → custom → 其他未知来源排最后。 */
const SOURCE_ORDER = ['builtin', 'plugin', 'custom']
const toolGroups = computed(() => {
  const map = new Map<string, ServerTool[]>()
  for (const t of api.serverTools.value) {
    const src = t.source ?? 'custom'
    const list = map.get(src)
    if (list) list.push(t)
    else map.set(src, [t])
  }
  const rank = (s: string) => {
    const i = SOURCE_ORDER.indexOf(s)
    return i === -1 ? SOURCE_ORDER.length : i
  }
  return [...map.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([source, tools]) => ({ source, tools }))
})

const frontendCount = computed(() => props.frontendTools.length)
</script>

<template>
  <div class="caps-panel" data-testid="capabilities-panel">
    <div class="sidebar-head">
      <span class="sidebar-title">能力清单</span>
      <button
        class="new-btn"
        data-testid="caps-refresh"
        :disabled="api.loading.value"
        title="重新拉取 server 能力清单"
        @click="api.refresh()"
      >{{ api.loading.value ? '加载中…' : '⟳ 刷新' }}</button>
    </div>

    <div v-if="api.loading.value && !api.loaded.value" class="state" data-testid="caps-loading">
      加载能力清单中…
    </div>

    <div v-else-if="api.error.value && !api.loaded.value" class="state error-state" data-testid="caps-error">
      <p class="error-text">能力清单加载失败：{{ api.error.value }}</p>
      <button class="retry-btn" data-testid="caps-retry" @click="api.refresh()">重试</button>
    </div>

    <div v-else class="caps-body">
      <!-- Server 工具（按 source 分组徽标） -->
      <section class="cap-section" data-testid="section-server-tools">
        <h3 class="cap-head">
          Server 工具
          <span class="count-badge" data-testid="count-server-tools">{{ api.serverTools.value.length }}</span>
        </h3>
        <div v-if="toolGroups.length > 0" class="cap-list">
          <div v-for="g in toolGroups" :key="g.source" class="src-group">
            <span class="src-badge" :class="`src-${g.source}`" :data-testid="`src-badge-${g.source}`">
              {{ g.source }} {{ g.tools.length }}
            </span>
            <div v-for="t in g.tools" :key="`${g.source}:${t.name}`" class="cap-item">
              <span class="cap-name">{{ t.name }}</span>
              <span v-if="t.description" class="cap-desc">{{ t.description }}</span>
            </div>
          </div>
        </div>
        <div v-else class="cap-empty" data-testid="empty-server-tools">暂无 server 工具</div>
      </section>

      <!-- 前端工具（props，不经网络） -->
      <section class="cap-section" data-testid="section-frontend-tools">
        <h3 class="cap-head">
          前端工具
          <span class="count-badge" data-testid="count-frontend-tools">{{ frontendCount }}</span>
        </h3>
        <div v-if="frontendCount > 0" class="cap-list">
          <div v-for="t in props.frontendTools" :key="t.name" class="cap-item">
            <span class="cap-name">{{ t.name }}</span>
            <span v-if="t.description" class="cap-desc">{{ t.description }}</span>
          </div>
        </div>
        <div v-else class="cap-empty" data-testid="empty-frontend-tools">暂无前端工具</div>
      </section>

      <!-- 插件 -->
      <section class="cap-section" data-testid="section-plugins">
        <h3 class="cap-head">
          插件
          <span class="count-badge" data-testid="count-plugins">{{ api.plugins.value.length }}</span>
        </h3>
        <div v-if="api.plugins.value.length > 0" class="cap-list">
          <div v-for="p in api.plugins.value" :key="p.name" class="cap-item">
            <span class="cap-name">{{ p.name }}</span>
            <span v-if="p.detail" class="cap-desc">{{ p.detail }}</span>
          </div>
        </div>
        <div v-else class="cap-empty" data-testid="empty-plugins">暂无插件</div>
      </section>

      <!-- Agents（当前 agent 配置：mode / model / description） -->
      <section class="cap-section" data-testid="section-agents">
        <h3 class="cap-head">
          Agents
          <span class="count-badge" data-testid="count-agents">{{ api.agents.value.length }}</span>
        </h3>
        <div v-if="api.agents.value.length > 0" class="cap-list">
          <div v-for="a in api.agents.value" :key="a.name" class="cap-item agent-item">
            <div class="agent-row">
              <span class="cap-name">{{ a.name }}</span>
              <span v-if="a.mode" class="meta-badge mode-badge">{{ a.mode }}</span>
              <span v-if="a.model" class="meta-badge model-chip">{{ a.model }}</span>
            </div>
            <span v-if="a.description" class="cap-desc">{{ a.description }}</span>
          </div>
        </div>
        <div v-else class="cap-empty" data-testid="empty-agents">暂无 agents</div>
      </section>

      <!-- Skills -->
      <section class="cap-section" data-testid="section-skills">
        <h3 class="cap-head">
          Skills
          <span class="count-badge" data-testid="count-skills">{{ api.skills.value.length }}</span>
        </h3>
        <div v-if="api.skills.value.length > 0" class="cap-list">
          <div v-for="s in api.skills.value" :key="s.name" class="cap-item">
            <span class="cap-name">{{ s.name }}</span>
            <span v-if="s.description" class="cap-desc">{{ s.description }}</span>
          </div>
        </div>
        <div v-else class="cap-empty" data-testid="empty-skills">暂无 skills</div>
      </section>

      <!-- Commands -->
      <section class="cap-section" data-testid="section-commands">
        <h3 class="cap-head">
          Commands
          <span class="count-badge" data-testid="count-commands">{{ api.commands.value.length }}</span>
        </h3>
        <div v-if="api.commands.value.length > 0" class="cap-list">
          <div v-for="c in api.commands.value" :key="c.name" class="cap-item">
            <span class="cap-name">/{{ c.name }}</span>
            <span v-if="c.description" class="cap-desc">{{ c.description }}</span>
          </div>
        </div>
        <div v-else class="cap-empty" data-testid="empty-commands">暂无 commands</div>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* 风格对齐 FilesPanel：同 palette / sidebar-head / new-btn / empty 约定 */
.caps-panel { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.sidebar-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 14px 6px; }
.sidebar-title { font-size: 13px; font-weight: 600; color: #6b7280; }
.new-btn {
  font-size: 12.5px; color: #4338ca; background: #eef2ff;
  border: 1px solid #e0e7ff; border-radius: 8px; padding: 5px 10px; cursor: pointer;
}
.new-btn:hover { background: #e0e7ff; }
.new-btn:disabled { opacity: 0.5; cursor: default; }

.state { padding: 28px 20px; text-align: center; color: #9ca3af; font-size: 12.5px; }
.error-state { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.error-text { margin: 0; font-size: 12px; color: #b91c1c; }
.retry-btn {
  font-size: 12.5px; font-weight: 600; color: #4338ca;
  background: #eef2ff; border: 1px solid #e0e7ff; border-radius: 8px;
  padding: 6px 16px; cursor: pointer;
}
.retry-btn:hover { background: #e0e7ff; }

.caps-body { flex: 1; overflow-y: auto; padding: 0 8px 12px; }
.cap-section { margin-bottom: 10px; }
.cap-head {
  display: flex; align-items: center; gap: 6px;
  margin: 0; padding: 8px 6px 4px;
  font-size: 12px; font-weight: 600; color: #6b7280;
  text-transform: none;
}
.count-badge {
  font-size: 10.5px; font-weight: 600; color: #4338ca;
  background: #eef2ff; border-radius: 999px; padding: 1px 7px;
}
.cap-list { display: flex; flex-direction: column; }
.cap-item {
  display: flex; flex-direction: column; gap: 1px;
  padding: 6px 10px; margin-bottom: 2px; border-radius: 8px;
}
.cap-item:hover { background: #f1f5f9; }
.cap-name { font-size: 13px; color: #374151; font-weight: 500; overflow-wrap: anywhere; }
.cap-desc { font-size: 11.5px; color: #9ca3af; overflow-wrap: anywhere; }

/* server 工具 source 分组徽标 */
.src-group { margin-bottom: 2px; }
.src-badge {
  display: inline-block; margin: 4px 10px 2px;
  font-size: 10.5px; font-weight: 600; border-radius: 999px; padding: 1px 8px;
}
.src-builtin { color: #166534; background: #dcfce7; }
.src-plugin { color: #4338ca; background: #eef2ff; }
.src-custom { color: #9a3412; background: #ffedd5; }

/* agent 区 mode/model 徽标 */
.agent-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.meta-badge { font-size: 10.5px; font-weight: 600; border-radius: 999px; padding: 1px 8px; }
.mode-badge { color: #0e7490; background: #cffafe; }
.model-chip { color: #6d28d9; background: #ede9fe; }

.cap-empty { padding: 8px 10px 10px; font-size: 12px; color: #9ca3af; }
</style>
