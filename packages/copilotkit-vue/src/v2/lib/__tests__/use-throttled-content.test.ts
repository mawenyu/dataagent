import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref, watch } from "vue";
import { useThrottledContent } from "../use-throttled-content";

/**
 * 收尾2 性能修复（长 reasoning 卡顿）:
 * StreamMarkdown 全量 re-parse（含 shiki）不跟随每个 SSE delta ——
 * 流式期间限频尾随，结束时立即对齐最终值。
 * 语义：首个变化立即（leading），窗口内合并，trailing 补最新；
 * active=false 直通/立即对齐。
 */
describe("useThrottledContent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T10:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("流式期间：首个 delta 立即生效，窗口内高频更新合并为一次 trailing", async () => {
    const source = ref("");
    const active = ref(true);
    const { content } = useThrottledContent(source, active, 120);

    source.value = "a";
    await nextTick();
    expect(content.value).toBe("a"); // leading 立即

    // 窗口内 50 次 delta → 不逐次更新
    for (let i = 0; i < 50; i++) {
      source.value = `a${"x".repeat(i)}`;
    }
    await nextTick();
    expect(content.value).toBe("a");

    // 窗口结束 trailing 一次补到最新
    vi.advanceTimersByTime(120);
    await nextTick();
    expect(content.value).toBe("a" + "x".repeat(49));
  });

  it("持续流式：每秒最多约 1000/interval 次更新，结束后 trailing 补齐", async () => {
    const source = ref("");
    const active = ref(true);
    const { content } = useThrottledContent(source, active, 120);
    const updates: string[] = [];
    const stopCount = watch(content, (v) => updates.push(v));

    // 模拟 1 秒内 200 个 delta（每 5ms 一个）
    for (let i = 0; i < 200; i++) {
      source.value = `chunk-${i}`;
      await nextTick();
      vi.advanceTimersByTime(5);
    }
    // leading(1) + trailing(每 120ms ≈ 8) —— 远小于 200
    expect(updates.length).toBeLessThanOrEqual(1 + Math.ceil(1000 / 120));

    vi.advanceTimersByTime(120);
    await nextTick();
    expect(content.value).toBe("chunk-199");
    stopCount();
  });

  it("流式结束(active→false)：立即对齐最终值，不留 trailing 延迟", async () => {
    const source = ref("p0");
    const active = ref(true);
    const { content } = useThrottledContent(source, active, 120);
    expect(content.value).toBe("p0");

    source.value = "p1"; // leading 首次变化立即
    await nextTick();
    expect(content.value).toBe("p1");

    source.value = "p1 + more"; // 窗口内 → 挂 trailing
    await nextTick();
    expect(content.value).toBe("p1");

    active.value = false;
    await nextTick();
    expect(content.value).toBe("p1 + more");
    vi.advanceTimersByTime(1000);
    await nextTick();
    expect(content.value).toBe("p1 + more");
  });

  it("非流式(历史回放 active=false)：直通不延迟", async () => {
    const source = ref("history-1");
    const active = ref(false);
    const { content } = useThrottledContent(source, active, 120);
    expect(content.value).toBe("history-1");
    source.value = "history-2";
    await nextTick();
    expect(content.value).toBe("history-2");
  });

  it("卸载清理：stop 后 pending trailing 不再写值", async () => {
    const source = ref("a");
    const active = ref(true);
    const { content, stop } = useThrottledContent(source, active, 120);
    source.value = "ab"; // leading 首次变化立即
    await nextTick();
    expect(content.value).toBe("ab");
    source.value = "abc"; // 窗口内 → 挂 trailing
    await nextTick();
    stop();
    vi.advanceTimersByTime(500);
    await nextTick();
    expect(content.value).toBe("ab");
  });
});
