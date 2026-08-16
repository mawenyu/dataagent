import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PROMPT_TEMPLATES, templatesByGroup } from './promptTemplates'

/** P-b: 模板数据源契约 —— id 唯一、prompt 非空、两组都有内容（防面板/欢迎页漂移）。 */
describe('promptTemplates (P-b)', () => {
  it('id 全局唯一且 prompt 非空', () => {
    const ids = PROMPT_TEMPLATES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const t of PROMPT_TEMPLATES) {
      expect(t.prompt.trim().length, `${t.id} prompt`).toBeGreaterThan(0)
      expect(t.title.trim().length, `${t.id} title`).toBeGreaterThan(0)
    }
  })

  it('开场组含 P-D 四卡 + 新增数据分析场景(环比对比/异常检测/用户画像)', () => {
    const titles = templatesByGroup('开场').map((t) => t.title)
    // P-D 既有四卡标题不漂移
    for (const t of ['销售分析', '可视化看板', '周报生成', '数据清洗']) {
      expect(titles).toContain(t)
    }
    // 模板库新增三场景
    for (const t of ['环比对比', '异常检测', '用户画像']) {
      expect(titles).toContain(t)
    }
    expect(templatesByGroup('开场').length).toBeGreaterThanOrEqual(7)
  })

  it('追问组提供快捷指令且与开场组不重叠', () => {
    const followUps = templatesByGroup('追问')
    expect(followUps.length).toBeGreaterThanOrEqual(3)
    const openers = new Set(templatesByGroup('开场').map((t) => t.prompt))
    for (const t of followUps) expect(openers.has(t.prompt)).toBe(false)
  })
})

/** 模板库：用户自定义模板 —— localStorage 持久化 CRUD。 */
describe('useUserTemplates（用户自定义模板）', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  async function load() {
    return await import('./promptTemplates')
  }

  it('保存模板 → 立即可见且写入 localStorage', async () => {
    const { useUserTemplates } = await load()
    const api = useUserTemplates()
    const t = api.save({ title: '我的月度复盘', prompt: '汇总本月数据并对比上月：…' })
    expect(t.id).toMatch(/^user-/)
    expect(api.templates.value.map((x) => x.title)).toContain('我的月度复盘')
    const raw = JSON.parse(localStorage.getItem('dataagent.user-templates.v1') ?? '[]')
    expect(raw).toHaveLength(1)
    expect(raw[0].prompt).toContain('汇总本月数据')
  })

  it('重新加载模块后用户模板从 localStorage 恢复', async () => {
    const { useUserTemplates } = await load()
    useUserTemplates().save({ title: '持久化卡', prompt: 'p1' })
    vi.resetModules()
    const fresh = await import('./promptTemplates')
    expect(fresh.useUserTemplates().templates.value.map((t) => t.title)).toContain('持久化卡')
  })

  it('删除用户模板并持久化；内置模板 id 拒绝删除', async () => {
    const { useUserTemplates, PROMPT_TEMPLATES: builtin } = await load()
    const api = useUserTemplates()
    const t = api.save({ title: '待删', prompt: 'p' })
    expect(api.remove(t.id)).toBe(true)
    expect(api.templates.value).toHaveLength(0)
    expect(localStorage.getItem('dataagent.user-templates.v1')).toBe('[]')
    // 内置模板不可经用户通道删除
    expect(api.remove(builtin[0].id)).toBe(false)
  })

  it('空标题/空 prompt 拒绝保存', async () => {
    const { useUserTemplates } = await load()
    const api = useUserTemplates()
    expect(() => api.save({ title: '  ', prompt: 'p' })).toThrow()
    expect(() => api.save({ title: 't', prompt: ' ' })).toThrow()
    expect(api.templates.value).toHaveLength(0)
  })

  it('localStorage 数据损坏 → 回退空列表不炸', async () => {
    localStorage.setItem('dataagent.user-templates.v1', '{broken json')
    const { useUserTemplates } = await load()
    expect(useUserTemplates().templates.value).toEqual([])
  })

  it('用户模板 group 为 我的,desc 缺省给默认文案', async () => {
    const { useUserTemplates } = await load()
    const api = useUserTemplates()
    const t = api.save({ title: 'x', prompt: 'y' })
    expect(t.group).toBe('我的')
    expect(t.desc).toBe('自定义模板')
  })
})
