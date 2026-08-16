/**
 * Vue-native A2UI Surface renderer.
 *
 * Replaces the React island pattern with Vue components that use
 * @a2ui/web_core's framework-agnostic primitives directly.
 */

import {
  defineComponent,
  h,
  ref,
  inject,
  provide,
  onUnmounted,
  type PropType,
  type VNode,
  type InjectionKey,
} from "vue";
import {
  ComponentContext,
  type SurfaceModel,
  type ComponentModel,
} from "@a2ui/web_core/v0_9";
import type { VueComponentImplementation } from "./adapter";
import { getWarningChipStyle, ensureA2uiCatalogStyles } from "./utils";

// Idempotent: ensures shimmer keyframes exist even when A2uiSurface is used
// with a custom catalog that never imports the basic catalog module.
ensureA2uiCatalogStyles();

/**
 * DeferredChild — Vue equivalent of the React DeferredChild.
 * Subscribes to component create/delete events and renders the
 * appropriate catalog component via the GenericBinder adapter.
 */
/**
 * Ancestor id chain for cycle detection (dataagent fork fix, 2026-08-15):
 * a children cycle (A↔B) previously recursed DeferredChild until
 * "Maximum call stack size exceeded" and killed the whole surface.
 */
const ANCESTORS_KEY: InjectionKey<ReadonlySet<string>> = Symbol("a2ui-ancestors");

const DeferredChild = defineComponent({
  name: "A2UIDeferredChild",
  props: {
    surface: {
      type: Object as PropType<SurfaceModel<VueComponentImplementation>>,
      required: true,
    },
    id: { type: String, required: true },
    basePath: { type: String, required: true },
  },
  setup(props) {
    // Cycle guard: if this id already appears in the ancestor chain, stop
    // recursing and render a visible placeholder instead of overflowing.
    const ancestors = inject(ANCESTORS_KEY, new Set<string>());
    const isCycle = ancestors.has(props.id);
    if (isCycle) {
      console.warn(
        `[A2UI Vue] Cycle detected: component "${props.id}" references itself via children chain`,
      );
    }
    provide(ANCESTORS_KEY, new Set([...ancestors, props.id]));

    // Reactive trigger — incremented when the component is created/deleted
    const version = ref(0);

    const sub1 = props.surface.componentsModel.onCreated.subscribe(
      (comp: ComponentModel) => {
        if (comp.id === props.id) {
          version.value++;
        }
      },
    );
    const sub2 = props.surface.componentsModel.onDeleted.subscribe(
      (delId: string) => {
        if (delId === props.id) {
          version.value++;
        }
      },
    );

    onUnmounted(() => {
      sub1.unsubscribe();
      sub2.unsubscribe();
    });

    function buildChild(childId: string, specificPath?: string): VNode {
      const path = specificPath || props.basePath;
      return h(DeferredChild, {
        key: `${childId}-${path}`,
        surface: props.surface,
        id: childId,
        basePath: path,
      });
    }

    return () => {
      // Touch version to ensure reactivity
      void version.value;

      if (isCycle) {
        return h(
          "div",
          { style: getWarningChipStyle() },
          `Cycle detected: ${props.id}`,
        );
      }

      const componentModel = props.surface.componentsModel.get(props.id);

      if (!componentModel) {
        // Shimmer placeholder while component isn't yet available.
        // Keyframes live in the shared static stylesheet (no innerHTML).
        return h("div", {
          class: "a2ui-shimmer",
          style: {
            padding: "12px 16px",
            borderRadius: "8px",
            background:
              "linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%)",
            backgroundSize: "200% 100%",
            minHeight: "2rem",
          },
        });
      }

      const compImpl = props.surface.catalog.components.get(
        componentModel.type,
      );

      if (!compImpl) {
        // 降级渲染占位（不白屏不抛错）+ console.warn 留痕（2026-08-15 vision-P4）
        // 视觉打磨（2026-08-16）：警示 chip 与 cycle 占位同族，替代裸红字。
        console.warn(
          `[A2UI Vue] Unknown component: ${componentModel.type} (id=${props.id}) — rendering placeholder`,
        );
        return h(
          "div",
          { style: getWarningChipStyle() },
          `Unknown component: ${componentModel.type}`,
        );
      }

      // Create context for this component
      const context = new ComponentContext(
        props.surface,
        props.id,
        props.basePath,
      );

      // Render the catalog component's Vue wrapper (created by createVueComponent)
      return h(compImpl.render, {
        context,
        buildChild,
      });
    };
  },
});

/**
 * A2uiSurface — renders the root of a single A2UI surface.
 * The root component always has ID 'root' and base path '/'.
 */
export const A2uiSurface = defineComponent({
  name: "A2uiSurface",
  props: {
    surface: {
      type: Object as PropType<SurfaceModel<VueComponentImplementation>>,
      required: true,
    },
  },
  setup(props) {
    return () =>
      h(DeferredChild, {
        surface: props.surface,
        id: "root",
        basePath: "/",
      });
  },
});

export { DeferredChild };
