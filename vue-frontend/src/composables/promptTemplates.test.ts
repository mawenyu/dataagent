import { describe, expect, it } from 'vitest'
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

  it('开场组保留 P-D 既有四卡(标题不漂移)', () => {
    expect(templatesByGroup('开场').map((t) => t.title)).toEqual([
      '销售分析', '可视化看板', '周报生成', '数据清洗',
    ])
  })

  it('追问组提供快捷指令且与开场组不重叠', () => {
    const followUps = templatesByGroup('追问')
    expect(followUps.length).toBeGreaterThanOrEqual(3)
    const openers = new Set(templatesByGroup('开场').map((t) => t.prompt))
    for (const t of followUps) expect(openers.has(t.prompt)).toBe(false)
  })
})
