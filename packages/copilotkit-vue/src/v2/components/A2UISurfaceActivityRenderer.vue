<script setup lang="ts">
import {
  computed,
  h,
  onBeforeUnmount,
  shallowRef,
  ref,
  watch,
  type VNode,
} from "vue";
import type { ActivityMessage } from "@ag-ui/core";
import type { A2UITheme } from "../types";
import type { A2UIOperation } from "./a2ui";
import { getOperationSurfaceId } from "./a2ui";
import { useCopilotKit } from "../providers";
import { MessageProcessor, type SurfaceModel } from "@a2ui/web_core/v0_9";
import {
  vueBasicCatalog,
  A2uiSurface,
  type VueComponentImplementation,
} from "./a2ui/index";

const DEFAULT_SURFACE_ID = "default";

const props = defineProps<{
  activityType: string;
  content: { operations: A2UIOperation[] };
  message: ActivityMessage;
  agent?: object;
  theme?: A2UITheme;
  catalog?: any;
}>();

const { copilotkit } = useCopilotKit();

// MessageProcessor from @a2ui/web_core — framework-agnostic
// Use shallowRef to avoid Vue's deep UnwrapRef which strips private class members
const processorRef =
  shallowRef<MessageProcessor<VueComponentImplementation> | null>(null);
// Version counter to trigger Vue reactivity on processor state changes
const version = ref(0);
// Error state
const error = ref<string | null>(null);
// Track last processed operations hash to avoid re-processing
let lastOpsHash = "";

function getOrCreateProcessor(): MessageProcessor<VueComponentImplementation> {
  if (!processorRef.value) {
    const catalog = props.catalog ?? vueBasicCatalog;
    processorRef.value = new MessageProcessor<VueComponentImplementation>(
      [catalog],
      (action: unknown) => {
        handleAction(action);
      },
    );
  }
  return processorRef.value;
}

async function handleAction(message: unknown) {
  if (!props.agent) return;
  try {
    copilotkit.value.setProperties({
      ...(copilotkit.value.properties ?? {}),
      a2uiAction: message,
    });
    await copilotkit.value.runAgent({ agent: props.agent as any });
  } finally {
    const { a2uiAction, ...rest } = copilotkit.value.properties ?? {};
    copilotkit.value.setProperties(rest);
  }
}

function processOperations(operations: A2UIOperation[]) {
  if (!operations?.length) return;

  const hash = JSON.stringify(operations);
  if (hash === lastOpsHash) return;
  lastOpsHash = hash;

  const processor = getOrCreateProcessor();
  try {
    // Group operations by surface ID
    const grouped = new Map<string, A2UIOperation[]>();
    for (const op of operations) {
      const surfaceId = getOperationSurfaceId(op) ?? DEFAULT_SURFACE_ID;
      if (!grouped.has(surfaceId)) grouped.set(surfaceId, []);
      grouped.get(surfaceId)!.push(op);
    }

    // For each surface, skip createSurface if the surface already exists
    for (const [surfaceId, ops] of grouped) {
      const existing = processor.model.getSurface(surfaceId);
      const filtered = existing
        ? ops.filter((op) => !(op as any)?.createSurface)
        : ops;
      // dataagent fork fix (2026-08-16, P10 生命周期): 逐 op 容错处理 ——
      // 缺失 target（未创建/已关闭的 surface）、重复 createSurface 等单条
      // 坏 op 只跳过 + console.warn，不再整批进错误框（此前一条坏 op
      // 会 throw 中断整批，同批正常 surface 也渲染不出来）。
      for (const op of filtered) {
        try {
          processor.processMessages([op] as any);
        } catch (opErr) {
          console.warn(
            `[A2UI Vue] op skipped (surface=${surfaceId}):`,
            opErr instanceof Error ? opErr.message : opErr,
          );
        }
      }
    }
    error.value = null;
  } catch (err) {
    console.warn("[A2UI Vue] processMessages error:", err);
    error.value = err instanceof Error ? err.message : String(err);
  }
  version.value++;
}

// Process operations on mount and when they change
watch(
  () => [props.content.operations, props.theme, props.catalog, props.agent],
  () => {
    processOperations(props.content.operations);
  },
  { deep: true, immediate: true },
);

onBeforeUnmount(() => {
  processorRef.value = null;
  lastOpsHash = "";
});

const hasOperations = computed(
  () => (props.content.operations ?? []).length > 0,
);

// Compute the list of surfaces to render
const surfaceEntries = computed(() => {
  // Touch version to ensure reactivity
  void version.value;

  if (!processorRef.value) return [];

  const entries: Array<{
    surfaceId: string;
    surface: SurfaceModel<VueComponentImplementation>;
  }> = [];

  // Group operations by surface to know which surfaces we expect
  const grouped = new Map<string, A2UIOperation[]>();
  for (const op of props.content.operations ?? []) {
    const surfaceId = getOperationSurfaceId(op) ?? DEFAULT_SURFACE_ID;
    if (!grouped.has(surfaceId)) grouped.set(surfaceId, []);
    grouped.get(surfaceId)!.push(op);
  }

  for (const [surfaceId] of grouped) {
    const surface = processorRef.value.model.getSurface(surfaceId);
    if (surface) {
      entries.push({ surfaceId, surface });
    }
  }

  return entries;
});
</script>

<template>
  <div
    v-if="hasOperations"
    data-copilotkit
    :data-activity-type="activityType"
    :data-message-id="message.id"
  >
    <div
      v-if="error"
      class="cpk:rounded-lg cpk:border cpk:border-red-200 cpk:bg-red-50 cpk:p-3 cpk:text-sm cpk:text-red-700"
    >
      A2UI render error: {{ error }}
    </div>
    <div
      v-else
      class="cpk:flex cpk:min-h-0 cpk:flex-1 cpk:flex-col cpk:gap-6 cpk:overflow-auto cpk:py-6"
      data-testid="a2ui-activity-renderer"
    >
      <div
        v-for="entry in surfaceEntries"
        :key="entry.surfaceId"
        class="cpk:flex cpk:w-full cpk:flex-none cpk:flex-col cpk:gap-4"
        :data-surface-id="entry.surfaceId"
      >
        <div class="a2ui-surface cpk:flex cpk:flex-1">
          <A2uiSurface :surface="entry.surface" />
        </div>
      </div>
    </div>
  </div>
</template>
