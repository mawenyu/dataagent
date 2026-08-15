import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RunErrorCard from './RunErrorCard.vue'

/** P-B: 内联错误卡 —— 原因展示 / 重试 / 关闭 / loading 态。 */

describe('RunErrorCard (P-B)', () => {
  it('展示失败原因,点重试发 retry,点 × 发 dismiss', async () => {
    const w = mount(RunErrorCard, { props: { message: 'model timeout after 120s' } })
    expect(w.find('[data-testid="run-error-message"]').text()).toBe('model timeout after 120s')
    await w.find('[data-testid="run-error-retry"]').trigger('click')
    expect(w.emitted('retry')).toHaveLength(1)
    await w.find('[data-testid="run-error-dismiss"]').trigger('click')
    expect(w.emitted('dismiss')).toHaveLength(1)
  })

  it('busy 态: 按钮禁用且显示"重试中…"', async () => {
    const w = mount(RunErrorCard, { props: { message: 'x', busy: true } })
    const btn = w.find('[data-testid="run-error-retry"]')
    expect(btn.text()).toBe('重试中…')
    expect(btn.attributes('disabled')).toBeDefined()
    await btn.trigger('click')
    expect(w.emitted('retry')).toBeUndefined()
  })
})

describe('RunErrorCard 错误码 (P-I)', () => {
  it('有 code 时显示结构化错误码徽章;无 code 不渲染', async () => {
    const w = mount(RunErrorCard, { props: { message: '网关错误,服务暂时不可用', code: '502' } })
    expect(w.find('[data-testid="run-error-code"]').text()).toBe('502')

    await w.setProps({ code: null })
    expect(w.find('[data-testid="run-error-code"]').exists()).toBe(false)
  })
})
