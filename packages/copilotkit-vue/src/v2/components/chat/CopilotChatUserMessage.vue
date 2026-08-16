<script setup lang="ts">
import { computed, getCurrentInstance, onBeforeUnmount, ref } from "vue";
import type { UserMessage } from "@ag-ui/core";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import { CopilotChatDefaultLabels } from "../../providers/types";
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconEdit,
} from "../icons";
import type {
  CopilotChatUserMessageBranchNavigationSlotProps,
  CopilotChatUserMessageCopyButtonSlotProps,
  CopilotChatUserMessageEditButtonSlotProps,
  CopilotChatUserMessageLayoutSlotProps,
  CopilotChatUserMessageMessageRendererSlotProps,
  CopilotChatUserMessageOnEditMessageProps,
  CopilotChatUserMessageOnSwitchToBranchProps,
  CopilotChatUserMessageToolbarSlotProps,
} from "./types";
import CopilotChatAttachmentRenderer from "./CopilotChatAttachmentRenderer.vue";

const props = withDefaults(
  defineProps<{
    message: UserMessage;
    branchIndex?: number;
    numberOfBranches?: number;
  }>(),
  {
    branchIndex: 0,
    numberOfBranches: 1,
  },
);

defineSlots<{
  "message-renderer"?: (
    props: CopilotChatUserMessageMessageRendererSlotProps,
  ) => unknown;
  toolbar?: (props: CopilotChatUserMessageToolbarSlotProps) => unknown;
  "copy-button"?: (props: CopilotChatUserMessageCopyButtonSlotProps) => unknown;
  "edit-button"?: (props: CopilotChatUserMessageEditButtonSlotProps) => unknown;
  "branch-navigation"?: (
    props: CopilotChatUserMessageBranchNavigationSlotProps,
  ) => unknown;
  layout?: (props: CopilotChatUserMessageLayoutSlotProps) => unknown;
  "toolbar-items"?: () => unknown;
}>();

const emit = defineEmits<{
  "edit-message": [payload: CopilotChatUserMessageOnEditMessageProps];
  "switch-to-branch": [payload: CopilotChatUserMessageOnSwitchToBranchProps];
}>();

const config = useCopilotChatConfiguration();
const labels = computed(() => config.value?.labels ?? CopilotChatDefaultLabels);
const instance = getCurrentInstance();
const copied = ref(false);
let copiedResetTimeout: ReturnType<typeof setTimeout> | null = null;
const vnodeProps = computed(
  () => (instance?.vnode.props ?? {}) as Record<string, unknown>,
);

const toolbarButtonClass = [
  "cpk:inline-flex cpk:h-8 cpk:w-8 cpk:items-center cpk:justify-center cpk:rounded-md cpk:p-0",
  "cpk:cursor-pointer cpk:text-[rgb(93,93,93)] cpk:transition-colors cpk:hover:bg-[#E8E8E8]",
  "cpk:hover:text-[rgb(93,93,93)] cpk:dark:text-[rgb(243,243,243)] cpk:dark:hover:bg-[#303030]",
  "cpk:dark:hover:text-[rgb(243,243,243)] cpk:disabled:pointer-events-none cpk:disabled:opacity-50",
].join(" ");

function flattenUserMessageContent(content?: UserMessage["content"]): string {
  if (!content) {
    return "";
  }

  if (typeof content === "string") {
    return content;
  }

  return content
    .map((part) => {
      if (
        part &&
        typeof part === "object" &&
        "type" in part &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }
      return "";
    })
    .filter((text) => text.length > 0)
    .join("\n");
}

const flattenedContent = computed(() =>
  flattenUserMessageContent(props.message.content),
);

// FORK#26: 用户消息附件区 —— 非文本 parts 渲染为 AttachmentRenderer 附件条
//（上游只把 parts 摊平成文本,附件完全不可见）。历史消息里 gateway 还原的
// document part 可能没有 source —— chip 只靠 filename 也能渲染/被点击预览
//（App 侧按文件名解析下载链）；无可用 URL 的 image/audio/video 跳过。
interface UserAttachmentPart {
  type: string;
  source: { type: "url" | "data"; value: string; mimeType?: string };
  filename?: string;
}
const attachmentParts = computed<UserAttachmentPart[]>(() => {
  const content = props.message.content;
  if (!Array.isArray(content)) return [];
  const out: UserAttachmentPart[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as Record<string, unknown>;
    const type = p.type;
    if (type !== "image" && type !== "audio" && type !== "video" && type !== "document") continue;
    const meta = (p.metadata ?? {}) as Record<string, unknown>;
    const filename = typeof meta.filename === "string" ? meta.filename : undefined;
    const rawSource = p.source as
      | { type?: string; value?: string; mimeType?: string }
      | undefined;
    const hasUrl = typeof rawSource?.value === "string" && rawSource.value.length > 0;
    if (!hasUrl && type !== "document") continue; // 无源图片/音视频无法渲染
    const mimeType = typeof meta.mimeType === "string" ? meta.mimeType : rawSource?.mimeType;
    out.push({
      type,
      source: hasUrl
        ? { type: rawSource!.type === "data" ? "data" : "url", value: rawSource!.value!, mimeType }
        : { type: "url", value: "", mimeType },
      filename,
    });
  }
  return out;
});
const isMultiline = computed(() => flattenedContent.value.includes("\n"));
function hasListener(listenerName: string) {
  const listener = vnodeProps.value[listenerName];
  if (Array.isArray(listener)) {
    return listener.length > 0;
  }
  return !!listener;
}

const hasEditAction = computed(() => hasListener("onEditMessage"));
const showBranchNavigation = computed(
  () => props.numberOfBranches > 1 && hasListener("onSwitchToBranch"),
);

const canGoPrev = computed(() => props.branchIndex > 0);
const canGoNext = computed(
  () => props.branchIndex < props.numberOfBranches - 1,
);

function resetCopiedStateWithDelay() {
  if (copiedResetTimeout) {
    clearTimeout(copiedResetTimeout);
  }
  copied.value = true;
  copiedResetTimeout = setTimeout(() => {
    copied.value = false;
    copiedResetTimeout = null;
  }, 2000);
}

async function handleCopyMessage() {
  if (!flattenedContent.value) return;

  if (
    typeof navigator === "undefined" ||
    typeof navigator.clipboard?.writeText !== "function"
  ) {
    return;
  }

  try {
    await navigator.clipboard.writeText(flattenedContent.value);
    resetCopiedStateWithDelay();
  } catch (error) {
    console.error("Failed to copy to clipboard:", error);
  }
}

function handleEditMessage() {
  if (!hasEditAction.value) {
    return;
  }
  const payload = { message: props.message };
  emit("edit-message", payload);
}

function switchToBranch(branchIndex: number) {
  if (!showBranchNavigation.value) {
    return;
  }
  const payload = {
    branchIndex,
    numberOfBranches: props.numberOfBranches,
    message: props.message,
  };
  emit("switch-to-branch", payload);
}

function goPrev() {
  if (!canGoPrev.value) {
    return;
  }
  switchToBranch(props.branchIndex - 1);
}

function goNext() {
  if (!canGoNext.value) {
    return;
  }
  switchToBranch(props.branchIndex + 1);
}

onBeforeUnmount(() => {
  if (copiedResetTimeout) {
    clearTimeout(copiedResetTimeout);
  }
});
</script>

<template>
  <slot
    name="layout"
    :message="message"
    :content="flattenedContent"
    :is-multiline="isMultiline"
    :show-branch-navigation="showBranchNavigation"
    :has-edit-action="hasEditAction"
    :branch-index="branchIndex"
    :number-of-branches="numberOfBranches"
    :can-go-prev="canGoPrev"
    :can-go-next="canGoNext"
    :on-copy="handleCopyMessage"
    :on-edit="handleEditMessage"
    :go-prev="goPrev"
    :go-next="goNext"
    :copied="copied"
  >
    <div
      data-copilotkit
      data-testid="copilot-user-message"
      class="cpk:flex cpk:flex-col cpk:items-end cpk:group cpk:pt-10"
      :data-message-id="message.id"
      v-bind="$attrs"
    >
      <!-- FORK#26: 附件区在 message-renderer 槽之外 —— 覆盖槽不丢附件 -->
      <div
        v-if="attachmentParts.length > 0"
        class="cpk:flex cpk:flex-wrap cpk:gap-2 cpk:justify-end cpk:max-w-[80%] cpk:mb-1.5"
        data-testid="copilot-user-message-attachments"
      >
        <CopilotChatAttachmentRenderer
          v-for="(part, index) in attachmentParts"
          :key="index"
          :type="part.type as never"
          :source="part.source"
          :filename="part.filename"
        />
      </div>
      <slot
        name="message-renderer"
        :message="message"
        :content="flattenedContent"
        :is-multiline="isMultiline"
      >
        <div
          class="cpk:prose cpk:dark:prose-invert cpk:bg-muted cpk:relative cpk:max-w-[80%] cpk:rounded-[18px] cpk:px-4 cpk:py-1.5 cpk:inline-block cpk:whitespace-pre-wrap"
          :data-multiline="isMultiline ? 'true' : undefined"
          :class="{ 'cpk:py-3': isMultiline }"
        >
          {{ flattenedContent }}
        </div>
      </slot>

      <slot
        name="toolbar"
        :message="message"
        :show-branch-navigation="showBranchNavigation"
        :has-edit-action="hasEditAction"
      >
        <div
          class="cpk:w-full cpk:bg-transparent cpk:flex cpk:items-center cpk:justify-end cpk:-mr-[5px] cpk:mt-[4px] cpk:invisible cpk:group-hover:visible"
        >
          <div class="cpk:flex cpk:items-center cpk:gap-1 cpk:justify-end">
            <slot name="toolbar-items" />

            <slot
              name="copy-button"
              :on-copy="handleCopyMessage"
              :copied="copied"
              :label="labels.userMessageToolbarCopyMessageLabel"
            >
              <button
                data-testid="copilot-user-copy-button"
                type="button"
                :class="toolbarButtonClass"
                :aria-label="labels.userMessageToolbarCopyMessageLabel"
                :title="labels.userMessageToolbarCopyMessageLabel"
                @click="handleCopyMessage"
              >
                <IconCheck v-if="copied" class="cpk:size-[18px]" />
                <IconCopy v-else class="cpk:size-[18px]" />
              </button>
            </slot>

            <slot
              v-if="hasEditAction"
              name="edit-button"
              :on-edit="handleEditMessage"
              :label="labels.userMessageToolbarEditMessageLabel"
            >
              <button
                type="button"
                :class="toolbarButtonClass"
                :aria-label="labels.userMessageToolbarEditMessageLabel"
                :title="labels.userMessageToolbarEditMessageLabel"
                @click="handleEditMessage"
              >
                <IconEdit class="cpk:size-[18px]" />
              </button>
            </slot>

            <slot
              v-if="showBranchNavigation"
              name="branch-navigation"
              :branch-index="branchIndex"
              :number-of-branches="numberOfBranches"
              :can-go-prev="canGoPrev"
              :can-go-next="canGoNext"
              :go-prev="goPrev"
              :go-next="goNext"
            >
              <div class="cpk:flex cpk:items-center cpk:gap-1">
                <button
                  type="button"
                  :class="toolbarButtonClass"
                  class="cpk:h-6 cpk:w-6 cpk:p-0"
                  :disabled="!canGoPrev"
                  aria-label="Previous branch"
                  title="Previous branch"
                  @click="goPrev"
                >
                  <IconChevronLeft class="cpk:size-[20px]" />
                </button>
                <span
                  class="cpk:text-sm cpk:text-muted-foreground cpk:px-0 cpk:font-medium"
                >
                  {{ branchIndex + 1 }}/{{ numberOfBranches }}
                </span>
                <button
                  type="button"
                  :class="toolbarButtonClass"
                  class="cpk:h-6 cpk:w-6 cpk:p-0"
                  :disabled="!canGoNext"
                  aria-label="Next branch"
                  title="Next branch"
                  @click="goNext"
                >
                  <IconChevronRight class="cpk:size-[20px]" />
                </button>
              </div>
            </slot>
          </div>
        </div>
      </slot>
    </div>
  </slot>
</template>
