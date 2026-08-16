<script setup lang="ts">
import { computed, ref, useSlots, watch } from "vue";
import type { Component } from "vue";
import type {
  ActivityMessage,
  AssistantMessage,
  Message,
  ReasoningMessage,
  ToolMessage,
  UserMessage,
} from "@ag-ui/core";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import type {
  InterruptRenderProps,
  VueCustomMessageRendererProps,
} from "../../types";
import { getThreadClone } from "../../hooks/use-agent";
import { safeParseActivityContent } from "../../lib/activity-parse-cache";
import { useCopilotKit } from "../../providers/useCopilotKit";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import CopilotChatAssistantMessage from "./CopilotChatAssistantMessage.vue";
import CopilotChatReasoningMessage from "./CopilotChatReasoningMessage.vue";
import CopilotChatUserMessage from "./CopilotChatUserMessage.vue";

interface MessageMetaProps {
  message: Message;
  position: "before" | "after";
  runId: string;
  messageIndex: number;
  messageIndexInRun: number;
  numberOfMessagesInRun: number;
  agentId: string;
  stateSnapshot: unknown;
}

interface ActivitySlotProps {
  activityType: string;
  content: unknown;
  message: ActivityMessage;
  agent: unknown;
}

type InterruptSlotProps = InterruptRenderProps<unknown, unknown>;
type CustomMessagePosition = VueCustomMessageRendererProps["position"];
type ResolvedCustomMessageRenderer = {
  renderer:
    | Component<VueCustomMessageRendererProps>
    | ((props: VueCustomMessageRendererProps) => unknown);
  props: VueCustomMessageRendererProps;
};

const props = withDefaults(
  defineProps<{
    messages?: Message[];
    isRunning?: boolean;
  }>(),
  {
    messages: () => [],
    isRunning: false,
  },
);

defineSlots<{
  "message-before"?: (props: MessageMetaProps) => unknown;
  "message-after"?: (props: MessageMetaProps) => unknown;
  interrupt?: (props: InterruptSlotProps) => unknown;
  "assistant-message"?: (props: {
    message: AssistantMessage;
    messages: Message[];
    isRunning: boolean;
  }) => unknown;
  "user-message"?: (props: { message: UserMessage }) => unknown;
  "reasoning-message"?: (props: {
    message: ReasoningMessage;
    messages: Message[];
    isRunning: boolean;
  }) => unknown;
  "activity-message"?: (props: ActivitySlotProps) => unknown;
  [key: string]: ((props: any) => unknown) | undefined;
  cursor?: () => unknown;
  "tool-call"?: (props: {
    name: string;
    args: unknown;
    status: string;
    result: string | undefined;
    toolCall: unknown;
    toolMessage: ToolMessage | undefined;
  }) => unknown;
  [key: `tool-call-${string}`]: (props: {
    name: string;
    args: unknown;
    status: string;
    result: string | undefined;
    toolCall: unknown;
    toolMessage: ToolMessage | undefined;
  }) => unknown;
}>();

const { copilotkit } = useCopilotKit();
const config = useCopilotChatConfiguration();
const stateTick = ref(0);
const interruptState = ref<InterruptSlotProps | null>(null);
const componentSlots = useSlots() as Record<string, (props?: any) => unknown>;
const forwardedSlotNames = computed(() => Object.keys(componentSlots));
const resolvedAgentId = computed(
  () => config.value?.agentId ?? DEFAULT_AGENT_ID,
);
const resolvedThreadAgent = computed(() => {
  const agentId = resolvedAgentId.value;
  const registryAgent = copilotkit.value.getAgent(agentId);
  return getThreadClone(registryAgent, config.value?.threadId) ?? registryAgent;
});

watch(
  [
    resolvedAgentId,
    () => config.value?.threadId,
    () => copilotkit.value,
    () => copilotkit.value.runtimeConnectionStatus,
  ],
  ([_agentId, threadId], _prev, onCleanup) => {
    const registryAgent = copilotkit.value.getAgent(resolvedAgentId.value);
    const agent = getThreadClone(registryAgent, threadId) ?? registryAgent;
    if (!agent) return;

    const sub = agent.subscribe({
      onStateChanged: () => {
        stateTick.value += 1;
      },
      onRunStartedEvent: () => {
        stateTick.value += 1;
      },
      onRunFinishedEvent: () => {
        stateTick.value += 1;
      },
      onRunErrorEvent: () => {
        stateTick.value += 1;
      },
    });

    onCleanup(() => sub.unsubscribe());
  },
  { immediate: true },
);

watch(
  () => copilotkit.value,
  (core, _previous, onCleanup) => {
    interruptState.value = core.interruptState as InterruptSlotProps | null;
    const sub = core.subscribe({
      onInterruptStateChanged: ({ interruptState: nextInterruptState }) => {
        interruptState.value = nextInterruptState as InterruptSlotProps | null;
      },
      onRuntimeConnectionStatusChanged: () => {
        stateTick.value += 1;
      },
    });

    onCleanup(() => sub.unsubscribe());
  },
  { immediate: true },
);

function deduplicateMessages(messages: Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const message of messages) {
    const existing = byId.get(message.id);
    if (
      existing &&
      message.role === "assistant" &&
      existing.role === "assistant"
    ) {
      const content = message.content || existing.content;
      const toolCalls = message.toolCalls ?? existing.toolCalls;
      byId.set(message.id, {
        ...existing,
        ...message,
        content,
        toolCalls,
      } as AssistantMessage);
    } else {
      byId.set(message.id, message);
    }
  }
  return [...byId.values()];
}

const deduplicatedMessages = computed(() =>
  deduplicateMessages(props.messages),
);
const lastMessage = computed(() => props.messages[props.messages.length - 1]);
const showCursor = computed(
  () => props.isRunning && lastMessage.value?.role !== "reasoning",
);

watch(
  [() => props.messages.length, () => deduplicatedMessages.value.length],
  ([messageCount, deduplicatedCount]) => {
    if (
      process.env.NODE_ENV === "development" &&
      deduplicatedCount < messageCount
    ) {
      console.warn(
        `CopilotChatMessageView: Deduplicated ${messageCount - deduplicatedCount} message(s) with duplicate IDs.`,
      );
    }
  },
  { immediate: true },
);

function getMeta(
  message: Message,
): Omit<MessageMetaProps, "position" | "message"> {
  stateTick.value += 0;
  const agentId = resolvedAgentId.value;
  const threadId = config.value?.threadId ?? "";
  const core = copilotkit.value;

  const resolvedRunId =
    core.getRunIdForMessage(agentId, threadId, message.id) ??
    core.getRunIdsForThread(agentId, threadId).slice(-1)[0];
  const runId = resolvedRunId ?? `missing-run-id:${message.id}`;

  const agent = resolvedThreadAgent.value ?? core.getAgent(agentId);

  const messageIdsInRun =
    resolvedRunId && agent
      ? agent.messages
          .filter(
            (msg) =>
              core.getRunIdForMessage(agentId, threadId, msg.id) ===
              resolvedRunId,
          )
          .map((msg) => msg.id)
      : [message.id];

  const rawMessageIndex = agent
    ? agent.messages.findIndex((msg) => msg.id === message.id)
    : -1;
  const messageIndex = rawMessageIndex >= 0 ? rawMessageIndex : 0;
  const messageIndexInRun = resolvedRunId
    ? Math.max(messageIdsInRun.indexOf(message.id), 0)
    : 0;
  const numberOfMessagesInRun = resolvedRunId ? messageIdsInRun.length : 1;
  const stateSnapshot = resolvedRunId
    ? core.getStateByRun(agentId, threadId, resolvedRunId)
    : undefined;

  return {
    runId,
    messageIndex,
    messageIndexInRun,
    numberOfMessagesInRun,
    agentId,
    stateSnapshot,
  };
}

function getActivitySlotName(activityType: string): `activity-${string}` {
  return `activity-${activityType}`;
}

function resolveCustomMessageRenderer(
  message: Message,
  position: CustomMessagePosition,
): ResolvedCustomMessageRenderer | null {
  stateTick.value += 0;
  const slotName = position === "before" ? "message-before" : "message-after";
  if (componentSlots[slotName]) {
    return null;
  }

  const agentId = resolvedAgentId.value;
  const renderers = [...copilotkit.value.renderCustomMessages]
    .filter(
      (renderer) =>
        renderer.agentId === undefined || renderer.agentId === agentId,
    )
    .sort((a, b) => {
      const aHasAgent = a.agentId !== undefined;
      const bHasAgent = b.agentId !== undefined;
      if (aHasAgent === bHasAgent) return 0;
      return aHasAgent ? -1 : 1;
    });

  const selected = renderers[0];
  if (!selected?.render) {
    return null;
  }

  return {
    renderer: selected.render as ResolvedCustomMessageRenderer["renderer"],
    props: {
      ...getMeta(message),
      message,
      position,
    },
  };
}

function resolveActivityRenderer(
  message: ActivityMessage,
): { renderer: Component; props: ActivitySlotProps } | null {
  stateTick.value += 0;

  const agentId = resolvedAgentId.value;
  const renderer = [...copilotkit.value.renderActivityMessages]
    .filter(
      (entry) =>
        entry.activityType === message.activityType &&
        (entry.agentId === undefined || entry.agentId === agentId),
    )
    .sort((a, b) => {
      const aScoped = a.agentId !== undefined;
      const bScoped = b.agentId !== undefined;
      if (aScoped === bScoped) return 0;
      return aScoped ? -1 : 1;
    })[0];

  if (!renderer) return null;
  // FORK-PATCH(24): safeParse 按 (message, content引用) 记忆化 —— 流式 delta 重渲不再全量重校验
  const parsed = safeParseActivityContent(renderer.content, message, message.content);
  if (!parsed.success) return null;

  return {
    renderer: renderer.render as Component,
    props: {
      activityType: message.activityType,
      content: parsed.data,
      message,
      agent: resolvedThreadAgent.value,
    },
  };
}

function resolveToolMessage(
  message: Message,
  toolCallId: string,
): ToolMessage | undefined {
  return props.messages.find(
    (candidate) =>
      candidate.role === "tool" &&
      (candidate as ToolMessage).toolCallId === toolCallId,
  ) as ToolMessage | undefined;
}

// ---- P-S: 消息级操作 ----

/** 仅最后一条 assistant 消息且非运行中可重新生成。 */
function canRegenerate(message: Message): boolean {
  if (props.isRunning) return false;
  return props.messages[props.messages.length - 1]?.id === message.id;
}

/** 重新生成: 截掉该 assistant 回答(及其后残留)后重发 run。 */
async function handleRegenerate(message: Message) {
  if (!canRegenerate(message)) return;
  const agent = resolvedThreadAgent.value;
  if (!agent) return;
  const msgs = [...(agent.messages ?? [])];
  const idx = msgs.findIndex((m) => m.id === message.id);
  if (idx < 0) return;
  agent.setMessages(msgs.slice(0, idx));
  try {
    await copilotkit.value.runAgent({ agent });
  } catch {
    // 失败由 core onError 通道呈现(P-B 错误卡)
  }
}

/** 首见时间(live 消息的时间戳来源;history 消息自带 createdAt)。 */
const firstSeenAt = new Map<string, number>();

/** P-S: 消息时间戳 —— createdAt(history) ?? 首次渲染时间(live)。 */
function messageTimeLabel(message: Message): string {
  const m = message as Message & { createdAt?: unknown };
  let ts: number | null = null;
  if (typeof m.createdAt === "string") {
    const parsed = Date.parse(m.createdAt);
    if (!Number.isNaN(parsed)) ts = parsed;
  }
  if (ts === null) {
    if (!firstSeenAt.has(message.id)) firstSeenAt.set(message.id, Date.now());
    ts = firstSeenAt.get(message.id)!;
  }
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? `${pad(d.getHours())}:${pad(d.getMinutes())}`
    : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * P11: v-memo 签名 —— @ag-ui/client 对流式 delta 是**原地修改**
 * （o.content += delta，对象身份不变），不能用对象 identity 做 memo key。
 * 内容长度签名：流式中活动消息长度增长 → 仅它重渲染；历史消息签名稳定
 * → 整树跳过（500+ 消息下每次 tick 不再全量重渲染）。
 * toolCalls 长度覆盖工具调用卡片递增；tool 结果到达走 messages.length。
 *
 * stateTick 必须进 memo 依赖：STATE_SNAPSHOT/STATE_DELTA 到达时消息内容、
 * isRunning、messages.length 全都不变，仅靠前三项签名会跳过整块渲染，
 * 导致 renderCustomMessages 的 stateSnapshot prop 滞留旧值（P-baseline
 * 失败 "re-renders custom message when state updates within the same run"）。
 */
function memoSignature(message: Message): string {
  const m = message as Message & {
    toolCalls?: { function?: { arguments?: unknown } }[];
  };
  const c = m.content;
  const contentLen =
    typeof c === "string" ? c.length : Array.isArray(c) ? c.length : 0;
  // 工具参数同样是原地流式增长的（arguments += delta）——必须计入签名，
  // 否则工具卡参数流式期间不重渲染
  const toolSig = (m.toolCalls ?? [])
    .map((t) =>
      typeof t?.function?.arguments === "string"
        ? (t.function.arguments as string).length
        : 0,
    )
    .join(",");
  return `${m.id}:${m.role}:${contentLen}:${m.toolCalls?.length ?? 0}:${toolSig}`;
}
</script>

<template>
  <div data-copilotkit class="cpk:flex cpk:flex-col" v-bind="$attrs">
    <template
      v-for="message in deduplicatedMessages"
      :key="message.id"
      v-memo="[
        memoSignature(message),
        props.isRunning,
        props.messages.length,
        stateTick,
      ]"
    >
      <slot
        v-if="componentSlots['message-before']"
        name="message-before"
        :message="message"
        position="before"
        :run-id="getMeta(message).runId"
        :message-index="getMeta(message).messageIndex"
        :message-index-in-run="getMeta(message).messageIndexInRun"
        :number-of-messages-in-run="getMeta(message).numberOfMessagesInRun"
        :agent-id="getMeta(message).agentId"
        :state-snapshot="getMeta(message).stateSnapshot"
      />
      <component
        v-else-if="resolveCustomMessageRenderer(message, 'before')"
        :is="resolveCustomMessageRenderer(message, 'before')!.renderer"
        v-bind="resolveCustomMessageRenderer(message, 'before')!.props"
      />

      <slot
        v-if="message.role === 'assistant'"
        name="assistant-message"
        :message="message"
        :messages="messages"
        :is-running="isRunning"
      >
        <CopilotChatAssistantMessage
          :message="message"
          :messages="messages"
          :is-running="isRunning"
          v-bind="canRegenerate(message) ? { onRegenerate: handleRegenerate } : {}"
        >
          <template
            v-for="slotName in forwardedSlotNames"
            :key="slotName"
            #[slotName]="slotProps"
          >
            <slot :name="slotName" v-bind="slotProps" />
          </template>
        </CopilotChatAssistantMessage>
        <div
          class="cpk:flex cpk:justify-start"
          data-testid="copilot-message-time"
          style="font-size: 11px; color: #9ca3af; margin: 2px 6px 0"
        >
          {{ messageTimeLabel(message) }}
        </div>
      </slot>

      <slot
        v-else-if="message.role === 'user'"
        name="user-message"
        :message="message"
      >
        <CopilotChatUserMessage :message="message">
          <template
            v-for="slotName in forwardedSlotNames"
            :key="slotName"
            #[slotName]="slotProps"
          >
            <slot :name="slotName" v-bind="slotProps" />
          </template>
        </CopilotChatUserMessage>
        <div
          class="cpk:flex cpk:justify-end"
          data-testid="copilot-message-time"
          style="font-size: 11px; color: #9ca3af; margin: 2px 6px 0"
        >
          {{ messageTimeLabel(message) }}
        </div>
      </slot>

      <slot
        v-else-if="message.role === 'reasoning'"
        name="reasoning-message"
        :message="message"
        :messages="messages"
        :is-running="isRunning"
      >
        <CopilotChatReasoningMessage
          :message="message"
          :messages="messages"
          :is-running="isRunning"
        />
      </slot>

      <slot
        v-else-if="message.role === 'activity'"
        :name="getActivitySlotName(message.activityType)"
        :activity-type="message.activityType"
        :content="message.content"
        :message="message"
        :agent="resolvedThreadAgent"
      >
        <slot
          name="activity-message"
          :activity-type="message.activityType"
          :content="message.content"
          :message="message"
          :agent="resolvedThreadAgent"
        >
          <component
            v-if="resolveActivityRenderer(message)"
            :is="resolveActivityRenderer(message)!.renderer"
            v-bind="resolveActivityRenderer(message)!.props"
          />
        </slot>
      </slot>

      <slot
        v-if="componentSlots['message-after']"
        name="message-after"
        :message="message"
        position="after"
        :run-id="getMeta(message).runId"
        :message-index="getMeta(message).messageIndex"
        :message-index-in-run="getMeta(message).messageIndexInRun"
        :number-of-messages-in-run="getMeta(message).numberOfMessagesInRun"
        :agent-id="getMeta(message).agentId"
        :state-snapshot="getMeta(message).stateSnapshot"
      />
      <component
        v-else-if="resolveCustomMessageRenderer(message, 'after')"
        :is="resolveCustomMessageRenderer(message, 'after')!.renderer"
        v-bind="resolveCustomMessageRenderer(message, 'after')!.props"
      />
    </template>

    <slot
      v-if="interruptState"
      name="interrupt"
      :event="interruptState.event"
      :interrupt="interruptState.interrupt"
      :interrupts="interruptState.interrupts"
      :result="interruptState.result"
      :resolve="interruptState.resolve"
      :cancel="interruptState.cancel"
    />

    <slot v-if="showCursor" name="cursor">
      <div
        class="cpk:w-[11px] cpk:h-[11px] cpk:rounded-full cpk:bg-foreground cpk:animate-pulse cpk:ml-1"
        data-testid="copilot-loading-cursor"
      />
    </slot>
  </div>
</template>
