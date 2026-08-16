<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from "vue";
import type { Message, ReasoningMessage } from "@ag-ui/core";
// FORK-PATCH(P28-A lazy-markdown): streamdown-vue 静态引入会把 shiki+mermaid
// 拖进入口静态链(实测占初始 JS gzip ~430/481KB 的大头)。改异步组件后
// 首条 assistant 消息到达时才加载 markdown 渲染器,初始包降出预算红线。
const StreamMarkdown = defineAsyncComponent(() =>
  import("streamdown-vue").then((m) => m.StreamMarkdown),
);
import { IconChevronRight } from "../icons";
import { useThrottledContent } from "../../lib/use-throttled-content";
import { degradeMermaidForStreaming } from "../../lib/degrade-mermaid";
import { useIdleUpgrade } from "../../lib/use-idle-upgrade";
import { PlainCodeBlock } from "./plain-code-block";

const props = withDefaults(
  defineProps<{
    message: ReasoningMessage;
    messages?: Message[];
    isRunning?: boolean;
  }>(),
  {
    messages: () => [],
    isRunning: false,
  },
);

defineSlots<{
  layout?: (props: {
    message: ReasoningMessage;
    messages: Message[];
    isRunning: boolean;
    header: {
      isOpen: boolean;
      label: string;
      hasContent: boolean;
      isStreaming: boolean;
      onClick?: () => void;
    };
    contentView: {
      isStreaming: boolean;
      hasContent: boolean;
      content: string;
    };
    toggle: {
      isOpen: boolean;
      contentView: {
        isStreaming: boolean;
        hasContent: boolean;
        content: string;
      };
    };
  }) => unknown;
  header?: (props: {
    isOpen: boolean;
    label: string;
    hasContent: boolean;
    isStreaming: boolean;
    onClick?: () => void;
  }) => unknown;
  "content-view"?: (props: {
    isStreaming: boolean;
    hasContent: boolean;
    content: string;
  }) => unknown;
  toggle?: (props: {
    isOpen: boolean;
    contentView: {
      isStreaming: boolean;
      hasContent: boolean;
      content: string;
    };
  }) => unknown;
}>();

function formatDuration(seconds: number): string {
  if (seconds < 1) return "a few seconds";
  if (seconds < 60) return `${Math.round(seconds)} seconds`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (secs === 0) return `${mins} minute${mins > 1 ? "s" : ""}`;
  return `${mins}m ${secs}s`;
}

const normalizedContent = computed(() =>
  typeof props.message.content === "string" ? props.message.content : "",
);
const hasContent = computed(() => normalizedContent.value.length > 0);
const isLatest = computed(
  () => props.messages[props.messages.length - 1]?.id === props.message.id,
);
const isStreaming = computed(() => !!(props.isRunning && isLatest.value));

// FORK-PATCH(23 stream-throttle): 喂给 StreamMarkdown 的内容限频 ——
// 流式期间每个 SSE delta 触发全量 markdown re-parse(含 shiki) 是长思考卡顿根因。
// slot 契约仍拿 normalizedContent(实时);仅默认渲染器用限频副本。
const { content: markdownContent } = useThrottledContent(normalizedContent, isStreaming);

// FORK-PATCH(27 idle-upgrade): 收尾一次性真渲染（shiki/mermaid）挂
// requestIdleCallback —— 翻 false 同步全量 re-parse 是 FORK#25 记录的收尾阻塞
// （reasoning 收尾实测 0.5~2.5s）。降级形态内容完整，升格 idle 静默进行。
const { upgradeReady } = useIdleUpgrade(isStreaming);
const renderDegraded = computed(() => isStreaming.value || !upgradeReady.value);

// FORK-PATCH(25 stream-plain-codeblock): 流式期间 codeblock 降级为纯 pre>code
// （streamdown-vue components map 的 codeblock 键覆盖），规避 shiki 高亮分配
// 风暴；流式结束回到默认 shiki CodeBlock（一次性高亮 + 复制/下载按钮）。
const streamdownComponents = computed(() =>
  renderDegraded.value ? { codeblock: PlainCodeBlock } : undefined,
);
// FORK-PATCH(25 stream-degrade-mermaid): mermaid 分支在 streamdown-vue 内先于
// codeblock 覆盖键，只能在渲染副本层降级 —— 流式期 ```mermaid 改名 ```text，
// 结束用原始内容一次性真渲染 mermaid。
const streamdownContent = computed(() =>
  renderDegraded.value ? degradeMermaidForStreaming(markdownContent.value) : markdownContent.value,
);

const elapsed = ref(0);
const isOpen = ref(isStreaming.value);
const userToggledDuringStreaming = ref(false);
let startTimeMs: number | null = null;
let elapsedInterval: ReturnType<typeof setInterval> | null = null;

function clearElapsedInterval() {
  if (elapsedInterval) {
    clearInterval(elapsedInterval);
    elapsedInterval = null;
  }
}

function updateElapsedNow() {
  if (startTimeMs !== null) {
    elapsed.value = (Date.now() - startTimeMs) / 1000;
  }
}

watch(
  isStreaming,
  (nextIsStreaming) => {
    if (nextIsStreaming) {
      if (startTimeMs === null) {
        startTimeMs = Date.now();
      }
      clearElapsedInterval();
      elapsedInterval = setInterval(updateElapsedNow, 1000);
      userToggledDuringStreaming.value = false;
      isOpen.value = true;
      return;
    }

    clearElapsedInterval();
    updateElapsedNow();
    if (!userToggledDuringStreaming.value) {
      isOpen.value = false;
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  clearElapsedInterval();
});

const label = computed(() =>
  isStreaming.value
    ? "Thinking…"
    : `Thought for ${formatDuration(elapsed.value)}`,
);

function toggleOpen() {
  if (!hasContent.value) return;
  userToggledDuringStreaming.value = true;
  isOpen.value = !isOpen.value;
}
</script>

<template>
  <div data-copilotkit class="cpk:my-1" :data-message-id="message.id">
    <slot
      name="layout"
      :message="message"
      :messages="messages"
      :is-running="isRunning"
      :header="{
        isOpen,
        label,
        hasContent,
        isStreaming,
        onClick: hasContent ? toggleOpen : undefined,
      }"
      :content-view="{
        isStreaming,
        hasContent,
        content: normalizedContent,
      }"
      :toggle="{
        isOpen,
        contentView: {
          isStreaming,
          hasContent,
          content: normalizedContent,
        },
      }"
    >
      <slot
        name="header"
        :is-open="isOpen"
        :label="label"
        :has-content="hasContent"
        :is-streaming="isStreaming"
        :on-click="hasContent ? toggleOpen : undefined"
      >
        <button
          type="button"
          class="cpk:inline-flex cpk:items-center cpk:gap-1 cpk:py-1 cpk:text-sm cpk:text-muted-foreground cpk:transition-colors cpk:select-none"
          :class="
            hasContent
              ? 'cpk:hover:text-foreground cpk:cursor-pointer'
              : 'cpk:cursor-default'
          "
          :aria-expanded="hasContent ? isOpen : undefined"
          @click="hasContent ? toggleOpen() : undefined"
        >
          <span class="cpk:font-medium">{{ label }}</span>
          <span
            v-if="isStreaming && !hasContent"
            class="cpk:inline-flex cpk:items-center cpk:ml-1"
          >
            <span
              class="cpk:w-1.5 cpk:h-1.5 cpk:rounded-full cpk:bg-muted-foreground cpk:animate-pulse"
            />
          </span>
          <IconChevronRight
            v-if="hasContent"
            class="cpk:size-3.5 cpk:shrink-0 cpk:transition-transform cpk:duration-200"
            :class="{ 'cpk:rotate-90': isOpen }"
          />
        </button>
      </slot>

      <slot
        name="toggle"
        :is-open="isOpen"
        :content-view="{
          isStreaming,
          hasContent,
          content: normalizedContent,
        }"
      >
        <div
          class="cpk:grid cpk:transition-[grid-template-rows] cpk:duration-200 cpk:ease-in-out"
          :style="{ gridTemplateRows: isOpen ? '1fr' : '0fr' }"
        >
          <div class="cpk:overflow-hidden">
            <slot
              name="content-view"
              :is-streaming="isStreaming"
              :has-content="hasContent"
              :content="normalizedContent"
            >
              <div v-if="hasContent || isStreaming" class="cpk:pb-2 cpk:pt-1">
                <div class="cpk:text-sm cpk:text-muted-foreground">
                  <StreamMarkdown :content="streamdownContent" :components="streamdownComponents" />
                  <span
                    v-if="isStreaming && hasContent"
                    class="cpk:inline-flex cpk:items-center cpk:ml-1 cpk:align-middle"
                  >
                    <span
                      class="cpk:w-2 cpk:h-2 cpk:rounded-full cpk:bg-muted-foreground cpk:animate-pulse-cursor"
                    />
                  </span>
                </div>
              </div>
            </slot>
          </div>
        </div>
      </slot>
    </slot>
  </div>
</template>
