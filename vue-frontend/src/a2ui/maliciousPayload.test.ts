import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { h, nextTick } from 'vue'
import { A2UISurfaceActivityRenderer, CopilotKitProvider } from '@copilotkit/vue'
import { HttpAgent } from '@ag-ui/client'
import { DATA_AGENT_CATALOG_ID, dataAgentCatalog } from './dataAgentCatalog'

/**
 * P13: 恶意/畸形 surface payload 防护（spec 附录: a2ui-component-matrix.md P4 边界续）。
 * 断言原则：不崩溃 + 不执行注入（无 script/iframe 元素、文本按字面转义渲染）。
 * jsdom 不执行脚本，故以 DOM 结构断言为准（无 <script>/<iframe>/on* 属性节点）。
 */
function mountSurface(components: any[], data?: Record<string, any>) {
  const operations: any[] = [
    { version: 'v0.9', createSurface: { surfaceId: 'sec', catalogId: DATA_AGENT_CATALOG_ID } },
    { version: 'v0.9', updateComponents: { surfaceId: 'sec', components } },
  ]
  if (data) {
    operations.push({ version: 'v0.9', updateDataModel: { surfaceId: 'sec', path: '/', value: data } })
  }
  const agent = new HttpAgent({ url: '/unused-in-test' })
  return mount(CopilotKitProvider as any, {
    props: { directAgents: { default: agent }, a2ui: { catalog: dataAgentCatalog, includeSchema: true } },
    slots: {
      default: () =>
        h(A2UISurfaceActivityRenderer as any, {
          activityType: 'a2ui-surface',
          content: { operations },
          message: { id: 'a2ui-sec', role: 'activity', activityType: 'a2ui-surface', content: { operations } },
          catalog: dataAgentCatalog, theme: {}, agent,
        }),
    },
  })
}

const SCRIPT = '<script>window.__pwned = true</script>'
const IMG_ONERROR = '<img src=x onerror="window.__pwned=true">'

describe('P13 恶意/畸形 payload 防护', () => {
  it('XSS: Text 含 script/img-onerror → 按字面文本渲染，不产生可执行节点', async () => {
    const wrapper = mountSurface([
      { component: 'Column', id: 'root', children: ['t'] },
      { component: 'Text', id: 't', text: `恶意文本 ${SCRIPT}${IMG_ONERROR}` },
    ])
    await nextTick(); await nextTick()
    expect(wrapper.text()).toContain('恶意文本')
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.find('img').exists()).toBe(false)
    expect((window as any).__pwned).toBeUndefined()
  })

  it('XSS: Markdown 含原始 HTML/script/iframe → 不解析不执行', async () => {
    const wrapper = mountSurface([
      { component: 'Column', id: 'root', children: ['md'] },
      { component: 'Markdown', id: 'md', text: `# 标题\n${SCRIPT}\n<iframe src="https://evil.example"></iframe>\n正常 **加粗**` },
    ])
    await nextTick(); await nextTick()
    expect(wrapper.text()).toContain('加粗')
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.find('iframe').exists()).toBe(false)
    expect((window as any).__pwned).toBeUndefined()
  })

  it('XSS: 组件名/action 名/图标名带 HTML → 一律按数据处理', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const wrapper = mountSurface([
      { component: 'Column', id: 'root', children: ['bad', 'icon', 'btn'] },
      { component: IMG_ONERROR, id: 'bad', text: 'x' } as any,  // HTML 组件名
      { component: 'Icon', id: 'icon', name: IMG_ONERROR },
      {
        component: 'ActionButton', id: 'btn', label: '点我',
        action: { event: { name: `x" onmouseover="alert(1)`, context: {} } },
      },
    ])
    await nextTick(); await nextTick()
    expect(wrapper.text()).toContain('点我')
    expect(wrapper.find('script').exists()).toBe(false)
    // 占位文本以文本节点渲染（转义），不产生 img 节点
    expect(wrapper.find('img').exists()).toBe(false)
    // 无 on* 事件属性泄漏到 DOM
    expect(wrapper.html()).not.toContain('onmouseover="alert')
    warn.mockRestore()
  })

  it('非法组件类型：null/数字/对象 → 占位降级不崩', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const wrapper = mountSurface([
      { component: 'Column', id: 'root', children: ['n', 'num', 'obj', 'ok'] },
      { component: null, id: 'n' } as any,
      { component: 42, id: 'num' } as any,
      { component: { evil: true }, id: 'obj' } as any,
      { component: 'Text', id: 'ok', text: '存活' },
    ])
    await nextTick(); await nextTick()
    expect(wrapper.text()).toContain('存活')
    warn.mockRestore()
  })

  it('深嵌套：50 层 Column 正常渲染到最深处（前端层）', async () => {
    const comps: any[] = [{ component: 'Column', id: 'root', children: ['l1'] }]
    for (let i = 1; i <= 49; i++) {
      comps.push({ component: 'Column', id: `l${i}`, children: [i === 49 ? 'deep' : `l${i + 1}`] })
    }
    comps.push({ component: 'Text', id: 'deep', text: '第五十层' })
    const wrapper = mountSurface(comps)
    await nextTick(); await nextTick()
    expect(wrapper.text()).toContain('第五十层')
  })

  it('超长字符串：100KB 文本 + 10KB 标题 MetricCard 渲染不崩', async () => {
    const long = '长'.repeat(100 * 1024)
    const wrapper = mountSurface([
      { component: 'Column', id: 'root', children: ['t', 'm'] },
      { component: 'Text', id: 't', text: long },
      { component: 'MetricCard', id: 'm', title: '超长'.repeat(5000), value: '1' },
    ])
    await nextTick(); await nextTick()
    expect(wrapper.text()).toContain('长'.repeat(100))
    expect(wrapper.text()).toContain('超长')
  })

  it('javascript: / data: URL 在 Image/Video 上不崩（现代浏览器对 img src=javascript: 惰性）', async () => {
    const wrapper = mountSurface([
      { component: 'Column', id: 'root', children: ['i', 'v'] },
      { component: 'Image', id: 'i', url: 'javascript:alert(1)' },
      { component: 'Video', id: 'v', url: 'data:text/html,<script>alert(1)</script>' },
    ])
    await nextTick(); await nextTick()
    // 元素存在、页面存活；js 协议在 img/video src 上不可执行（浏览器语义）
    expect(wrapper.find('img').exists()).toBe(true)
    expect((window as any).__pwned).toBeUndefined()
  })
})
