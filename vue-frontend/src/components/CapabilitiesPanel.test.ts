import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import CapabilitiesPanel from './CapabilitiesPanel.vue'

/**
 * 能力清单面板（CapabilitiesPanel）：
 * GET /agui-api/capabilities 拉取 opencode server 侧五类能力（serverTools/plugins/agents/skills/commands），
 * 前端 frontend tools 走 props（不经网络）。六区展示 + 计数徽标 + server 工具按 source 分组徽标。
 */

interface CapsPayload {
  serverTools?: { name: string; description?: string; source?: string }[]
  plugins?: { name: string; detail?: string }[]
  agents?: { name: string; description?: string; mode?: string; model?: string }[]
  skills?: { name: string; description?: string }[]
  commands?: { name: string; description?: string }[]
}

const CAPS: Required<CapsPayload> = {
  serverTools: [
    { name: 'read', description: 'Read a file', source: 'builtin' },
    { name: 'write', description: 'Write a file', source: 'builtin' },
    { name: 'render_a2ui_surface', description: '渲染 A2UI surface', source: 'plugin' },
    { name: 'query_db', description: '查询数据库', source: 'custom' },
  ],
  plugins: [{ name: 'a2ui-tools', detail: '5 个服务端裁决工具' }],
  agents: [{ name: 'build', description: '默认构建 agent', mode: 'primary', model: 'deepseek-chat' }],
  skills: [{ name: 'data-analysis', description: '数据分析技能' }],
  commands: [{ name: 'init', description: '初始化项目配置' }],
}

function mockFetchOnce(body: CapsPayload, init?: { ok?: boolean; status?: number }) {
  return vi.fn().mockResolvedValue({
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: () => Promise.resolve(body),
  })
}

async function flush() {
  await nextTick(); await nextTick(); await nextTick()
}

describe('CapabilitiesPanel（能力清单）', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('六区渲染：Server 工具 / 前端工具 / 插件 / Agents / Skills / Commands，各带计数徽标', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(CAPS))
    const wrapper = mount(CapabilitiesPanel, {
      props: { frontendTools: [{ name: 'showNotification', description: 'toast' }] },
    })
    await flush()

    for (const id of ['server-tools', 'frontend-tools', 'plugins', 'agents', 'skills', 'commands']) {
      expect(wrapper.find(`[data-testid="section-${id}"]`).exists(), `缺少分区 ${id}`).toBe(true)
    }
    expect(wrapper.find('[data-testid="count-server-tools"]').text()).toBe('4')
    expect(wrapper.find('[data-testid="count-frontend-tools"]').text()).toBe('1')
    expect(wrapper.find('[data-testid="count-plugins"]').text()).toBe('1')
    expect(wrapper.find('[data-testid="count-agents"]').text()).toBe('1')
    expect(wrapper.find('[data-testid="count-skills"]').text()).toBe('1')
    expect(wrapper.find('[data-testid="count-commands"]').text()).toBe('1')
    expect(wrapper.text()).toContain('render_a2ui_surface')
    expect(wrapper.text()).toContain('a2ui-tools')
    expect(wrapper.text()).toContain('data-analysis')
    expect(wrapper.text()).toContain('init')
  })

  it('server 工具按 source 分组徽标（builtin/plugin/custom 各自计数）', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(CAPS))
    const wrapper = mount(CapabilitiesPanel)
    await flush()

    const section = wrapper.find('[data-testid="section-server-tools"]')
    const builtin = section.find('[data-testid="src-badge-builtin"]')
    const plugin = section.find('[data-testid="src-badge-plugin"]')
    const custom = section.find('[data-testid="src-badge-custom"]')
    expect(builtin.exists()).toBe(true)
    expect(builtin.text()).toContain('builtin')
    expect(builtin.text()).toContain('2')
    expect(plugin.text()).toContain('plugin')
    expect(plugin.text()).toContain('1')
    expect(custom.text()).toContain('custom')
    expect(custom.text()).toContain('1')
  })

  it('前端工具来自 props（不发网络请求），server 侧只拉一次 capabilities', async () => {
    const fetchMock = mockFetchOnce(CAPS)
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(CapabilitiesPanel, {
      props: {
        frontendTools: [
          { name: 'showNotification', description: 'toast' },
          { name: 'applySpreadsheetEdits' },
        ],
      },
    })
    await flush()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/agui-api/capabilities')
    const section = wrapper.find('[data-testid="section-frontend-tools"]')
    expect(section.text()).toContain('showNotification')
    expect(section.text()).toContain('applySpreadsheetEdits')
    expect(wrapper.find('[data-testid="count-frontend-tools"]').text()).toBe('2')
  })

  it('agent 区展示当前 agent 配置（mode / model / description）', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(CAPS))
    const wrapper = mount(CapabilitiesPanel)
    await flush()

    const section = wrapper.find('[data-testid="section-agents"]')
    expect(section.text()).toContain('build')
    expect(section.text()).toContain('primary')
    expect(section.text()).toContain('deepseek-chat')
    expect(section.text()).toContain('默认构建 agent')
  })

  it('loading 态显示加载指示，完成后消失', async () => {
    let resolveFetch!: (v: unknown) => void
    vi.stubGlobal('fetch', vi.fn().mockImplementation(
      () => new Promise((r) => { resolveFetch = r }),
    ))
    const wrapper = mount(CapabilitiesPanel)
    await nextTick()
    expect(wrapper.find('[data-testid="caps-loading"]').exists()).toBe(true)

    resolveFetch({ ok: true, json: () => Promise.resolve(CAPS) })
    await flush()
    expect(wrapper.find('[data-testid="caps-loading"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('read')
  })

  it('error 态给出错误信息与重试按钮，点击重试重新拉取成功', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(CAPS) })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(CapabilitiesPanel)
    await flush()

    const err = wrapper.find('[data-testid="caps-error"]')
    expect(err.exists()).toBe(true)
    expect(err.text()).toContain('500')
    // 错误态不渲染分区内容
    expect(wrapper.find('[data-testid="section-server-tools"]').exists()).toBe(false)

    await wrapper.find('[data-testid="caps-retry"]').trigger('click')
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="caps-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="section-server-tools"]').exists()).toBe(true)
  })

  it('空态：server 侧全部为空时各分区显示"暂无"空态（前端工具区不受网络影响）', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({}))
    const wrapper = mount(CapabilitiesPanel, {
      props: { frontendTools: [{ name: 'showNotification' }] },
    })
    await flush()

    for (const id of ['server-tools', 'plugins', 'agents', 'skills', 'commands']) {
      expect(wrapper.find(`[data-testid="empty-${id}"]`).exists(), `分区 ${id} 应有空态`).toBe(true)
      expect(wrapper.find(`[data-testid="count-${id}"]`).text()).toBe('0')
    }
    // 前端工具区有 props 数据，不出空态
    expect(wrapper.find('[data-testid="empty-frontend-tools"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="count-frontend-tools"]').text()).toBe('1')
  })

  it('手动刷新按钮重新拉取 capabilities', async () => {
    const fetchMock = mockFetchOnce(CAPS)
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(CapabilitiesPanel)
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await wrapper.find('[data-testid="caps-refresh"]').trigger('click')
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
