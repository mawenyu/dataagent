import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { h, nextTick } from 'vue'
import { A2UISurfaceActivityRenderer, CopilotKitProvider } from '@copilotkit/vue'
import { HttpAgent } from '@ag-ui/client'
import { DATA_AGENT_CATALOG_ID, dataAgentCatalog } from './dataAgentCatalog'

/**
 * P6-A: 表单校验错误卡场景 —— A2UI checks 协议能力实测。
 * TextField/CheckBox 等 schema 原生带 checks（strict），binder 的 CHECKABLE
 * 行为对每条规则求值并注入 isValid/validationErrors —— 校验全部发生在
 * 前端（零网络往返），agent 只需在 surface 里声明规则。
 */
function mountSurface(components: any[], data?: Record<string, any>) {
  const operations: any[] = [
    { version: 'v0.9', createSurface: { surfaceId: 'p6form', catalogId: DATA_AGENT_CATALOG_ID } },
    { version: 'v0.9', updateComponents: { surfaceId: 'p6form', components } },
  ]
  if (data) {
    operations.push({ version: 'v0.9', updateDataModel: { surfaceId: 'p6form', path: '/', value: data } })
  }
  const agent = new HttpAgent({ url: '/unused-in-test' })
  return mount(CopilotKitProvider as any, {
    props: { directAgents: { default: agent }, a2ui: { catalog: dataAgentCatalog, includeSchema: true } },
    slots: {
      default: () =>
        h(A2UISurfaceActivityRenderer as any, {
          activityType: 'a2ui-surface',
          content: { operations },
          message: { id: 'a2ui-p6form', role: 'activity', activityType: 'a2ui-surface', content: { operations } },
          catalog: dataAgentCatalog, theme: {}, agent,
        }),
    },
  })
}

const FORM_COMPONENTS = [
  { component: 'Column', id: 'root', children: ['kw', 'submit'] },
  {
    component: 'TextField', id: 'kw', label: '品类关键词',
    value: { path: 'keyword' },
    checks: [
      { call: 'required', args: { value: { path: 'keyword' } }, message: '关键词必填' },
      { call: 'regex', args: { value: { path: 'keyword' }, pattern: '^.{2,}$' }, message: '至少 2 个字符' },
    ],
  },
  {
    // 提交按钮自身带 checks（镜像字段规则）→ 校验不过时 disabled
    component: 'Button', id: 'submit', child: 'submit-t', variant: 'primary',
    checks: [{ call: 'required', args: { value: { path: 'keyword' } }, message: '关键词必填' }],
    action: { event: { name: 'apply_filter', context: { keyword: { path: 'keyword' } } } },
  },
  { component: 'Text', id: 'submit-t', text: '应用筛选' },
]

describe('P6-A 表单校验错误卡（checks 协议）', () => {
  it('初始空值：字段级错误提示可见 + 提交按钮 disabled', async () => {
    const wrapper = mountSurface(FORM_COMPONENTS, { keyword: '' })
    await nextTick(); await nextTick(); await nextTick()
    expect(wrapper.text()).toContain('关键词必填')
    const input = wrapper.find('input')
    expect(input.exists()).toBe(true)
    expect(input.attributes('style')).toContain('red') // 红框
    const btn = wrapper.find('button')
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('输入合法值后错误消除、按钮解禁；再清空错误回归', async () => {
    const wrapper = mountSurface(FORM_COMPONENTS, { keyword: '' })
    await nextTick(); await nextTick(); await nextTick()
    const input = wrapper.find('input')
    const btn = wrapper.find('button')

    await input.setValue('钢笔')
    await nextTick(); await nextTick()
    expect(wrapper.text()).not.toContain('关键词必填')
    expect(btn.attributes('disabled')).toBeUndefined()

    await input.setValue('')
    await nextTick(); await nextTick()
    expect(wrapper.text()).toContain('关键词必填')
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('单字符触发 regex 规则（至少 2 个字符）', async () => {
    const wrapper = mountSurface(FORM_COMPONENTS, { keyword: '笔' })
    await nextTick(); await nextTick(); await nextTick()
    expect(wrapper.text()).toContain('至少 2 个字符')
    expect(wrapper.text()).not.toContain('关键词必填')
  })
})
