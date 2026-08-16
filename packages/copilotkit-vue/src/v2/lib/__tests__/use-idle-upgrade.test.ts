import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { useIdleUpgrade } from "../use-idle-upgrade";

/**
 * FORK#27 idle 再升格：流式结束的一次性真渲染（shiki/mermaid）延迟到主线程
 * 空闲（requestIdleCallback），RUN_FINISHED 后立刻解 loading 不阻塞交互。
 *
 * jsdom 无 requestIdleCallback —— 一套用例打桩 rIC 走真实路径，
 * 一套走 setTimeout 降级路径（fake timers）。
 */

function mountWith(active = ref(true)) {
  let api!: ReturnType<typeof useIdleUpgrade>;
  const Host = defineComponent({
    setup() {
      api = useIdleUpgrade(active);
      return () => null;
    },
  });
  const wrapper = mount(Host);
  return { api, wrapper, active };
}

describe("useIdleUpgrade（FORK#27）", () => {
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as Record<string, unknown>).requestIdleCallback;
    delete (globalThis as Record<string, unknown>).cancelIdleCallback;
  });

  describe("requestIdleCallback 路径", () => {
    let idleCb: ((deadline: unknown) => void) | null;
    let cancelled: number[];
    beforeEach(() => {
      idleCb = null;
      cancelled = [];
      (globalThis as Record<string, unknown>).requestIdleCallback = vi.fn(
        (cb: (deadline: unknown) => void) => {
          idleCb = cb;
          return 7;
        },
      );
      (globalThis as Record<string, unknown>).cancelIdleCallback = vi.fn(
        (id: number) => cancelled.push(id),
      );
    });

    it("active=true 期间恒未就绪（保持降级渲染）", async () => {
      const { api, active } = mountWith(ref(true));
      await nextTick();
      expect(api.upgradeReady.value).toBe(false);
      expect(idleCb).toBeNull(); // 流式中不挂 idle
      active.value = true;
      await nextTick();
      expect(api.upgradeReady.value).toBe(false);
    });

    it("active 翻 false 不立即升格，idle 回调触发才升格", async () => {
      const { api, active } = mountWith(ref(true));
      await nextTick();
      active.value = false;
      await nextTick();
      expect(api.upgradeReady.value).toBe(false); // 同一 tick 不升格（不阻塞收尾交互）
      expect(idleCb).not.toBeNull(); // 已挂 idle
      idleCb!({ didTimeout: false, timeRemaining: () => 50 });
      await nextTick();
      expect(api.upgradeReady.value).toBe(true);
    });

    it("rIC 携带 timeout 兜底（主线程长期忙也会触发）", async () => {
      const { active } = mountWith(ref(true));
      await nextTick();
      active.value = false;
      await nextTick();
      const ric = globalThis.requestIdleCallback as unknown as ReturnType<typeof vi.fn>;
      expect(ric.mock.calls[0][1]).toMatchObject({ timeout: expect.any(Number) });
    });

    it("卸载时取消 pending idle 回调，不再写值", async () => {
      const { api, wrapper, active } = mountWith(ref(true));
      active.value = false;
      await nextTick();
      wrapper.unmount();
      expect(cancelled).toContain(7);
      idleCb!({ didTimeout: true, timeRemaining: () => 0 });
      await nextTick();
      expect(api.upgradeReady.value).toBe(false);
    });

    it("重新进入 active=true 复位未就绪并取消 pending 回调", async () => {
      const { api, active } = mountWith(ref(true));
      active.value = false;
      await nextTick();
      active.value = true; // 新一轮 run 开始
      await nextTick();
      expect(api.upgradeReady.value).toBe(false);
      expect(cancelled).toContain(7);
    });
  });

  describe("setTimeout 降级路径（无 rIC）", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it("active 翻 false 后经 fallback 延迟升格", async () => {
      const { api, active } = mountWith(ref(true));
      active.value = false;
      await nextTick();
      expect(api.upgradeReady.value).toBe(false);
      vi.advanceTimersByTime(100);
      await nextTick();
      expect(api.upgradeReady.value).toBe(true);
    });

    it("卸载后 fallback 回调不再写值", async () => {
      const { api, wrapper, active } = mountWith(ref(true));
      active.value = false;
      await nextTick();
      wrapper.unmount();
      vi.advanceTimersByTime(1000);
      await nextTick();
      expect(api.upgradeReady.value).toBe(false);
    });
  });

  it("历史回放（挂载即 active=false）：立即就绪不延迟（保持现行行为）", async () => {
    const { api } = mountWith(ref(false));
    await nextTick();
    expect(api.upgradeReady.value).toBe(true);
  });
});
