import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { h, nextTick } from 'vue'
import { A2UISurfaceActivityRenderer, CopilotKitProvider } from '@copilotkit/vue'
import { HttpAgent } from '@ag-ui/client'
import { DATA_AGENT_CATALOG_ID, dataAgentCatalog } from './dataAgentCatalog'

/**
 * vision-P5-2: 前端 A2UI 渲染性能基线（docs/perf/a2ui-baseline.md）。
 * jsdom 环境（比真实浏览器慢，数字作上界参考）；断言宽松回归线。
 * 实测数值打印在测试输出里并抄进基线文档。
 */
function mountTimed(components: any[], surfaces = 1) {
  const operations: any[] = []
  for (let s = 0; s < surfaces; s++) {
    const sid = surfaces === 1 ? 'perf' : `perf-${s}`
    operations.push({ version: 'v0.9', createSurface: { surfaceId: sid, catalogId: DATA_AGENT_CATALOG_ID } })
    // 每个 surface 独立命名空间（root id 各归各面），无需改写 id
    operations.push({ version: 'v0.9', updateComponents: { surfaceId: sid, components } })
  }
  const agent = new HttpAgent({ url: '/unused-in-test' })
  const t0 = performance.now()
  const wrapper = mount(CopilotKitProvider as any, {
    props: {
      directAgents: { default: agent },
      a2ui: { catalog: dataAgentCatalog, includeSchema: true },
    },
    slots: {
      default: () =>
        h(A2UISurfaceActivityRenderer as any, {
          activityType: 'a2ui-surface',
          content: { operations },
          message: { id: 'a2ui-perf', role: 'activity', activityType: 'a2ui-surface', content: { operations } },
          catalog: dataAgentCatalog,
          theme: {},
          agent,
        }),
    },
  })
  return { wrapper, t0 }
}

function bigComponents(n: number): any[] {
  const comps: any[] = [{
    component: 'Column', id: 'root',
    children: Array.from({ length: n - 1 }, (_, i) => `m${i}`),
  }]
  for (let i = 0; i < n - 1; i++) {
    comps.push({
      component: 'MetricCard', id: `m${i}`,
      title: `指标卡 ${i} —— 含一段不算短的标题文字`,
      value: `¥${100000 + i}`, delta: '+12.4% 环比增长', trend: 'up',
    })
  }
  return comps
}

describe('A2UI 前端渲染性能（vision-P5-2）', () => {
  it('单 surface 100 组件（gateway 上限）首屏渲染', async () => {
    const { wrapper, t0 } = mountTimed(bigComponents(100))
    await nextTick(); await nextTick()
    const ms = performance.now() - t0
    console.log(`[PERF] 单 surface 100 组件 jsdom 首屏: ${ms.toFixed(1)}ms`)
    expect(wrapper.text()).toContain('指标卡 98')
    expect(ms).toBeLessThan(5000) // 宽松回归线（jsdom 上界）
  }, 30000)

  it('多 surface 并发：5 surface × 20 组件', async () => {
    const { wrapper, t0 } = mountTimed(bigComponents(20), 5)
    await nextTick(); await nextTick()
    const ms = performance.now() - t0
    console.log(`[PERF] 5 surface × 20 组件 jsdom 首屏: ${ms.toFixed(1)}ms`)
    expect(wrapper.text()).toContain('指标卡 18')
    expect(ms).toBeLessThan(5000)
  }, 30000)

  it('同名 surface 就地更新（replace）耗时', async () => {
    const first = mountTimed(bigComponents(100))
    await nextTick(); await nextTick()
    // 同 surfaceId 再来一帧（replace 语义）
    const ops: any[] = [
      { version: 'v0.9', updateComponents: { surfaceId: 'perf', components: bigComponents(100) } },
    ]
    const t0 = performance.now()
    // 模拟第二帧到达：直接再 mount 一个同 id 的场景成本高，这里测 processor 重处理
    // （真实链路是 content 变化触发 processOperations；jsdom 下用新挂载近似上界）
    const second = mountTimed(bigComponents(100))
    await nextTick(); await nextTick()
    const ms = performance.now() - t0
    console.log(`[PERF] 100 组件 surface 二次渲染（近似 replace）: ${ms.toFixed(1)}ms`)
    expect(second.wrapper.text()).toContain('指标卡 98')
    expect(ms).toBeLessThan(5000)
  }, 30000)

  it('大 payload：1000 行 DataTable（data 模型 ~120KB JSON）', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      region: `区域${i % 7}`, sales: 10000 + i * 13, qty: i % 97, day: `08-${(i % 28) + 1}`,
    }))
    const payloadChars = JSON.stringify(rows).length
    const comps: any[] = [
      { component: 'Column', id: 'root', children: ['t'] },
      {
        component: 'DataTable', id: 't', title: '千行明细',
        columns: [{ key: 'region', label: '区域' }, { key: 'sales', label: '销售额' },
                  { key: 'qty', label: '数量' }, { key: 'day', label: '日期' }],
        rows: { path: 'rows' },
      },
    ]
    const operations: any[] = [
      { version: 'v0.9', createSurface: { surfaceId: 'perf', catalogId: DATA_AGENT_CATALOG_ID } },
      { version: 'v0.9', updateComponents: { surfaceId: 'perf', components: comps } },
      { version: 'v0.9', updateDataModel: { surfaceId: 'perf', path: '/', value: { rows } } },
    ]
    const agent = new HttpAgent({ url: '/unused-in-test' })
    const t0 = performance.now()
    const wrapper = mount(CopilotKitProvider as any, {
      props: { directAgents: { default: agent }, a2ui: { catalog: dataAgentCatalog, includeSchema: true } },
      slots: {
        default: () => h(A2UISurfaceActivityRenderer as any, {
          activityType: 'a2ui-surface', content: { operations },
          message: { id: 'a2ui-perf', role: 'activity', activityType: 'a2ui-surface', content: { operations } },
          catalog: dataAgentCatalog, theme: {}, agent,
        }),
      },
    })
    await nextTick(); await nextTick()
    const ms = performance.now() - t0
    console.log(`[PERF] 1000 行 DataTable（rows JSON ${(payloadChars / 1024).toFixed(0)}KB）jsdom 首屏: ${ms.toFixed(1)}ms`)
    expect(wrapper.text()).toContain('区域6')
    expect(ms).toBeLessThan(8000)
  }, 30000)
})
