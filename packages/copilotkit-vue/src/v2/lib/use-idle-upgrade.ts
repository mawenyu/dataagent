import { onBeforeUnmount, ref, watch, type Ref } from "vue";

/**
 * FORK-PATCH(27 idle-upgrade): 流式结束的一次性"升格渲染"（shiki 高亮 +
 * mermaid 真渲染）延迟到主线程空闲。
 *
 * 背景（FORK#25 残余，实测 docs/evidence/2026-08-17-streaming-lag-recheck.txt）：
 * isStreaming 翻 false 的同一 commit 里 StreamMarkdown 同步全量 re-parse +
 * shiki + mermaid layout —— reasoning/answer 收尾各产生一次 0.5~4.8s 主线程
 * 阻塞。架构师决策：RUN_FINISHED 后立刻解 loading（降级形态已含完整内容：
 * plain code + mermaid 源码文本，全文立即可读），真渲染升格挂
 * requestIdleCallback 空闲执行。
 *
 * 语义：
 *  - active（流式中）：upgradeReady 恒 false —— 调用方保持降级渲染；
 *  - active 翻 false：挂 idle 回调（rIC 带 timeout 兜底；无 rIC 的环境
 *    如 Safari/jsdom 走 setTimeout(fallbackMs) 降级），回调触发才 true；
 *  - 重新进入 active=true：复位 false 并取消 pending 回调（新一轮 run）；
 *  - 挂载即 active=false（历史回放）：立即 true 不延迟，保持现行行为；
 *  - 组件卸载/显式 stop() 后 pending 回调不再写值。
 */
export function useIdleUpgrade(
  active: Ref<boolean>,
  opts?: { timeoutMs?: number; fallbackMs?: number },
): { upgradeReady: Ref<boolean>; stop: () => void } {
  const timeoutMs = opts?.timeoutMs ?? 2000;
  const fallbackMs = opts?.fallbackMs ?? 50;
  const upgradeReady = ref(!active.value); // 历史回放直通
  let idleId: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false; // 卸载后迟到的回调（rIC timeout 竞态）一律不再写值

  const hasRic = () => typeof globalThis.requestIdleCallback === "function";

  function cancel() {
    if (idleId !== null) {
      globalThis.cancelIdleCallback?.(idleId);
      idleId = null;
    }
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }
  function schedule() {
    cancel();
    if (hasRic()) {
      idleId = globalThis.requestIdleCallback!(
        () => {
          idleId = null;
          if (stopped) return;
          upgradeReady.value = true;
        },
        { timeout: timeoutMs },
      );
    } else {
      timer = setTimeout(() => {
        timer = null;
        if (stopped) return;
        upgradeReady.value = true;
      }, fallbackMs);
    }
  }

  const stopWatch = watch(active, (a) => {
    if (a) {
      cancel();
      upgradeReady.value = false;
    } else {
      schedule();
    }
  });

  function stop() {
    stopped = true;
    cancel();
    stopWatch();
  }
  onBeforeUnmount(stop);

  return { upgradeReady, stop };
}
