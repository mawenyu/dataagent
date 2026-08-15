import {
  computed,
  defineComponent,
  h,
  inject,
  onUnmounted,
  ref,
  toRaw,
  watch,
  watchEffect,
} from "vue";
import type { WatchSource } from "vue";
import type { Component, VNodeChild } from "vue";
import { ToolCallStatus } from "@copilotkit/core";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import { useRenderTool } from "./use-render-tool";
import { getThreadClone } from "./use-agent";
import {
  CopilotChatConfigurationKey,
  CopilotKitKey,
} from "../providers/keys";

type DefaultRenderProps = {
  name: string;
  toolCallId: string;
  parameters: unknown;
  status: "inProgress" | "executing" | "complete";
  result: string | undefined;
};

/**
 * Module-level dedup set so an unknown status value only emits a console
 * warning the FIRST time we encounter it. Otherwise a stuck/unmapped status
 * would log on every re-render (potentially many per second).
 */
const warnedUnknownStatuses = new Set<string>();

/**
 * Map a {@link ToolCallStatus} enum value to the documented string-union
 * status the {@link DefaultRenderProps} contract exposes. Unknown / future
 * enum members log a warning (once per distinct value) and fall back to
 * `"inProgress"`.
 */
function mapToolCallStatus(
  status: ToolCallStatus,
): DefaultRenderProps["status"] {
  switch (status) {
    case ToolCallStatus.Complete:
      return "complete";
    case ToolCallStatus.Executing:
      return "executing";
    case ToolCallStatus.InProgress:
      return "inProgress";
    default: {
      const key = String(status);
      if (!warnedUnknownStatuses.has(key)) {
        warnedUnknownStatuses.add(key);
        console.warn(
          `[CopilotKit] Unknown ToolCallStatus "${key}" in default tool-call renderer; falling back to "inProgress".`,
        );
      }
      return "inProgress";
    }
  }
}

/**
 * Convert framework-internal raw renderer props (`args`, enum status) to the
 * documented DefaultRenderProps shape. Idempotent on already-documented input
 * — if the caller passes `parameters` and a string-union `status`, those win.
 */
type AdaptInput = {
  name?: unknown;
  toolCallId?: unknown;
  args?: unknown;
  parameters?: unknown;
  status?: unknown;
  result?: unknown;
};

function adaptRendererProps(raw: AdaptInput): DefaultRenderProps {
  const parameters = raw.parameters !== undefined ? raw.parameters : raw.args;
  const rawStatus = raw.status;
  const status: DefaultRenderProps["status"] =
    rawStatus === "inProgress" ||
    rawStatus === "executing" ||
    rawStatus === "complete"
      ? rawStatus
      : mapToolCallStatus(rawStatus as ToolCallStatus);
  return {
    name: raw.name as string,
    toolCallId: raw.toolCallId as string,
    parameters,
    status,
    result: raw.result as string | undefined,
  };
}

/**
 * Guarded JSON.stringify for the expanded `<pre>` blocks. A circular reference
 * would otherwise crash the Vue render.
 */
function safeStringifyForPre(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch (err) {
    console.warn(
      "[CopilotKit] Failed to JSON.stringify tool-call payload for default renderer; falling back to String():",
      err,
    );
    try {
      return String(value);
    } catch (innerErr) {
      console.warn(
        "[CopilotKit] safeStringifyForPre: value could not be stringified:",
        innerErr,
      );
      return "[unserializable]";
    }
  }
}

/**
 * Human-readable tool-call duration: "850ms" under a second, "1.2s" under a
 * minute, "2m 5s" beyond.
 */
function formatToolCallDuration(ms: number): string {
  const clamped = Math.max(0, ms);
  if (clamped < 1000) return `${Math.round(clamped)}ms`;
  if (clamped < 60_000) return `${(clamped / 1000).toFixed(1)}s`;
  const minutes = Math.floor(clamped / 60_000);
  const seconds = Math.round((clamped % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/** P-L: 参数/结果文本超此阈值默认截断,点击展开全文。 */
const LONG_TEXT_THRESHOLD = 600;

/** P-L: 状态点颜色语义(与 F3/P9 状态语义统一)。 */
const STATUS_DOT_COLORS = {
  running: "#3b82f6",
  done: "#16a34a",
  failed: "#dc2626",
  interrupted: "#d97706",
} as const;

/**
 * 工具级失败结果前缀 —— gateway AguiEventTranslator 对 `session.tool.failed`
 * 下发的 TOOL_CALL_RESULT content 固定以 `"工具执行失败: "` 开头
 * （AgUiProtocolServiceTest.toolFailureEmitsToolCallResult 锁定该契约）。
 * 工具级失败不产生 RUN_ERROR，卡片仍以 complete 收尾；按行首前缀识别，
 * 结果中段出现同样字样不算（如 grep 命中日志）。
 */
const TOOL_FAILURE_RESULT_PREFIX = "工具执行失败: ";

function isFailureResult(result: unknown): boolean {
  return (
    typeof result === "string" && result.startsWith(TOOL_FAILURE_RESULT_PREFIX)
  );
}

/** Inline SVG spinner (SMIL-animated, no CSS keyframes needed). */
function renderSpinner() {  return h(
    "svg",
    {
      width: "12",
      height: "12",
      viewBox: "0 0 16 16",
      "data-testid": "copilot-tool-render-spinner",
      "aria-hidden": "true",
    },
    [
      h(
        "circle",
        {
          cx: "8",
          cy: "8",
          r: "6",
          fill: "none",
          stroke: "#64748b",
          "stroke-width": "2.5",
          "stroke-linecap": "round",
          "stroke-dasharray": "28.3 9.4",
        },
        [
          h("animateTransform", {
            attributeName: "transform",
            attributeType: "XML",
            type: "rotate",
            from: "0 8 8",
            to: "360 8 8",
            dur: "0.8s",
            repeatCount: "indefinite",
          }),
        ],
      ),
    ],
  );
}

const DefaultToolCallRenderer = defineComponent({
  props: {
    name: {
      type: String,
      required: true,
    },
    toolCallId: {
      type: String,
      required: true,
    },
    parameters: {
      type: null,
      required: false,
      default: undefined,
    },
    status: {
      type: String as () => "inProgress" | "executing" | "complete",
      required: true,
    },
    result: {
      // Typeless on purpose: the renderer body handles both string results
      // and structured (object) results via `safeStringifyForPre`. Declaring
      // `type: String` would trip Vue's dev-mode prop-type warning on every
      // non-string result and make the defensive branch unreachable.
      type: null,
      required: false,
      default: undefined,
    },
  },
  setup(props) {
    const isExpanded = ref(false);
    // P-L: 长参数/结果块级折叠(超阈值默认截断,点击展开全文)
    const argsExpanded = ref(false);
    const resultExpanded = ref(false);

    const isActiveStatus = () =>
      props.status === "inProgress" || props.status === "executing";

    // --- Duration tracking -------------------------------------------------
    // `startedAt` is set the first time an active status is observed; the
    // duration freezes when the call completes OR when the run dies while
    // the call is still active. Calls that mount already-complete (history
    // restore) never get a `startedAt`, so no duration is shown for them.
    const startedAt = ref<number | null>(null);
    const frozenDurationMs = ref<number | null>(null);
    const nowTick = ref(Date.now());
    let tickTimer: ReturnType<typeof setInterval> | null = null;

    function stopTicking() {
      if (tickTimer !== null) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
    }
    function startTicking() {
      if (tickTimer === null) {
        tickTimer = setInterval(() => {
          nowTick.value = Date.now();
        }, 100);
      }
    }
    function freezeDuration() {
      if (startedAt.value !== null && frozenDurationMs.value === null) {
        frozenDurationMs.value = Date.now() - startedAt.value;
      }
      stopTicking();
    }

    watch(
      () => props.status,
      () => {
        if (isActiveStatus()) {
          if (startedAt.value === null) startedAt.value = Date.now();
          nowTick.value = Date.now();
          startTicking();
        } else {
          freezeDuration();
        }
      },
      { immediate: true },
    );
    onUnmounted(stopTicking);

    // --- Run lifecycle (failure / interrupt detection) ---------------------
    // The ToolCallStatus enum has no error state, so a failed or aborted run
    // leaves the card stuck on "Running". Subscribe to the same (possibly
    // thread-cloned) agent the chat uses and mark still-active cards ✗ when
    // the run errors or ends without a result for this call.
    // Both injections degrade gracefully to null outside a provider (unit
    // tests mount the renderer bare), in which case the card simply keeps
    // the spinner/✓ behaviour.
    type RunEnd = "failed" | "finished" | null;
    const runEnd = ref<RunEnd>(null);

    const kitContext = inject(CopilotKitKey, null);
    const chatConfig = inject(CopilotChatConfigurationKey, null);

    watchEffect((onCleanup) => {
      const core = kitContext?.copilotkit.value;
      if (!core) return;
      const agentId = chatConfig?.value?.agentId ?? DEFAULT_AGENT_ID;
      const threadId = chatConfig?.value?.threadId;
      const registryAgent = core.getAgent(agentId);
      const rawRegistry = registryAgent ? toRaw(registryAgent) : undefined;
      const agent =
        (threadId ? getThreadClone(rawRegistry, threadId) : undefined) ??
        rawRegistry;
      if (!agent) return;

      // A card that mounts still-active while the agent is idle is a
      // dangling call from a dead run (e.g. restored history) — mark it
      // interrupted immediately instead of spinning forever.
      if (!agent.isRunning && isActiveStatus() && runEnd.value === null) {
        runEnd.value = "finished";
        freezeDuration();
      }

      const sub = agent.subscribe({
        onRunStartedEvent: () => {
          // A fresh run (e.g. resume after failure) revives active cards.
          runEnd.value = null;
          if (isActiveStatus() && frozenDurationMs.value === null) {
            startTicking();
          }
        },
        onRunFinishedEvent: () => {
          if (runEnd.value === null) runEnd.value = "finished";
          if (isActiveStatus()) freezeDuration();
        },
        onRunErrorEvent: () => {
          runEnd.value = "failed";
          if (isActiveStatus()) freezeDuration();
        },
      });
      onCleanup(() => sub.unsubscribe());
    });

    const failedState = computed<RunEnd>(() => {
      if (props.status === "complete") {
        // 工具级失败（session.tool.failed）：run 正常收尾，但结果本身是错误。
        return isFailureResult(props.result) ? "failed" : null;
      }
      return runEnd.value;
    });

    const durationText = computed(() => {
      if (frozenDurationMs.value !== null) {
        return formatToolCallDuration(frozenDurationMs.value);
      }
      if (startedAt.value !== null && props.status !== "complete") {
        return formatToolCallDuration(nowTick.value - startedAt.value);
      }
      return null;
    });

    /** P-L: 参数/结果块 —— 超阈值默认截断(标注总字符数),点击展开/收起。 */
    function renderPayloadBlock(
      label: string,
      text: string,
      expanded: typeof argsExpanded,
      testidBase: string,
    ) {
      const isLong = text.length > LONG_TEXT_THRESHOLD;
      const shown =
        isLong && !expanded.value
          ? `${text.slice(0, LONG_TEXT_THRESHOLD)}…`
          : text;
      return h("div", [
        h("div", label),
        h("pre", { "data-testid": `${testidBase}-pre` }, shown),
        isLong
          ? h(
              "button",
              {
                type: "button",
                "data-testid": `${testidBase}-toggle`,
                onClick: (e: MouseEvent) => {
                  e.stopPropagation();
                  expanded.value = !expanded.value;
                },
                style: {
                  border: "none",
                  background: "transparent",
                  color: "#6366f1",
                  fontSize: "12px",
                  cursor: "pointer",
                  padding: "2px 0",
                },
              },
              expanded.value ? "收起" : `展开全部(共 ${text.length} 字符)`,
            )
          : null,
      ]);
    }

    return () => {
      const isActive = isActiveStatus();
      const isComplete = props.status === "complete";
      const failed = failedState.value;
      const statusLabel = failed
        ? failed === "failed"
          ? "失败"
          : "已中断"
        : isActive
          ? "Running"
          : isComplete
            ? "Done"
            : props.status;
      const statusColor = failed
        ? failed === "failed"
          ? "#dc2626"
          : "#d97706"
        : isComplete
          ? "#16a34a"
          : undefined;

      const iconNode = failed
        ? "✗"
        : isComplete
          ? "✓"
          : isActive
            ? renderSpinner()
            : null;

      // P-L: 状态点(头部左侧,颜色语义与状态图标/文字统一)
      const dotState = failed
        ? failed === "failed"
          ? "failed"
          : "interrupted"
        : isComplete
          ? "done"
          : "running";

      return h(
        "div",
        {
          "data-testid": "copilot-tool-render",
          "data-tool-name": props.name,
          "data-tool-call-id": props.toolCallId,
          "data-status": props.status,
          "data-run-end": failed ?? "",
          "data-args": safeStringifyForAttr(props.parameters),
          "data-result": safeStringifyForAttr(props.result),
          style: { marginTop: "8px", paddingBottom: "8px" },
        },
        [
          h(
            "div",
            {
              style: {
                borderRadius: "12px",
                border: "1px solid #e4e4e7",
                backgroundColor: failed ? "#fef2f2" : "#fafafa",
                padding: "14px 16px",
              },
            },
            [
              h(
                "button",
                {
                  type: "button",
                  "aria-expanded": String(isExpanded.value),
                  onClick: () => {
                    isExpanded.value = !isExpanded.value;
                  },
                  style: {
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "10px",
                    cursor: "pointer",
                    border: "none",
                    padding: 0,
                    margin: 0,
                    background: "transparent",
                    textAlign: "left",
                  },
                },
                [
                  h(
                    "span",
                    {
                      style: {
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "8px",
                        minWidth: 0,
                      },
                    },
                    [
                      h("span", {
                        "data-testid": "copilot-tool-render-status-dot",
                        "data-state": dotState,
                        "aria-hidden": "true",
                        style: {
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          backgroundColor: STATUS_DOT_COLORS[dotState],
                          flex: "none",
                        },
                      }),
                      h(
                        "span",
                        {
                          "data-testid": "copilot-tool-render-name",
                          style: { fontWeight: "600" },
                        },
                        props.name,
                      ),
                    ],
                  ),
                  h(
                    "span",
                    {
                      style: {
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        color: statusColor,
                      },
                    },
                    [
                      h(
                        "span",
                        {
                          "data-testid": "copilot-tool-render-status-icon",
                          style: {
                            display: "inline-flex",
                            alignItems: "center",
                            fontSize: "12px",
                            lineHeight: 1,
                          },
                        },
                        iconNode ? [iconNode] : [],
                      ),
                      h(
                        "span",
                        { "data-testid": "copilot-tool-render-status" },
                        statusLabel,
                      ),
                      durationText.value
                        ? h(
                            "span",
                            {
                              "data-testid": "copilot-tool-render-duration",
                              style: { color: "#94a3b8", fontSize: "12px" },
                            },
                            durationText.value,
                          )
                        : null,
                    ],
                  ),
                ],
              ),
              isExpanded.value
                ? h("div", { style: { marginTop: "12px" } }, [
                    renderPayloadBlock(
                      "Arguments",
                      safeStringifyForPre(props.parameters ?? {}),
                      argsExpanded,
                      "copilot-tool-render-args",
                    ),
                    // P-R: 完成态但无输出 → 明确提示,不留空白
                    isComplete &&
                    (props.result === undefined ||
                      (typeof props.result === "string"
                        ? props.result.trim() === ""
                        : safeStringifyForPre(props.result).trim() === ""))
                      ? h("div", [
                          h("div", "Result"),
                          h(
                            "div",
                            {
                              "data-testid": "copilot-tool-render-result-empty",
                              style: { color: "#9ca3af", fontSize: "12.5px", fontStyle: "italic" },
                            },
                            "（无输出）",
                          ),
                        ])
                      : props.result !== undefined
                        ? renderPayloadBlock(
                            "Result",
                            typeof props.result === "string"
                              ? props.result
                              : safeStringifyForPre(props.result),
                            resultExpanded,
                            "copilot-tool-render-result",
                          )
                        : null,
                  ])
                : null,
            ],
          ),
        ],
      );
    };
  },
});

function safeStringifyForAttr(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch (err) {
    console.warn(
      "[CopilotKit] Failed to JSON.stringify tool-call payload for data-* attribute; falling back to String():",
      err,
    );
    try {
      return String(value);
    } catch (innerErr) {
      console.warn(
        "[CopilotKit] safeStringifyForAttr: value could not be stringified:",
        innerErr,
      );
      return "";
    }
  }
}

export function useDefaultRenderTool(
  config?: {
    render?:
      | ((props: DefaultRenderProps) => VNodeChild)
      | Component<DefaultRenderProps>;
  },
  deps?: WatchSource<unknown>[],
): void {
  const userRender = config?.render;

  // When the user supplies a function render, wrap it so they receive the
  // documented {@link DefaultRenderProps} shape regardless of whether the
  // call site passes `args + enum status` (CopilotChatToolCallsView's core
  // path) or `parameters + string status` (an already-adapted call site).
  // Component-typed renders are also wrapped — Vue would bind whatever attrs
  // the call site passes, which means a component-typed render would receive
  // the raw `{ args, status: <enum> }` shape instead of the documented
  // `{ parameters, status: <string-union> }` shape. Wrap so the user
  // component sees `DefaultRenderProps`.
  let registeredRender:
    | ((props: DefaultRenderProps) => VNodeChild)
    | Component<DefaultRenderProps>;

  if (typeof userRender === "function") {
    const fn = userRender as (props: DefaultRenderProps) => VNodeChild;
    registeredRender = ((rawProps: AdaptInput) => {
      const adapted = adaptRendererProps(rawProps);
      return fn(adapted);
    }) as (props: DefaultRenderProps) => VNodeChild;
  } else if (userRender) {
    const userComponent = userRender;
    registeredRender = ((rawProps: AdaptInput) => {
      const adapted = adaptRendererProps(rawProps);
      return h(userComponent as Component, {
        name: adapted.name,
        toolCallId: adapted.toolCallId,
        parameters: adapted.parameters,
        status: adapted.status,
        result: adapted.result,
      });
    }) as (props: DefaultRenderProps) => VNodeChild;
  } else {
    registeredRender = ((rawProps: AdaptInput) => {
      const adapted = adaptRendererProps(rawProps);
      return h(DefaultToolCallRenderer, {
        name: adapted.name,
        toolCallId: adapted.toolCallId,
        parameters: adapted.parameters,
        status: adapted.status,
        result: adapted.result,
      });
    }) as (props: DefaultRenderProps) => VNodeChild;
  }

  useRenderTool(
    {
      name: "*",
      render: registeredRender,
    },
    deps,
  );
}
