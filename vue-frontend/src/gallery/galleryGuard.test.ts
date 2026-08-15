import { describe, expect, it } from 'vitest'
import { GALLERY_BATCHES } from './surfaces'
import { DATA_AGENT_CUSTOM_COMPONENTS } from '../a2ui/dataAgentCatalog'

/**
 * vision-P2 画廊守护：surface 里出现的每个组件必须落在白名单
 * （18 basic + 10 custom，与 gateway A2UiBridgeService.ALLOWED_COMPONENTS 同源），
 * 且 5 个批次合计覆盖全部 28 个组件（矩阵 docs/spec/a2ui-component-matrix.md）。
 */
const BASIC_18 = [
  'Text', 'Image', 'Icon', 'Video', 'AudioPlayer',
  'Row', 'Column', 'List', 'Card', 'Tabs', 'Divider', 'Modal',
  'Button', 'TextField', 'CheckBox', 'ChoicePicker', 'Slider', 'DateTimeInput',
]
const WHITELIST = new Set([...BASIC_18, ...DATA_AGENT_CUSTOM_COMPONENTS])

function collectComponents(ops: any[]): string[] {
  const names: string[] = []
  for (const op of ops) {
    for (const c of op?.updateComponents?.components ?? []) names.push(c.component)
  }
  return names
}

describe('gallery surfaces (vision-P2)', () => {
  it('每批 surface 的组件都在白名单内，且 root id = root', () => {
    for (const [key, b] of Object.entries(GALLERY_BATCHES)) {
      // vision-P4: edge 批故意注入白名单外组件（Gauge）验证前端降级渲染，豁免
      if (key === 'edge') continue
      const used = collectComponents(b.operations)
      for (const name of used) {
        expect(WHITELIST.has(name), `batch=${key} 组件 ${name} 不在白名单`).toBe(true)
      }
      const root = b.operations[1].updateComponents.components.find((c: any) => c.id === 'root')
      expect(root, `batch=${key} 缺 root`).toBeTruthy()
    }
  })

  it('每批声明的组件清单与实际使用一致（矩阵对应关系）', () => {
    for (const [key, b] of Object.entries(GALLERY_BATCHES)) {
      const used = new Set(collectComponents(b.operations))
      for (const declared of b.components) {
        expect(used.has(declared), `batch=${key} 声明的 ${declared} 未实际使用`).toBe(true)
      }
    }
  })

  it('5 批合计覆盖全部 28 个组件', () => {
    const covered = new Set<string>()
    for (const b of Object.values(GALLERY_BATCHES)) {
      b.components.forEach((c) => covered.add(c))
    }
    for (const name of WHITELIST) {
      expect(covered.has(name), `组件 ${name} 未被任何批次覆盖`).toBe(true)
    }
    expect(covered.size).toBe(28)
  })
})
