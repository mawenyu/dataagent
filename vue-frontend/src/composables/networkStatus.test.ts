import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { useNetworkStatus } from './networkStatus'

/** P-I: 网络断开/恢复检测(window online/offline 事件)。 */

function mountHarness(cbs: { onOnline?: () => void; onOffline?: () => void } = {}) {
  let api!: ReturnType<typeof useNetworkStatus>
  const Harness = defineComponent({
    setup() {
      api = useNetworkStatus(cbs)
      return {}
    },
    template: '<div />',
  })
  const wrapper = mount(Harness)
  return { api, wrapper }
}

describe('useNetworkStatus (P-I)', () => {
  it('初始在线;offline 事件 → online=false + onOffline 回调', () => {
    const onOffline = vi.fn()
    const { api, wrapper } = mountHarness({ onOffline })
    expect(api.online.value).toBe(true)

    window.dispatchEvent(new Event('offline'))
    expect(api.online.value).toBe(false)
    expect(onOffline).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('online 事件 → online=true + onOnline 回调', () => {
    const onOnline = vi.fn()
    const { api, wrapper } = mountHarness({ onOnline })
    window.dispatchEvent(new Event('offline'))
    expect(api.online.value).toBe(false)
    window.dispatchEvent(new Event('online'))
    expect(api.online.value).toBe(true)
    expect(onOnline).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('卸载后移除监听,不再触发回调', () => {
    const onOffline = vi.fn()
    const { wrapper } = mountHarness({ onOffline })
    wrapper.unmount()
    window.dispatchEvent(new Event('offline'))
    expect(onOffline).not.toHaveBeenCalled()
    // 恢复环境,避免影响其他测试文件(同进程 jsdom 共享 window 事件无状态,但语义上复位)
    window.dispatchEvent(new Event('online'))
  })
})
