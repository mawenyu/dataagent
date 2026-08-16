import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref, watch } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import type { AssistantMessage } from "@ag-ui/core";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotChatAssistantMessage from "../CopilotChatAssistantMessage.vue";

/**
 * 收尾2：assistant 消息的 StreamMarkdown 同款限频（FORK#23）。
 * mock streamdown-vue 记录 content prop 实际收到的更新次数。
 */
const mdUpdates: string[] = [];
vi.mock("streamdown-vue", () => ({
  StreamMarkdown: defineComponent({
    name: "StreamMarkdown",
    props: { content: { type: String, default: "" } },
    setup(props) {
      watch(
        () => props.content,
        (v) => mdUpdates.push(v),
        { immediate: true },
      );
      return () => h("div", { "data-testid": "md-stub" }, props.content);
    },
  }),
}));

function createAssistantMessage(content: string): AssistantMessage {
  return { id: "asst-1", role: "assistant", content } as AssistantMessage;
}

function mountAssistant() {
  const msg = ref(createAssistantMessage("x"));
  const running = ref(true);
  const Host = defineComponent({
    components: {
      CopilotKitProvider,
      CopilotChatConfigurationProvider,
      CopilotChatAssistantMessage,
    },
    setup() {
      return { msg, running };
    },
    template: `
      <CopilotKitProvider runtime-url="/api/copilotkit">
        <CopilotChatConfigurationProvider thread-id="t-throttle">
          <CopilotChatAssistantMessage :message="msg" :messages="[msg]" :is-running="running" />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    `,
  });
  mount(Host);
  return { msg, running };
}

describe("CopilotChatAssistantMessage 流式限频（FORK#23）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T10:00:00Z"));
    mdUpdates.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("流式期间 200 个 delta → markdown 仅收到约每 120ms 一次更新;结束立即对齐", async () => {
    const { msg, running } = mountAssistant();
    await flushPromises();

    for (let i = 0; i < 200; i++) {
      msg.value = createAssistantMessage(`c${i}`);
      await nextTick();
      vi.advanceTimersByTime(5);
    }
    // 无节流 ≈200 次；节流后 ≤ 1 + ceil(1000/120) + 少许
    expect(mdUpdates.length).toBeLessThanOrEqual(12);

    running.value = false;
    await nextTick();
    expect(mdUpdates[mdUpdates.length - 1]).toBe("c199");
  });

  it("历史回放(isRunning=false)：内容直通不延迟", async () => {
    const { msg, running } = mountAssistant();
    running.value = false;
    msg.value = createAssistantMessage("done-content");
    await flushPromises();
    expect(mdUpdates[mdUpdates.length - 1]).toBe("done-content");
  });
});
