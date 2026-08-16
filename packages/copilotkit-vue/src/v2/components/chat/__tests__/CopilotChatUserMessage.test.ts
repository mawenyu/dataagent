import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import type { UserMessage } from "@ag-ui/core";
import { CopilotChatDefaultLabels } from "../../../providers/types";
import CopilotChatUserMessage from "../CopilotChatUserMessage.vue";

describe("CopilotChatUserMessage", () => {
  let originalClipboard: Clipboard | undefined;
  const mockWriteText = vi.fn();

  beforeEach(() => {
    originalClipboard = navigator.clipboard;
    mockWriteText.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: mockWriteText.mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      writable: true,
      configurable: true,
    });
  });

  it("renders flattened text content from structured message parts", () => {
    const message = {
      id: "user-1",
      role: "user",
      timestamp: new Date(),
      content: [
        { type: "text", text: "Line one" },
        { type: "tool-call", id: "ignore" },
        { type: "text", text: "Line two" },
      ],
    } as unknown as UserMessage;

    const wrapper = mount(CopilotChatUserMessage, {
      props: {
        message,
      },
    });

    expect(wrapper.text()).toContain("Line one");
    expect(wrapper.text()).toContain("Line two");
    expect(wrapper.text()).not.toContain("ignore");
  });

  it("emits edit-message exactly once when edit button is clicked", async () => {
    const onEditMessage = vi.fn();
    const message: UserMessage = {
      id: "user-2",
      role: "user",
      timestamp: new Date(),
      content: "Can you edit this?",
    };

    const wrapper = mount(CopilotChatUserMessage, {
      props: {
        message,
        onEditMessage,
      },
    });

    const editButton = wrapper.find(
      `[aria-label="${CopilotChatDefaultLabels.userMessageToolbarEditMessageLabel}"]`,
    );
    expect(editButton.exists()).toBe(true);

    await editButton.trigger("click");

    expect(onEditMessage).toHaveBeenCalledTimes(1);
    expect(onEditMessage).toHaveBeenCalledWith({ message });
    expect(wrapper.emitted("edit-message")?.[0]).toEqual([{ message }]);
  });

  it("hides edit button when edit callback is not provided", () => {
    const message: UserMessage = {
      id: "user-3",
      role: "user",
      timestamp: new Date(),
      content: "No edit action",
    };

    const wrapper = mount(CopilotChatUserMessage, {
      props: {
        message,
      },
    });

    expect(
      wrapper
        .find(
          `[aria-label="${CopilotChatDefaultLabels.userMessageToolbarEditMessageLabel}"]`,
        )
        .exists(),
    ).toBe(false);
  });

  it("renders branch navigation and emits switch payload exactly once", async () => {
    const onSwitchToBranch = vi.fn();
    const message: UserMessage = {
      id: "user-4",
      role: "user",
      timestamp: new Date(),
      content: "Branch message",
    };

    const wrapper = mount(CopilotChatUserMessage, {
      props: {
        message,
        branchIndex: 1,
        numberOfBranches: 3,
        onSwitchToBranch,
      },
    });

    expect(wrapper.text()).toContain("2/3");

    const nextButton = wrapper.find('[aria-label="Next branch"]');
    await nextButton.trigger("click");

    expect(onSwitchToBranch).toHaveBeenCalledTimes(1);
    expect(onSwitchToBranch).toHaveBeenCalledWith({
      branchIndex: 2,
      numberOfBranches: 3,
      message,
    });
    expect(wrapper.emitted("switch-to-branch")?.[0]).toEqual([
      {
        branchIndex: 2,
        numberOfBranches: 3,
        message,
      },
    ]);
  });

  it("disables unavailable branch navigation controls", () => {
    const message: UserMessage = {
      id: "user-5",
      role: "user",
      timestamp: new Date(),
      content: "First branch",
    };

    const wrapper = mount(CopilotChatUserMessage, {
      props: {
        message,
        branchIndex: 0,
        numberOfBranches: 2,
        onSwitchToBranch: vi.fn(),
      },
    });

    expect(
      wrapper.find('[aria-label="Previous branch"]').attributes("disabled"),
    ).toBeDefined();
    expect(
      wrapper.find('[aria-label="Next branch"]').attributes("disabled"),
    ).toBeUndefined();
  });

  it("supports custom message-renderer slot", () => {
    const message: UserMessage = {
      id: "user-6",
      role: "user",
      timestamp: new Date(),
      content: "Custom slot message",
    };

    const wrapper = mount(CopilotChatUserMessage, {
      props: { message },
      slots: {
        "message-renderer": ({ content }: { content: string }) =>
          h(
            "div",
            { "data-testid": "custom-message-renderer" },
            `slot:${content}`,
          ),
      },
    });

    expect(wrapper.find("[data-testid='custom-message-renderer']").text()).toBe(
      "slot:Custom slot message",
    );
  });

  it("supports custom copy/edit/branch slots and forwards handlers", async () => {
    const onEditMessage = vi.fn();
    const onSwitchToBranch = vi.fn();
    const message: UserMessage = {
      id: "user-7",
      role: "user",
      timestamp: new Date(),
      content: "Custom controls",
    };

    const wrapper = mount(CopilotChatUserMessage, {
      props: {
        message,
        onEditMessage,
        onSwitchToBranch,
        branchIndex: 1,
        numberOfBranches: 3,
      },
      slots: {
        "copy-button": ({
          onCopy,
          copied,
        }: {
          onCopy: () => Promise<void>;
          copied: boolean;
        }) =>
          h(
            "button",
            { "data-testid": "custom-copy-button", onClick: onCopy },
            copied ? "copied" : "copy",
          ),
        "edit-button": ({ onEdit }: { onEdit: () => void }) =>
          h(
            "button",
            { "data-testid": "custom-edit-button", onClick: onEdit },
            "edit",
          ),
        "branch-navigation": ({ goNext }: { goNext: () => void }) =>
          h(
            "button",
            { "data-testid": "custom-branch-next", onClick: goNext },
            "next",
          ),
      },
    });

    await wrapper.get("[data-testid='custom-copy-button']").trigger("click");
    await nextTick();
    expect(wrapper.get("[data-testid='custom-copy-button']").text()).toBe(
      "copied",
    );

    await wrapper.get("[data-testid='custom-edit-button']").trigger("click");
    expect(onEditMessage).toHaveBeenCalledTimes(1);
    expect(onEditMessage).toHaveBeenCalledWith({ message });

    await wrapper.get("[data-testid='custom-branch-next']").trigger("click");
    expect(onSwitchToBranch).toHaveBeenCalledTimes(1);
    expect(onSwitchToBranch).toHaveBeenCalledWith({
      branchIndex: 2,
      numberOfBranches: 3,
      message,
    });
  });

  it("supports custom layout slot with all control callbacks", async () => {
    const onEditMessage = vi.fn();
    const onSwitchToBranch = vi.fn();
    const message: UserMessage = {
      id: "user-8",
      role: "user",
      timestamp: new Date(),
      content: "Layout slot content",
    };

    const wrapper = mount(CopilotChatUserMessage, {
      props: {
        message,
        onEditMessage,
        onSwitchToBranch,
        branchIndex: 0,
        numberOfBranches: 2,
      },
      slots: {
        layout: ({
          content,
          onCopy,
          onEdit,
          goNext,
          hasEditAction,
          showBranchNavigation,
        }: {
          content: string;
          onCopy: () => Promise<void>;
          onEdit: () => void;
          goNext: () => void;
          hasEditAction: boolean;
          showBranchNavigation: boolean;
        }) =>
          h("div", { "data-testid": "custom-layout" }, [
            h("div", { "data-testid": "layout-content" }, content),
            h(
              "div",
              { "data-testid": "layout-flags" },
              `${hasEditAction}:${showBranchNavigation}`,
            ),
            h(
              "button",
              { "data-testid": "layout-copy", onClick: onCopy },
              "copy",
            ),
            h(
              "button",
              { "data-testid": "layout-edit", onClick: onEdit },
              "edit",
            ),
            h(
              "button",
              { "data-testid": "layout-next", onClick: goNext },
              "next",
            ),
          ]),
      },
    });

    expect(wrapper.get("[data-testid='layout-content']").text()).toBe(
      "Layout slot content",
    );
    expect(wrapper.get("[data-testid='layout-flags']").text()).toBe(
      "true:true",
    );

    await wrapper.get("[data-testid='layout-copy']").trigger("click");
    await wrapper.get("[data-testid='layout-edit']").trigger("click");
    await wrapper.get("[data-testid='layout-next']").trigger("click");

    expect(onEditMessage).toHaveBeenCalledTimes(1);
    expect(onEditMessage).toHaveBeenCalledWith({ message });
    expect(onSwitchToBranch).toHaveBeenCalledTimes(1);
    expect(onSwitchToBranch).toHaveBeenCalledWith({
      branchIndex: 1,
      numberOfBranches: 2,
      message,
    });
  });
});

describe("FORK#26 用户消息附件区渲染", () => {
  it("多模态消息: 文本进气泡,图片/文档 parts 渲染为附件区(AttachmentRenderer)", () => {
    const message = {
      id: "user-att-1",
      role: "user",
      content: [
        { type: "text", text: "分析这几个文件" },
        {
          type: "image",
          source: { type: "url", value: "/agui-api/chat/threads/t1/files/chart.png", mimeType: "image/png" },
          metadata: { filename: "chart.png" },
        },
        {
          type: "document",
          source: { type: "url", value: "/agui-api/chat/threads/t1/files/sales.csv", mimeType: "text/csv" },
          metadata: { filename: "sales.csv" },
        },
      ],
    } as unknown as UserMessage;
    const wrapper = mount(CopilotChatUserMessage, { props: { message } });

    const zone = wrapper.find("[data-testid='copilot-user-message-attachments']");
    expect(zone.exists(), "应有附件区容器").toBe(true);
    const img = zone.find("[data-testid='copilot-chat-attachment-renderer-image']");
    expect(img.exists()).toBe(true);
    expect(img.attributes("src")).toContain("/files/chart.png");
    const doc = zone.find("[data-testid='copilot-chat-attachment-renderer-document']");
    expect(doc.exists()).toBe(true);
    expect(doc.text()).toContain("sales.csv");
    // 文本仍在气泡里
    expect(wrapper.find("[data-testid='copilot-user-message']").text()).toContain("分析这几个文件");
  });

  it("历史消息无 source 的 document part 也渲染 chip(点击预览由 App 委托按文件名解析)", () => {
    const message = {
      id: "user-att-2",
      role: "user",
      content: [
        { type: "text", text: "看这个" },
        { type: "document", metadata: { filename: "report.pdf" } },
      ],
    } as unknown as UserMessage;
    const wrapper = mount(CopilotChatUserMessage, { props: { message } });
    const doc = wrapper.find("[data-testid='copilot-chat-attachment-renderer-document']");
    expect(doc.exists(), "无 source 的 document part 也要渲染 chip").toBe(true);
    expect(doc.text()).toContain("report.pdf");
  });

  it("无 source 的 image part 跳过(无法渲染,不出 broken img)", () => {
    const message = {
      id: "user-att-3",
      role: "user",
      content: [
        { type: "text", text: "看图" },
        { type: "image", metadata: { filename: "lost.png" } },
      ],
    } as unknown as UserMessage;
    const wrapper = mount(CopilotChatUserMessage, { props: { message } });
    expect(wrapper.find("[data-testid='copilot-chat-attachment-renderer-image']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='copilot-user-message-attachments']").exists()).toBe(false);
  });

  it("纯文本消息不渲染附件区(回归)", () => {
    const message: UserMessage = { id: "user-att-4", role: "user", content: "hello" } as UserMessage;
    const wrapper = mount(CopilotChatUserMessage, { props: { message } });
    expect(wrapper.find("[data-testid='copilot-user-message-attachments']").exists()).toBe(false);
  });
});
