import { describe, expect, it } from "vitest";
import { h } from "vue";
import { mount } from "@vue/test-utils";
import type { Message } from "@ag-ui/core";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotChatView from "../CopilotChatView.vue";

/**
 * FORK#28(2026-08-17, bug 修复): 对话内容区宽度从钉死的 cpk:max-w-3xl(48rem)
 * 放宽到 cpk:max-w-5xl(64rem) —— 宽屏下消息列表/欢迎页/输入区随对话列拉伸,
 * 可读性上限保留;窄列(分栏模式)由外层列宽约束,不受此 cap 影响。
 */

const chatMessages: Message[] = [
  { id: "user-1", role: "user", content: "Hello", timestamp: new Date() },
  { id: "assistant-1", role: "assistant", content: "Hi!", timestamp: new Date() },
];

function mountChatView(props: Record<string, unknown> = {}) {
  return mount(CopilotKitProvider, {
    props: { runtimeUrl: "/api/copilotkit" },
    slots: {
      default: () =>
        h(
          CopilotChatConfigurationProvider,
          { threadId: "thread-1", agentId: "default" },
          { default: () => h(CopilotChatView, props) },
        ),
    },
  });
}

describe("CopilotChatView 内容区宽度 (FORK#28)", () => {
  it("欢迎页内容容器: max-w-3xl → max-w-5xl", () => {
    const wrapper = mountChatView({ messages: [] });
    const inner = wrapper.get(
      "[data-testid='copilot-chat-view-welcome-screen'] > div",
    );
    expect(inner.classes()).toContain("cpk:max-w-5xl");
    expect(inner.classes()).not.toContain("cpk:max-w-3xl");
  });

  it("消息列表内容容器: max-w-3xl → max-w-5xl", () => {
    const wrapper = mountChatView({ messages: chatMessages });
    const inner = wrapper.get("[data-testid='copilot-scroll-content'] > div");
    expect(inner.classes()).toContain("cpk:max-w-5xl");
    expect(inner.classes()).not.toContain("cpk:max-w-3xl");
  });

  it("输入区附件队列容器: max-w-3xl → max-w-5xl", async () => {
    const wrapper = mountChatView({
      messages: chatMessages,
      attachments: [
        {
          id: "a1",
          type: "document",
          source: { type: "url", value: "https://example.com/data.csv", mimeType: "text/csv" },
          filename: "data.csv",
          size: 42,
          status: "ready",
        },
      ],
    });
    const overlay = wrapper.get("[data-testid='copilot-input-overlay']");
    const queue = overlay.get("div");
    expect(queue.classes()).toContain("cpk:max-w-5xl");
    expect(queue.classes()).not.toContain("cpk:max-w-3xl");
  });

  it("输入框本体容器: max-w-3xl → max-w-5xl(与消息列对齐)", () => {
    const wrapper = mountChatView({ messages: chatMessages });
    const container = wrapper.get("[data-testid='copilot-chat-input-container']");
    const inner = container.get("div");
    expect(inner.classes()).toContain("cpk:max-w-5xl");
    expect(inner.classes()).not.toContain("cpk:max-w-3xl");
  });

  it("输入区 disclaimer: max-w-3xl → max-w-5xl(与输入框对齐)", () => {
    const wrapper = mountChatView({ messages: chatMessages });
    const disclaimer = wrapper.get("[data-testid='copilot-chat-input-disclaimer']");
    expect(disclaimer.classes()).toContain("cpk:max-w-5xl");
    expect(disclaimer.classes()).not.toContain("cpk:max-w-3xl");
  });
});
