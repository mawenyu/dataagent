import { ref } from 'vue'

/**
 * 能力清单（CapabilitiesPanel）：GET /agui-api/capabilities 一次性拉取
 * opencode server 侧注册的全部能力 —— 工具 / 插件 / agents / skills / commands。
 * 前端 frontend tools 不经网络（组件 props 传入，见 CapabilitiesPanel.vue）。
 *
 * 缓存语义：成功后数据留在 refs 内（loaded=true），ensureLoaded() 不重复拉取；
 * refresh() 强制重拉（手动刷新 / 错误重试）；重拉失败保留旧数据，只置 error。
 */

export interface ServerTool { name: string; description?: string; source?: string }
export interface PluginInfo { name: string; detail?: string }
export interface AgentInfo { name: string; description?: string; mode?: string; model?: string }
export interface SkillInfo { name: string; description?: string }
export interface CommandInfo { name: string; description?: string }

const API = '/agui-api/capabilities'

export function useCapabilities() {
  const serverTools = ref<ServerTool[]>([])
  const plugins = ref<PluginInfo[]>([])
  const agents = ref<AgentInfo[]>([])
  const skills = ref<SkillInfo[]>([])
  const commands = ref<CommandInfo[]>([])
  const loading = ref(false)
  const error = ref('')
  /** 是否已成功拉取过（缓存命中标记） */
  const loaded = ref(false)

  async function refresh() {
    loading.value = true
    error.value = ''
    try {
      const res = await fetch(API)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      serverTools.value = data.serverTools ?? []
      plugins.value = data.plugins ?? []
      agents.value = data.agents ?? []
      skills.value = data.skills ?? []
      commands.value = data.commands ?? []
      loaded.value = true
    } catch (e: any) {
      error.value = e?.message ?? '加载失败'
    } finally {
      loading.value = false
    }
  }

  /** 首次挂载用：已缓存（loaded）则不重复请求。 */
  async function ensureLoaded() {
    if (!loaded.value && !loading.value) await refresh()
  }

  return { serverTools, plugins, agents, skills, commands, loading, error, loaded, refresh, ensureLoaded }
}
