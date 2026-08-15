import { fireEvent, render, screen } from "@testing-library/vue";
import {
  computed,
  defineComponent,
  h,
  nextTick,
  provide,
  ref,
  shallowRef,
} from "vue";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useDefaultRenderTool } from "../use-default-render-tool";
import { useRenderTool } from "../use-render-tool";
import {
  CopilotChatConfigurationKey,
  CopilotKitKey,
} from "../../providers/keys";

vi.mock("../use-render-tool", () => ({
  useRenderTool: vi.fn(),
}));

const mockUseRenderTool = useRenderTool as ReturnType<typeof vi.fn>;

describe("useDefaultRenderTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

    function getDefaultRenderer(): (props: Record<string, unknown>) => unknown {
      const Harness = defineComponent({
        setup() {
          useDefaultRenderTool();
          return {};
        },
        template: `<div />`,
      });
      render(Harness);
      const [config] = mockUseRenderTool.mock.calls[0] as [
        { render: (props: Record<string, unknown>) => unknown },
      ];
      return config.render;
    }

    function renderWithRunContext(
      renderer: (props: Record<string, unknown>) => unknown,
      props: Record<string, unknown>,
      fakeAgent: {
        isRunning: boolean;
        subscribe: ReturnType<typeof vi.fn>;
      },
    ) {
      const fakeCore = { getAgent: vi.fn(() => fakeAgent) };
      const Harness = defineComponent({
        setup() {
          provide(CopilotKitKey, {
            copilotkit: shallowRef(fakeCore),
            executingToolCallIds: ref(new Set<string>()),
            a2uiTheme: computed(() => undefined),
            a2uiCatalog: computed(() => undefined),
            a2uiLoadingComponent: computed(() => undefined),
            a2uiIncludeSchema: computed(() => false),
          } as never);
          provide(
            CopilotChatConfigurationKey,
            computed(
              () =>
                ({ agentId: "default", threadId: "t-f3" }) as never,
            ),
          );
          return () => h(renderer as never, props);
        },
      });
      render(Harness);
    }

    function makeFakeAgent(isRunning = true) {
      let subscriber: Record<string, ((evt?: unknown) => void) | undefined>;
      const agent = {
        isRunning,
        subscribe: vi.fn((sub: Record<string, (evt?: unknown) => void>) => {
          subscriber = sub;
          return { unsubscribe: vi.fn() };
        }),
      };
      return {
        agent,
        fire(event: "onRunStartedEvent" | "onRunFinishedEvent" | "onRunErrorEvent") {
          return subscriber[event]?.({});
        },
      };
    }


  it("registers a wildcard renderer when called without config", () => {
    const Harness = defineComponent({
      setup() {
        useDefaultRenderTool();
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    expect(mockUseRenderTool).toHaveBeenCalledTimes(1);
    const [config] = mockUseRenderTool.mock.calls[0] as [
      {
        name: string;
        render: (props: {
          name: string;
          toolCallId: string;
          parameters: unknown;
          status: string;
          result: string | undefined;
        }) => unknown;
      },
    ];

    expect(config.name).toBe("*");
    expect(typeof config.render).toBe("function");
  });

  it("forwards custom render function and deps", () => {
    const customRender = vi.fn(() => "custom");
    const deps = [() => "compact"];

    const Harness = defineComponent({
      setup() {
        useDefaultRenderTool(
          {
            render: customRender,
          },
          deps,
        );
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    expect(mockUseRenderTool).toHaveBeenCalledTimes(1);
    const [config, forwardedDeps] = mockUseRenderTool.mock.calls[0] as [
      {
        name: string;
        render: (props: {
          name: string;
          toolCallId: string;
          args: unknown;
          status: string;
          result: string | undefined;
        }) => unknown;
      },
      unknown[],
    ];

    expect(config.name).toBe("*");
    // The registered render is a wrapper that adapts RawRendererProps →
    // DefaultRenderProps before invoking the user's render, so the user
    // function is not the registered render by reference. Verify the
    // wrapper forwards correctly instead.
    expect(typeof config.render).toBe("function");
    config.render({
      name: "x",
      toolCallId: "tc-1",
      args: { a: 1 },
      status: "complete",
      result: "ok",
    });
    expect(customRender).toHaveBeenCalledTimes(1);
    expect(forwardedDeps).toBe(deps);
  });

  it("forwards toolCallId to custom wildcard render function", () => {
    const customRender = vi.fn(() => "custom");

    const Harness = defineComponent({
      setup() {
        useDefaultRenderTool({ render: customRender });
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    const [config] = mockUseRenderTool.mock.calls[0] as [
      {
        name: string;
        render: (props: {
          name: string;
          toolCallId: string;
          parameters: unknown;
          status: "inProgress" | "executing" | "complete";
          result: string | undefined;
        }) => unknown;
      },
    ];

    config.render({
      name: "searchDocs",
      toolCallId: "tc-forwarded-1",
      parameters: { query: "copilot" },
      status: "executing",
      result: undefined,
    });

    expect(customRender).toHaveBeenCalledTimes(1);
    expect(customRender.mock.calls[0]?.[0]).toMatchObject({
      toolCallId: "tc-forwarded-1",
    });
  });

  // F14: component-typed render must receive adapted DefaultRenderProps
  // (parameters + string-union status), not the raw call-site shape (args).
  // The registered render is a WRAPPER that runs adaptRendererProps and
  // forwards to the user's component — not the component itself by reference.
  it("forwards custom render component with adapted DefaultRenderProps", async () => {
    const receivedProps = vi.fn();
    const customRender = defineComponent({
      props: {
        name: { type: String, required: true },
        toolCallId: { type: String, required: true },
        parameters: { type: null, required: false, default: undefined },
        status: { type: String, required: true },
        result: { type: null, required: false, default: undefined },
      },
      setup(props) {
        receivedProps({ ...props });
        return () => null;
      },
    });

    const Harness = defineComponent({
      setup() {
        useDefaultRenderTool({
          render: customRender,
        });
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    const [config] = mockUseRenderTool.mock.calls[0] as [
      {
        name: string;
        render: (props: unknown) => unknown;
      },
    ];

    expect(config.name).toBe("*");
    // Wrapper, not reference equality.
    expect(typeof config.render).toBe("function");

    // Render the wrapper with the RAW call-site shape (args + enum-string status).
    const Wrapper = defineComponent({
      setup() {
        return () =>
          (config.render as (p: unknown) => unknown)({
            name: "searchDocs",
            toolCallId: "tc-component-adapt",
            args: { query: "copilot" },
            status: "complete",
            result: "ok",
          });
      },
    });

    render(Wrapper);

    expect(receivedProps).toHaveBeenCalled();
    const adapted = receivedProps.mock.calls[0][0] as Record<string, unknown>;
    expect(adapted.parameters).toEqual({ query: "copilot" });
    expect(adapted.status).toBe("complete");
    expect(adapted.toolCallId).toBe("tc-component-adapt");
    expect(adapted.result).toBe("ok");
    expect(adapted.name).toBe("searchDocs");
  });

  // F11: result prop is typeless (type: null) so a non-string result is rendered
  // safely via safeStringifyForPre and serialized into data-result without
  // Vue dev-mode type warnings (no "Invalid prop: type check failed for prop
  // 'result'" noise).
  it("default renderer handles non-string result via safe stringify with no Vue type warning", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const Harness = defineComponent({
      setup() {
        useDefaultRenderTool();
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    const [config] = mockUseRenderTool.mock.calls[0] as [{ render: unknown }];
    const DefaultRenderer = config.render;
    const structuredResult = { ok: true, count: 3 };

    render(DefaultRenderer as any, {
      props: {
        name: "searchDocs",
        toolCallId: "tc-nonstring-result",
        parameters: { query: "copilot" },
        status: "complete",
        result: structuredResult,
      },
    });

    const wrapper = screen.getByTestId("copilot-tool-render");
    expect(wrapper.getAttribute("data-result")).toBe(
      JSON.stringify(structuredResult),
    );

    await fireEvent.click(screen.getByText("searchDocs"));
    expect(screen.getByText("Result")).toBeDefined();
    // The stringified payload appears in the <pre>.
    expect(screen.getByText(/"count": 3/)).toBeDefined();

    // The "result" prop must be typeless so non-string values do not trip
    // Vue's runtime type validator (dev-mode warn).
    const offending = warnSpy.mock.calls.filter((call) =>
      String(call[0] ?? "").includes(
        'Invalid prop: type check failed for prop "result"',
      ),
    );
    expect(offending.length).toBe(0);
    warnSpy.mockRestore();
  });

  // F9: warn-on-unknown-status is deduplicated per distinct value.
  it("warns at most once for the same unknown status across renders", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const customRender = vi.fn(() => "custom");

    const Harness = defineComponent({
      setup() {
        useDefaultRenderTool({ render: customRender });
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    const [config] = mockUseRenderTool.mock.calls[0] as [
      { render: (props: unknown) => unknown },
    ];

    const unknownStatus = "vue-unknown-status-xyz";

    // Invoke 3 times with the same unknown status; should warn ONCE total
    // for this value.
    for (let i = 0; i < 3; i++) {
      config.render({
        name: "searchDocs",
        toolCallId: `tc-unknown-${i}`,
        args: {},
        status: unknownStatus,
        result: undefined,
      });
    }

    const matching = warnSpy.mock.calls.filter((call) =>
      String(call[0] ?? "").includes(unknownStatus),
    );
    expect(matching.length).toBe(1);
    warnSpy.mockRestore();
  });

  it("default renderer shows status and expands to show parameters/result", async () => {
    const Harness = defineComponent({
      setup() {
        useDefaultRenderTool();
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    const [config] = mockUseRenderTool.mock.calls[0] as [
      {
        render: unknown;
      },
    ];

    const DefaultRenderer = config.render;
    render(DefaultRenderer as any, {
      props: {
        name: "searchDocs",
        toolCallId: "tc-default-executing",
        parameters: { query: "copilot" },
        status: "executing",
        result: undefined,
      },
    });

    expect(screen.getByText("searchDocs")).toBeDefined();
    expect(screen.getByText("Running")).toBeDefined();

    await fireEvent.click(screen.getByText("searchDocs"));
    expect(screen.getByText("Arguments")).toBeDefined();
    expect(screen.getByText(/copilot/)).toBeDefined();
  });

  it("default renderer shows done status and result payload", async () => {
    const Harness = defineComponent({
      setup() {
        useDefaultRenderTool();
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    const [config] = mockUseRenderTool.mock.calls[0] as [
      {
        render: unknown;
      },
    ];

    const DefaultRenderer = config.render;
    render(DefaultRenderer as any, {
      props: {
        name: "searchDocs",
        toolCallId: "tc-default-complete",
        parameters: { query: "copilot" },
        status: "complete",
        result: "done",
      },
    });

    expect(screen.getByText("Done")).toBeDefined();
    await fireEvent.click(screen.getByText("searchDocs"));
    expect(screen.getByText("Result")).toBeDefined();
    expect(screen.getByText("done")).toBeDefined();
  });

  it("default renderer emits stable copilot-tool-render testid and metadata attrs", () => {
    const Harness = defineComponent({
      setup() {
        useDefaultRenderTool();
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    const [config] = mockUseRenderTool.mock.calls[0] as [
      {
        render: unknown;
      },
    ];

    const DefaultRenderer = config.render;
    render(DefaultRenderer as any, {
      props: {
        name: "searchDocs",
        toolCallId: "tc-testid-1",
        parameters: { query: "copilot" },
        status: "complete",
        result: "ok",
      },
    });

    const wrapper = screen.getByTestId("copilot-tool-render");
    expect(wrapper).toBeDefined();
    expect(wrapper.getAttribute("data-tool-name")).toBe("searchDocs");
    expect(wrapper.getAttribute("data-status")).toBe("complete");
    expect(wrapper.getAttribute("data-args")).toBe(
      JSON.stringify({ query: "copilot" }),
    );
    expect(wrapper.getAttribute("data-result")).toBe("ok");
    expect(screen.getByTestId("copilot-tool-render-name").textContent).toBe(
      "searchDocs",
    );
    expect(screen.getByTestId("copilot-tool-render-status").textContent).toBe(
      "Done",
    );
  });

  // Fix #1: a11y — vue version already uses <button>; assert aria-expanded toggles.
  it("default renderer header is a button with aria-expanded that toggles", async () => {
    const Harness = defineComponent({
      setup() {
        useDefaultRenderTool();
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    const [config] = mockUseRenderTool.mock.calls[0] as [
      {
        render: unknown;
      },
    ];

    const DefaultRenderer = config.render;
    render(DefaultRenderer as any, {
      props: {
        name: "searchDocs",
        toolCallId: "tc-a11y",
        parameters: { query: "copilot" },
        status: "executing",
        result: undefined,
      },
    });

    const nameNode = screen.getByTestId("copilot-tool-render-name");
    const headerButton = nameNode.closest("button");
    expect(headerButton).not.toBeNull();
    expect(headerButton!.getAttribute("type")).toBe("button");
    expect(headerButton!.getAttribute("aria-expanded")).toBe("false");

    await fireEvent.click(headerButton!);
    expect(headerButton!.getAttribute("aria-expanded")).toBe("true");
  });

  // Fix #3: data-tool-call-id is emitted on the vue wrapper too.
  it("default renderer emits data-tool-call-id on the wrapper element", () => {
    const Harness = defineComponent({
      setup() {
        useDefaultRenderTool();
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    const [config] = mockUseRenderTool.mock.calls[0] as [
      {
        render: unknown;
      },
    ];

    const DefaultRenderer = config.render;
    render(DefaultRenderer as any, {
      props: {
        name: "searchDocs",
        toolCallId: "tc-id-emit",
        parameters: { query: "copilot" },
        status: "complete",
        result: "ok",
      },
    });

    const wrapper = screen.getByTestId("copilot-tool-render");
    expect(wrapper.getAttribute("data-tool-call-id")).toBe("tc-id-emit");
  });

  // Fix #4: opt-in config.render receives adapted DefaultRenderProps shape
  // (parameters, string-union status) — not the raw renderer signature.
  it("opt-in config.render receives parameters (not args) and string-union status", () => {
    const customRender = vi.fn(() => "custom");

    const Harness = defineComponent({
      setup() {
        useDefaultRenderTool({ render: customRender });
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    const [config] = mockUseRenderTool.mock.calls[0] as [
      {
        name: string;
        render: (props: {
          name: string;
          toolCallId: string;
          args: unknown;
          status: string;
          result: string | undefined;
        }) => unknown;
      },
    ];

    // Simulate what CopilotChatToolCallsView actually passes:
    // { name, toolCallId, args, status: ToolCallStatus, result }
    config.render({
      name: "searchDocs",
      toolCallId: "tc-adapt-1",
      args: { query: "copilot" },
      status: "complete",
      result: "ok",
    });

    expect(customRender).toHaveBeenCalledTimes(1);
    const forwarded = customRender.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(forwarded.parameters).toEqual({ query: "copilot" });
    expect(forwarded.status).toBe("complete");
    expect(forwarded.toolCallId).toBe("tc-adapt-1");
    expect(forwarded.result).toBe("ok");
  });

  // Fix #5: circular-ref parameters must not crash the vue render; log.
  it("default renderer survives circular-ref parameters and logs", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const Harness = defineComponent({
      setup() {
        useDefaultRenderTool();
        return {};
      },
      template: `<div />`,
    });

    render(Harness);

    const [config] = mockUseRenderTool.mock.calls[0] as [
      {
        render: unknown;
      },
    ];

    const DefaultRenderer = config.render;

    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;

    expect(() =>
      render(DefaultRenderer as any, {
        props: {
          name: "circ",
          toolCallId: "tc-circular",
          parameters: circular,
          status: "executing",
          result: undefined,
        },
      }),
    ).not.toThrow();

    const headerButton = screen
      .getByTestId("copilot-tool-render-name")
      .closest("button");
    if (headerButton) {
      await expect(fireEvent.click(headerButton)).resolves.not.toThrow();
    }

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // F3: tool-call observability — live duration, status icons (spinner/✓/✗),
  // and failure/interrupt marking driven by agent run-lifecycle events.
  describe("F3 duration / status icon / failure state", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("shows a spinner and live elapsed time while running, then freezes the duration on complete", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
      const DefaultRenderer = getDefaultRenderer();

      const rendered = render(DefaultRenderer as never, {
        props: {
          name: "bash",
          toolCallId: "tc-dur-1",
          parameters: {},
          status: "executing",
          result: undefined,
        },
      });

      // spinner visible while active, no ✓/✗ glyph
      expect(
        screen.getByTestId("copilot-tool-render-spinner"),
      ).toBeDefined();
      expect(screen.getByTestId("copilot-tool-render-status").textContent).toBe(
        "Running",
      );

      await vi.advanceTimersByTimeAsync(1500);
      expect(
        screen.getByTestId("copilot-tool-render-duration").textContent,
      ).toBe("1.5s");

      await rendered.rerender({ status: "complete", result: "ok" });
      expect(screen.getByTestId("copilot-tool-render-status").textContent).toBe(
        "Done",
      );
      expect(
        screen.getByTestId("copilot-tool-render-status-icon").textContent,
      ).toBe("✓");
      expect(
        screen.getByTestId("copilot-tool-render-duration").textContent,
      ).toBe("1.5s");

      // frozen: further time passing must not change the displayed duration
      await vi.advanceTimersByTimeAsync(5000);
      expect(
        screen.getByTestId("copilot-tool-render-duration").textContent,
      ).toBe("1.5s");
    });

    it("shows no duration for calls that were already complete at mount (history restore)", () => {
      const DefaultRenderer = getDefaultRenderer();
      render(DefaultRenderer as never, {
        props: {
          name: "bash",
          toolCallId: "tc-dur-hist",
          parameters: {},
          status: "complete",
          result: "ok",
        },
      });

      expect(screen.getByTestId("copilot-tool-render-status").textContent).toBe(
        "Done",
      );
      expect(
        screen.getByTestId("copilot-tool-render-status-icon").textContent,
      ).toBe("✓");
      expect(screen.queryByTestId("copilot-tool-render-duration")).toBeNull();
    });

    it("marks the card ✗失败 when the run errors while the call is still active", async () => {
      const { agent, fire } = makeFakeAgent(true);
      const DefaultRenderer = getDefaultRenderer();
      renderWithRunContext(DefaultRenderer, {
        name: "bash",
        toolCallId: "tc-fail-1",
        parameters: {},
        status: "inProgress",
        result: undefined,
      }, agent);

      expect(agent.subscribe).toHaveBeenCalledTimes(1);
      fire("onRunErrorEvent");
      await nextTick();

      expect(screen.getByTestId("copilot-tool-render-status").textContent).toBe(
        "失败",
      );
      expect(
        screen.getByTestId("copilot-tool-render-status-icon").textContent,
      ).toBe("✗");
    });

    it("marks the card ✗已中断 when the run finishes without a result for this call", async () => {
      const { agent, fire } = makeFakeAgent(true);
      const DefaultRenderer = getDefaultRenderer();
      renderWithRunContext(DefaultRenderer, {
        name: "bash",
        toolCallId: "tc-abort-1",
        parameters: {},
        status: "executing",
        result: undefined,
      }, agent);

      fire("onRunFinishedEvent");
      await nextTick();

      expect(screen.getByTestId("copilot-tool-render-status").textContent).toBe(
        "已中断",
      );
      expect(
        screen.getByTestId("copilot-tool-render-status-icon").textContent,
      ).toBe("✗");
    });

    it("does not mark an already-complete card when the run errors later", async () => {
      const { agent, fire } = makeFakeAgent(true);
      const DefaultRenderer = getDefaultRenderer();
      renderWithRunContext(DefaultRenderer, {
        name: "bash",
        toolCallId: "tc-done-1",
        parameters: {},
        status: "complete",
        result: "ok",
      }, agent);

      fire("onRunErrorEvent");
      await nextTick();

      expect(screen.getByTestId("copilot-tool-render-status").textContent).toBe(
        "Done",
      );
      expect(
        screen.getByTestId("copilot-tool-render-status-icon").textContent,
      ).toBe("✓");
    });

    it("recovers to spinner when a new run starts (resume after failure)", async () => {
      const { agent, fire } = makeFakeAgent(true);
      const DefaultRenderer = getDefaultRenderer();
      renderWithRunContext(DefaultRenderer, {
        name: "bash",
        toolCallId: "tc-resume-1",
        parameters: {},
        status: "inProgress",
        result: undefined,
      }, agent);

      fire("onRunErrorEvent");
      await nextTick();
      expect(
        screen.getByTestId("copilot-tool-render-status-icon").textContent,
      ).toBe("✗");

      fire("onRunStartedEvent");
      await nextTick();
      expect(
        screen.getByTestId("copilot-tool-render-spinner"),
      ).toBeDefined();
      expect(screen.getByTestId("copilot-tool-render-status").textContent).toBe(
        "Running",
      );
    });

    it("marks a stale active card as 已中断 at mount when the agent is idle (restored dangling call)", async () => {
      const { agent } = makeFakeAgent(false);
      const DefaultRenderer = getDefaultRenderer();
      renderWithRunContext(DefaultRenderer, {
        name: "bash",
        toolCallId: "tc-stale-1",
        parameters: {},
        status: "inProgress",
        result: undefined,
      }, agent);

      await nextTick();
      expect(screen.getByTestId("copilot-tool-render-status").textContent).toBe(
        "已中断",
      );
      expect(
        screen.getByTestId("copilot-tool-render-status-icon").textContent,
      ).toBe("✗");
    });
  });

  // P-L: 状态点颜色语义统一(F3/P9 语义: running 蓝 / done 绿 / failed 红 /
  // interrupted 琥珀) + 长参数/结果超阈值默认截断、点击展开。
  describe("P-L status dot + collapsible long payload", () => {
    it("status dot data-state 与状态语义一致: running/done/failed/interrupted", async () => {
      const DefaultRenderer = getDefaultRenderer();

      const running = render(DefaultRenderer as never, {
        props: { name: "t", toolCallId: "pl-run", parameters: {}, status: "executing", result: undefined },
      });
      expect(screen.getByTestId("copilot-tool-render-status-dot").getAttribute("data-state")).toBe("running");
      running.unmount();

      const done = render(DefaultRenderer as never, {
        props: { name: "t", toolCallId: "pl-done", parameters: {}, status: "complete", result: "ok" },
      });
      expect(screen.getByTestId("copilot-tool-render-status-dot").getAttribute("data-state")).toBe("done");
      done.unmount();

      // failed: run 出错时仍 active
      const { agent, fire } = makeFakeAgent(true);
      renderWithRunContext(DefaultRenderer, {
        name: "t", toolCallId: "pl-fail", parameters: {}, status: "inProgress", result: undefined,
      }, agent);
      fire("onRunErrorEvent");
      await nextTick();
      expect(screen.getByTestId("copilot-tool-render-status-dot").getAttribute("data-state")).toBe("failed");
    });

    it("长参数超阈值默认截断(标注总字符数),点击展开看全文,再点收起", async () => {
      const DefaultRenderer = getDefaultRenderer();
      const longValue = "x".repeat(800);
      render(DefaultRenderer as never, {
        props: {
          name: "bash",
          toolCallId: "pl-long-args",
          parameters: { data: longValue },
          status: "complete",
          result: "short",
        },
      });

      await fireEvent.click(screen.getByText("bash"));
      const pre = screen.getByTestId("copilot-tool-render-args-pre");
      expect(pre.textContent!.length).toBeLessThan(800);
      expect(pre.textContent).toContain("…");

      const toggle = screen.getByTestId("copilot-tool-render-args-toggle");
      expect(toggle.textContent).toContain("展开全部");
      expect(toggle.textContent).toMatch(/共 \d+ 字符/);

      await fireEvent.click(toggle);
      expect(screen.getByTestId("copilot-tool-render-args-pre").textContent).toContain(longValue);

      await fireEvent.click(screen.getByTestId("copilot-tool-render-args-toggle"));
      expect(screen.getByTestId("copilot-tool-render-args-pre").textContent!.length).toBeLessThan(800);
    });

    it("短参数不出展开按钮,完整显示", async () => {
      const DefaultRenderer = getDefaultRenderer();
      render(DefaultRenderer as never, {
        props: { name: "bash", toolCallId: "pl-short", parameters: { q: "hi" }, status: "complete", result: "ok" },
      });
      await fireEvent.click(screen.getByText("bash"));
      expect(screen.queryByTestId("copilot-tool-render-args-toggle")).toBeNull();
      expect(screen.getByTestId("copilot-tool-render-args-pre").textContent).toContain('"hi"');
    });

    it("长结果同样默认截断并可展开", async () => {
      const DefaultRenderer = getDefaultRenderer();
      const longResult = "y".repeat(900);
      render(DefaultRenderer as never, {
        props: { name: "bash", toolCallId: "pl-long-res", parameters: {}, status: "complete", result: longResult },
      });
      await fireEvent.click(screen.getByText("bash"));
      const pre = screen.getByTestId("copilot-tool-render-result-pre");
      expect(pre.textContent!.length).toBeLessThan(900);
      await fireEvent.click(screen.getByTestId("copilot-tool-render-result-toggle"));
      expect(screen.getByTestId("copilot-tool-render-result-pre").textContent).toBe(longResult);
    });
  });
});
