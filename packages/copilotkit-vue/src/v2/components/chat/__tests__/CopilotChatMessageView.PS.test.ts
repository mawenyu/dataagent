import { defineComponent } from "vue";
import { fireEvent, render, screen } from "@testing-library/vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantMessage, Message, UserMessage } from "@ag-ui/core";
import { HttpAgent } from "@ag-ui/client";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotChatMessageView from "../CopilotChatMessageView.vue";

/**
 * P-S: 消息级操作 —— hover 复制(既有默认 UI,此处钉住)、重新生成
 * (仅最后一条 assistant 消息,截掉该回答后重发 run)、消息时间戳
 * (history 用 gateway createdAt,live 用首次见到的时间)。
 */

function renderView({
  messages,
  agent,
  isRunning = false,
}: {
  messages: Message[];
  agent: HttpAgent;
  isRunning?: boolean;
}) {
  const Host = defineComponent({
    components: {
      CopilotKitProvider,
      CopilotChatConfigurationProvider,
      CopilotChatMessageView,
    },
    setup() {
      return { messages, agent, isRunning };
    },
    template: `
      <CopilotKitProvider :direct-agents="{ default: agent }">
        <CopilotChatConfigurationProvider agent-id="default" thread-id="t-ps">
          <CopilotChatMessageView :messages="messages" :is-running="isRunning" />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    `,
  });
  return render(Host);
}

const userMsg = (id: string, content: string, createdAt?: string) =>
  ({ id, role: "user", content, ...(createdAt ? { createdAt } : {}) }) as unknown as UserMessage;
const assistantMsg = (id: string, content: string, createdAt?: string) =>
  ({ id, role: "assistant", content, ...(createdAt ? { createdAt } : {}) }) as unknown as AssistantMessage;

describe("P-S: message-level actions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("复制按钮(hover 显示,默认 UI)点击把消息内容写入剪贴板", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const agent = new HttpAgent({ url: "/unused-ps" });
    renderView({ messages: [assistantMsg("a1", "这是回答")], agent });

    const btn = screen.getByTestId("copilot-copy-button");
    await fireEvent.click(btn);
    expect(writeText).toHaveBeenCalledWith("这是回答");
  });

  it("重新生成按钮只在最后一条 assistant 消息上出现", () => {
    const agent = new HttpAgent({ url: "/unused-ps" });
    renderView({
      messages: [userMsg("u1", "问"), assistantMsg("a1", "答1"), assistantMsg("a2", "答2")],
      agent,
    });
    const btns = screen.queryAllByTestId("copilot-regenerate-button");
    expect(btns).toHaveLength(1);
    const hostMsg = btns[0].closest("[data-message-id]");
    expect(hostMsg?.getAttribute("data-message-id")).toBe("a2");
  });

  it("点重新生成: 截掉该回答(保留之前的消息)并重发 run", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({}),
      body: null,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const agent = new HttpAgent({ url: "/unused-ps" });
    const u1 = userMsg("u1", "问");
    const a1 = assistantMsg("a1", "答1");
    const a2 = assistantMsg("a2", "答2");
    agent.setMessages([u1, a1, a2]);
    renderView({ messages: [u1, a1, a2], agent });

    await fireEvent.click(screen.getByTestId("copilot-regenerate-button"));
    await new Promise((r) => setTimeout(r, 20));

    expect(
      agent.messages.map((m) => m.id),
      "最后一条回答被截掉",
    ).toEqual(["u1", "a1"]);
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("/unused-ps")),
      "应重新发起 run",
    ).toBe(true);
  });

  it("运行中不出重新生成按钮", () => {
    const agent = new HttpAgent({ url: "/unused-ps" });
    renderView({
      messages: [userMsg("u1", "问"), assistantMsg("a1", "答")],
      agent,
      isRunning: true,
    });
    expect(screen.queryByTestId("copilot-regenerate-button")).toBeNull();
  });

  it("消息时间戳: history 用 createdAt,live 用首见时间(HH:mm)", () => {
    const agent = new HttpAgent({ url: "/unused-ps" });
    renderView({
      messages: [
        userMsg("u1", "历史问题", "2026-08-16T10:20:30Z"),
        assistantMsg("a1", "实时回答"),
      ],
      agent,
    });
    const times = screen.getAllByTestId("copilot-message-time");
    expect(times).toHaveLength(2);
    for (const t of times) {
      expect(t.textContent).toMatch(/\d{2}:\d{2}/);
    }
  });
});
