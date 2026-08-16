import { describe, expect, it } from 'vitest'
import { isA2uiSurfaceMessage, scanA2uiOps } from './a2uiOps'

describe('scanA2uiOps', () => {
  it('提取去重 surfaceId（按出现序）+ 统计组件数', () => {
    const ops = [
      { createSurface: { surfaceId: 'dash-1', catalogId: 'cat' } },
      { updateComponents: { surfaceId: 'dash-1', components: [{ id: 'a' }, { id: 'b' }] } },
      { updateDataModel: { surfaceId: 'dash-1', data: {} } },
      { createSurface: { surfaceId: 'panel-2' } },
      { updateComponents: { surfaceId: 'panel-2', components: [{ id: 'c' }] } },
    ]
    const r = scanA2uiOps(ops)
    expect(r.surfaceIds).toEqual(['dash-1', 'panel-2'])
    expect(r.componentCount).toBe(3)
  })

  it('无 surfaceId 的 op 归 default；非对象条目跳过', () => {
    const r = scanA2uiOps([{ updateComponents: { components: [{ id: 'x' }] } }, null, 'junk', 42])
    expect(r.surfaceIds).toEqual(['default'])
    expect(r.componentCount).toBe(1)
  })

  it('非数组输入 → 空结果', () => {
    expect(scanA2uiOps(undefined)).toEqual({ surfaceIds: [], componentCount: 0 })
    expect(scanA2uiOps('{}')).toEqual({ surfaceIds: [], componentCount: 0 })
  })

  it('beginRendering/surfaceUpdate 形态也认', () => {
    const r = scanA2uiOps([
      { beginRendering: { surfaceId: 's1' } },
      { surfaceUpdate: { surfaceId: 's1', components: [{ id: 'a' }] } },
    ])
    expect(r.surfaceIds).toEqual(['s1'])
    expect(r.componentCount).toBe(1)
  })
})

describe('isA2uiSurfaceMessage', () => {
  it('role=activity + activityType=a2ui-surface + 非空 ops → true', () => {
    expect(
      isA2uiSurfaceMessage({
        role: 'activity',
        activityType: 'a2ui-surface',
        content: { a2ui_operations: [{ createSurface: { surfaceId: 's' } }] },
      }),
    ).toBe(true)
  })

  it('普通 assistant 消息 / 空 ops / 其他 activityType → false', () => {
    expect(isA2uiSurfaceMessage({ role: 'assistant', content: 'hi' })).toBe(false)
    expect(
      isA2uiSurfaceMessage({ role: 'activity', activityType: 'a2ui-surface', content: { a2ui_operations: [] } }),
    ).toBe(false)
    expect(
      isA2uiSurfaceMessage({ role: 'activity', activityType: 'other', content: { a2ui_operations: [{}] } }),
    ).toBe(false)
    expect(isA2uiSurfaceMessage(null)).toBe(false)
  })
})
