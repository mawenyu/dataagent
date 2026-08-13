import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { afterEach, describe, expect, it } from "vitest";
import CopilotChat from "../components/chat/CopilotChat.vue";
import CopilotKitProvider from "../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../providers/CopilotChatConfigurationProvider.vue";
import { vueBasicCatalog } from "../components/a2ui/catalog";
import { h } from "vue";
import {
  activitySnapshotEvent,
  MockReconnectableAgent,
  runFinishedEvent,
  runStartedEvent,
  textMessageContentEvent,
  textMessageEndEvent,
  textMessageStartEvent,
} from "./utils/test-helpers";

/**
 * FORK TEST: verifies the exact ACTIVITY_SNAPSHOT envelope produced by the
 * Java gateway (A2UiService.salesOverviewOps, TASK §10) renders as a real
 * A2UI surface inside CopilotChat — real DOM, not JSON text.
 *
 * The operations below are copied verbatim from the gateway's SSE output
 * (thread a2ui-t1). If A2UiService changes its payload, update this fixture.
 */

// --- BEGIN verbatim Java fixture (POST /opencode/ag-ui, "给我看销售概览") ---
const JAVA_A2UI_OPERATIONS = [  {
    version: "v0.9",
    createSurface: {
      surfaceId: "sales-overview",
      catalogId: "https://a2ui.org/specification/v0_9/basic_catalog.json",
    },
  },
  {
    version: "v0.9",
    updateComponents: {
      surfaceId: "sales-overview",
      components: [
        { component: "Card", id: "root", child: "col" },
        { component: "Column", id: "col", children: ["title", "value"] },
        { component: "Text", id: "title", text: "销售概览", variant: "h3" },
        { component: "Text", id: "value", text: { path: "salesLine" }, variant: "h2" },
      ],
    },
  },
  {
    version: "v0.9",
    updateDataModel: {
      surfaceId: "sales-overview",
      path: "/",
      value: { salesLine: "今日销售额：123,456" },
    },
  },
];
// --- END verbatim Java fixture ---

// --- BEGIN verbatim Java fixture: dynamic render_a2ui (TASK §11-12),
// captured from thread a2ui-dyn-t2 — components chosen by the LLM ---
const JAVA_DYNAMIC_OPERATIONS = [
  {
    version: "v0.9",
    createSurface: {
      surfaceId: "sales-card",
      catalogId: "https://a2ui.org/specification/v0_9/basic_catalog.json",
    },
  },
  {
    version: "v0.9",
    updateComponents: {
      surfaceId: "sales-card",
      components: [
        { component: "Card", id: "root", child: "col" },
        { component: "Column", id: "col", children: ["t1", "t2"] },
        { component: "Text", id: "t1", variant: "title", text: "本月销售" },
        { component: "Text", id: "t2", text: "1,234,567 元" },
      ],
    },
  },
];
// --- END verbatim Java fixture ---

function mountChat(agent: MockReconnectableAgent) {
  // mirror the app's provider config exactly (vue-frontend/src/App.vue):
  // no explicit renderActivityMessages — the a2ui-surface renderer is
  // auto-registered by the provider from the catalog
  return render(
    h(CopilotKitProvider, {
      agents__unsafe_dev_only: { default: agent },
      a2ui: { catalog: vueBasicCatalog, includeSchema: true },
    } as any, {
      default: () =>
        h(CopilotChatConfigurationProvider, { agentId: "default" }, () =>
          h(CopilotChat),
        ),
    }),
  );
}

describe("Java wire contract: fixed A2UI sales-overview surface (TASK §10)", () => {
  afterEach(() => cleanup());

  it("renders the Java ACTIVITY_SNAPSHOT as a real surface, not JSON", async () => {
    const agent = new MockReconnectableAgent();
    agent.agentId = "default";
    mountChat(agent);

    await waitFor(() => {
      expect(screen.queryByTestId("copilot-chat-view")).not.toBeNull();
    });
    await new Promise((r) => setTimeout(r, 50));

    // submit a user message so the run renders inside the chat
    const input = await screen.findByRole("textbox");
    await fireEvent.update(input, "给我看销售概览");
    await fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    await waitFor(() => {
      expect(screen.getByText("给我看销售概览")).toBeDefined();
    });

    // replay the exact Java gateway event sequence
    await agent.emit(runStartedEvent());
    await agent.emit(textMessageStartEvent("msg-fixed-intro"));
    await agent.emit(
      textMessageContentEvent("msg-fixed-intro", "这是今日销售概览（Java 硬编码 Surface，经 ACTIVITY_SNAPSHOT 下发）："),
    );
    await agent.emit(textMessageEndEvent("msg-fixed-intro"));
    await agent.emit(
      activitySnapshotEvent({
        messageId: "a2ui-sales-overview",
        activityType: "a2ui-surface",
        content: { a2ui_operations: JAVA_A2UI_OPERATIONS },
      }),
    );
    await agent.emit(runFinishedEvent());

    // real surface DOM (renderer stamps data-surface-id), not JSON text
    await waitFor(
      () => {
        expect(
          document.querySelector("[data-surface-id='sales-overview']"),
        ).not.toBeNull();
      },
      { timeout: 5000 },
    );
    expect(screen.queryByText("销售概览")).not.toBeNull();
    // data-bound text resolved from the data model
    await waitFor(() => {
      expect(screen.queryByText("今日销售额：123,456")).not.toBeNull();
    });
    // and it is DOM elements, not a serialized JSON blob
    expect(document.body.textContent).not.toContain("a2ui_operations");
  });

  it("renders the dynamic render_a2ui surface (LLM-chosen components)", async () => {
    const agent = new MockReconnectableAgent();
    agent.agentId = "default";
    mountChat(agent);

    await waitFor(() => {
      expect(screen.queryByTestId("copilot-chat-view")).not.toBeNull();
    });
    await new Promise((r) => setTimeout(r, 50));

    const input = await screen.findByRole("textbox");
    await fireEvent.update(input, "分析本月销售");
    await fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    await waitFor(() => {
      expect(screen.getByText("分析本月销售")).toBeDefined();
    });

    await agent.emit(runStartedEvent());
    await agent.emit(textMessageStartEvent("msg-dyn"));
    await agent.emit(textMessageContentEvent("msg-dyn", "本月销售额 1,234,567 元，环比增长 12%，表现良好。"));
    await agent.emit(textMessageEndEvent("msg-dyn"));
    await agent.emit(
      activitySnapshotEvent({
        messageId: "a2ui-sales-card",
        activityType: "a2ui-surface",
        content: { a2ui_operations: JAVA_DYNAMIC_OPERATIONS },
      }),
    );
    await agent.emit(runFinishedEvent());

    await waitFor(
      () => {
        expect(
          document.querySelector("[data-surface-id='sales-card']"),
        ).not.toBeNull();
      },
      { timeout: 5000 },
    );
    expect(screen.queryByText("本月销售")).not.toBeNull();
    expect(screen.queryByText("1,234,567 元")).not.toBeNull();
  });

  it("applies a refresh_sales update snapshot in place (same messageId, replace=true)", async () => {
    const agent = new MockReconnectableAgent();
    agent.agentId = "default";
    mountChat(agent);

    await waitFor(() => {
      expect(screen.queryByTestId("copilot-chat-view")).not.toBeNull();
    });
    await new Promise((r) => setTimeout(r, 50));

    const input = await screen.findByRole("textbox");
    await fireEvent.update(input, "给我看销售概览");
    await fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    await waitFor(() => {
      expect(screen.getByText("给我看销售概览")).toBeDefined();
    });

    // run 1: initial fixed surface (messageId a2ui-sales-overview)
    await agent.emit(runStartedEvent());
    await agent.emit(
      activitySnapshotEvent({
        messageId: "a2ui-sales-overview",
        activityType: "a2ui-surface",
        content: { a2ui_operations: JAVA_A2UI_OPERATIONS },
      }),
    );
    await agent.emit(runFinishedEvent());
    await waitFor(() => {
      expect(screen.queryByText("今日销售额：123,456")).not.toBeNull();
    });

    // run 2: refresh_sales action response — SAME messageId, replace=true,
    // updated data model value (captured shape from A2UiActionHandler)
    const refreshOps = JSON.parse(JSON.stringify(JAVA_A2UI_OPERATIONS));
    refreshOps[2].updateDataModel.value.salesLine = "今日销售额：123,903（已刷新 01:07:27）";
    await agent.emit(runStartedEvent());
    await agent.emit(
      activitySnapshotEvent({
        messageId: "a2ui-sales-overview",
        activityType: "a2ui-surface",
        content: { a2ui_operations: refreshOps },
      }),
    );
    await agent.emit(runFinishedEvent());

    await waitFor(() => {
      expect(screen.queryByText("今日销售额：123,903（已刷新 01:07:27）")).not.toBeNull();
    });
    // updated in place: old value gone, exactly one surface in the DOM
    expect(screen.queryByText("今日销售额：123,456")).toBeNull();
    expect(document.querySelectorAll("[data-surface-id='sales-overview']").length).toBe(1);
  });
});
