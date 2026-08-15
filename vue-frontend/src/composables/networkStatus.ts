import { onMounted, onUnmounted, ref } from 'vue'

/**
 * P-I: 网络在线状态(window online/offline 事件 + navigator.onLine 初值)。
 * SSE/fetch 断线最终会表现为 run 错误;本 composable 提供"物理层"在线态,
 * 供顶栏离线徽章与"恢复后自动续跑"编排使用。
 */
export function useNetworkStatus(deps: {
  onOnline?: () => void
  onOffline?: () => void
} = {}) {
  const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine)

  function handleOnline() {
    online.value = true
    deps.onOnline?.()
  }
  function handleOffline() {
    online.value = false
    deps.onOffline?.()
  }

  onMounted(() => {
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
  })
  onUnmounted(() => {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
  })

  return { online }
}
