import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, watch } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import type { Message, ReasoningMessage } from "@ag-ui/core";
import CopilotChatReasoningMessage from "../CopilotChatReasoningMessage.vue";

/**
 * 收尾2：reasoning 消息的 StreamMarkdown 不再跟随每个 SSE delta ——
 * 流式期间限频（FORK#23 useThrottledContent），结束立即对齐。
 * mock streamdown-vue 记录 content prop 实际收到的更新次数。
 */
const mdUpdates: string[] = [];
const mdComponents: unknown[] = [];
vi.mock("streamdown-vue", () => ({
  StreamMarkdown: defineComponent({
    name: "StreamMarkdown",
    props: {
      content: { type: String, default: "" },
      components: { type: Object, default: undefined },
    },
    setup(props) {
      watch(
        () => props.content,
        (v) => mdUpdates.push(v),
        { immediate: true },
      );
      watch(
        () => props.components,
        (v) => mdComponents.push(v),
        { immediate: true },
      );
      return () => h("div", { "data-testid": "md-stub" }, props.content);
    },
  }),
}));

describe("CopilotChatReasoningMessage 流式限频（FORK#23）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T10:00:00Z"));
    mdUpdates.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function createReasoningMessage(content: string): ReasoningMessage {
    return { id: "reasoning-1", role: "reasoning", content } as ReasoningMessage;
  }

  it("流式期间 200 个 delta → markdown 仅收到约每 120ms 一次更新;结束立即对齐", async () => {
    const message = createReasoningMessage("");
    const wrapper = mount(CopilotChatReasoningMessage, {
      props: { message, messages: [message] as Message[], isRunning: true },
    });
    await nextTick();
    await nextTick(); // async component 解析

    for (let i = 0; i < 200; i++) {
      await wrapper.setProps({ message: createReasoningMessage(`c${i}`) });
      vi.advanceTimersByTime(5);
    }
    // 无节流时这里 = 200；节流后 ≤ 1 + ceil(1000/120) + 少许
    expect(mdUpdates.length).toBeLessThanOrEqual(12);

    // 流式结束 → 立即对齐最终值（不等 trailing）
    await wrapper.setProps({ isRunning: false });
    await nextTick();
    expect(mdUpdates[mdUpdates.length - 1]).toBe("c199");
  });

  it("历史回放(isRunning=false)：内容直通不延迟", async () => {
    const message = createReasoningMessage("done-content");
    mount(CopilotChatReasoningMessage, {
      props: { message, messages: [message] as Message[], isRunning: false },
    });
    await flushPromises(); // async StreamMarkdown 解析
    expect(mdUpdates[mdUpdates.length - 1]).toBe("done-content");
  });

  it("FORK#25：流式期间喂 codeblock 降级渲染器，结束后回到默认 shiki", async () => {
    const { PlainCodeBlock } = await import("../plain-code-block");
    mdComponents.length = 0;
    const message = createReasoningMessage("```js\nconst a=1;\n```");
    const wrapper = mount(CopilotChatReasoningMessage, {
      props: { message, messages: [message] as Message[], isRunning: true },
    });
    await flushPromises();
    const streamingMap = mdComponents[mdComponents.length - 1] as
      | Record<string, unknown>
      | undefined;
    expect(streamingMap?.codeblock).toBe(PlainCodeBlock); // 流式：降级无 shiki

    await wrapper.setProps({ isRunning: false });
    await nextTick();
    // FORK#27：翻 false 不立即升格（idle 延迟真渲染）
    const flipMap = mdComponents[mdComponents.length - 1] as
      | Record<string, unknown>
      | undefined;
    expect(flipMap?.codeblock).toBe(PlainCodeBlock);

    vi.advanceTimersByTime(100); // jsdom 无 rIC → setTimeout(50) 降级路径
    await nextTick();
    const doneMap = mdComponents[mdComponents.length - 1] as
      | Record<string, unknown>
      | undefined;
    expect(doneMap?.codeblock).toBeUndefined(); // idle 后：回默认高亮渲染
  });

  it("FORK#25 补充：流式期 mermaid 围栏降级 text，结束用原始内容", async () => {
    const message = createReasoningMessage("```mermaid\ngraph TD; A-->B\n```");
    const wrapper = mount(CopilotChatReasoningMessage, {
      props: { message, messages: [message] as Message[], isRunning: true },
    });
    await flushPromises();
    expect(mdUpdates[mdUpdates.length - 1]).toContain("```text");
    expect(mdUpdates[mdUpdates.length - 1]).not.toContain("```mermaid");

    await wrapper.setProps({ isRunning: false });
    await nextTick();
    // FORK#27：翻 false 同一 tick 仍降级（升格挂 idle）
    expect(mdUpdates[mdUpdates.length - 1]).not.toContain("```mermaid");

    vi.advanceTimersByTime(100);
    await nextTick();
    expect(mdUpdates[mdUpdates.length - 1]).toContain("```mermaid"); // idle 后真渲染
  });
});
