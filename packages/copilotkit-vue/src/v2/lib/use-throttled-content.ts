import { onBeforeUnmount, ref, watch, type Ref } from "vue";

/**
 * FORK-PATCH(23 stream-throttle): 流式渲染限频。
 *
 * 背景（收尾2 性能修复）：reasoning/assistant 消息把每个 SSE delta 直喂
 * StreamMarkdown —— 每次都全量 re-parse（含 shiki 高亮），内容越长越贵，
 * 长思考时主线程被 O(n²) 解析打满 → 页面卡顿。
 *
 * 本 composable 返回一个"限频跟随"的 ref：
 *  - active（流式中）：首个 delta 立即生效（leading），窗口内高频更新合并，
 *    窗口结束 trailing 补到最新 —— 每 intervalMs 最多一次；
 *  - active=false（流式结束/历史回放）：立即对齐最终值，直通不延迟。
 * 组件卸载（或显式 stop()）后 pending trailing 不再写值。
 */
export function useThrottledContent(
  source: Ref<string>,
  active: Ref<boolean>,
  intervalMs = 120,
): { content: Ref<string>; stop: () => void } {
  const throttled = ref(source.value);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastFlush = 0; // 0 = 从未 flush,首个 delta 立即

  function cancel() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }
  function flush() {
    cancel();
    lastFlush = Date.now();
    throttled.value = source.value;
  }
  function schedule() {
    if (timer !== null) return;
    const wait = Math.max(1, intervalMs - (Date.now() - lastFlush));
    timer = setTimeout(flush, wait);
  }

  const stopWatch = watch(source, () => {
    if (!active.value) {
      cancel();
      throttled.value = source.value;
      return;
    }
    if (lastFlush === 0 || Date.now() - lastFlush >= intervalMs) flush();
    else schedule();
  });
  const stopActive = watch(active, (a) => {
    if (!a) {
      cancel();
      throttled.value = source.value;
    }
  });

  function stop() {
    cancel();
    stopWatch();
    stopActive();
  }
  onBeforeUnmount(stop);

  return { content: throttled, stop };
}
