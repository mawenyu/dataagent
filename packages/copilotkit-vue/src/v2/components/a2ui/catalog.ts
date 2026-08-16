/**
 * Vue basic catalog for A2UI v0.9.
 *
 * Provides Vue component implementations for all 18 basic catalog components,
 * mirroring the React renderer's catalog/basic/.
 */

import { h, ref, watch, onUnmounted, type CSSProperties, type VNode } from "vue";
import { Catalog } from "@a2ui/web_core/v0_9";
import {
  TextApi,
  ImageApi,
  IconApi,
  VideoApi,
  AudioPlayerApi,
  RowApi,
  ColumnApi,
  ListApi,
  CardApi,
  TabsApi,
  DividerApi,
  ModalApi,
  ButtonApi,
  TextFieldApi,
  CheckBoxApi,
  ChoicePickerApi,
  SliderApi,
  DateTimeInputApi,
  BASIC_FUNCTIONS,
} from "@a2ui/web_core/v0_9/basic_catalog";

import { createVueComponent, type VueComponentImplementation } from "./adapter";
import {
  LEAF_MARGIN,
  A2UI_PALETTE,
  A2UI_PRIMARY,
  A2UI_PRIMARY_HOVER,
  A2UI_PRIMARY_SOFT,
  getA2uiInputStyle,
  getA2uiLabelStyle,
  getA2uiErrorTextStyle,
  getBaseLeafStyle,
  getBaseContainerStyle,
  ensureA2uiCatalogStyles,
  mapJustify,
  mapAlign,
} from "./utils";

// Static keyframes for modal/dialog transitions (fixed content, injected once).
ensureA2uiCatalogStyles();

// -- Helper: render a child list (arrays of { id, basePath } or string IDs) --
function renderChildList(
  childList: unknown,
  buildChild: (id: string, basePath?: string) => VNode,
): VNode[] {
  if (!Array.isArray(childList)) return [];
  return childList
    .map((item: unknown) => {
      if (item && typeof item === "object" && "id" in item) {
        const node = item as { id: string; basePath?: string };
        return buildChild(node.id, node.basePath);
      }
      if (typeof item === "string") {
        return buildChild(item);
      }
      return null;
    })
    .filter((v): v is VNode => v !== null);
}

// -- Unique ID counter for form elements --
let a2uiIdCounter = 0;
function useA2UIUniqueId(): string {
  return `a2ui-vue-${++a2uiIdCounter}`;
}

// ============================================================
// Component Implementations
// ============================================================

const Text = createVueComponent(TextApi, ({ props }) => {
  const text = props.text ?? "";
  // Typographic scale (polish 2026-08-16): explicit size/weight/line-height
  // per variant — no reliance on browser default heading styles.
  const base = { ...getBaseLeafStyle(), display: "inline-block" } as const;
  const heading = (
    fontSize: string,
    fontWeight: string,
    lineHeight: string,
  ): CSSProperties => ({
    ...base,
    fontSize,
    fontWeight,
    lineHeight,
    color: A2UI_PALETTE.text,
  });

  switch (props.variant) {
    case "h1":
      return h("h1", { style: heading("24px", "700", "1.3") }, text);
    case "h2":
      return h("h2", { style: heading("20px", "600", "1.35") }, text);
    case "h3":
      return h("h3", { style: heading("18px", "600", "1.4") }, text);
    case "h4":
      return h("h4", { style: heading("16px", "600", "1.4") }, text);
    case "h5":
      return h("h5", { style: heading("14px", "600", "1.5") }, text);
    case "caption":
      return h(
        "small",
        {
          style: {
            ...base,
            fontSize: "12px",
            lineHeight: "1.5",
            color: A2UI_PALETTE.textMuted,
            textAlign: "left",
          },
        },
        text,
      );
    case "body":
    default:
      return h(
        "span",
        {
          style: {
            ...base,
            fontSize: "14px",
            lineHeight: "1.6",
            color: A2UI_PALETTE.textSecondary,
          },
        },
        text,
      );
  }
});

const Image = createVueComponent(
  ImageApi,
  ({ props, state }) => {
    const mapFit = (fit?: string): string => {
      if (fit === "scaleDown") return "scale-down";
      return fit || "fill";
    };

    // Missing URL or failed load → calm placeholder instead of a broken icon.
    if (!props.url || state.errored.value) {
      return h(
        "div",
        {
          style: {
            ...getBaseLeafStyle(),
            padding: "16px",
            border: `1px dashed ${A2UI_PALETTE.borderStrong}`,
            borderRadius: "8px",
            backgroundColor: A2UI_PALETTE.surfaceSunken,
            color: A2UI_PALETTE.textMuted,
            fontSize: "12px",
            lineHeight: "1.4",
          },
        },
        props.description ? props.description : "Image unavailable",
      );
    }

    const style: CSSProperties = {
      ...getBaseLeafStyle(),
      objectFit: mapFit(props.fit) as CSSProperties["objectFit"],
      width: "100%",
      height: "auto",
      display: "block",
      // Sunken backdrop while the image streams in.
      backgroundColor: "#f3f4f6",
    };

    if (props.variant === "icon") {
      style.width = "24px";
      style.height = "24px";
      style.backgroundColor = "transparent";
    } else if (props.variant === "avatar") {
      style.width = "40px";
      style.height = "40px";
      style.borderRadius = "50%";
    } else if (props.variant === "smallFeature") {
      style.maxWidth = "100px";
      style.borderRadius = "8px";
    } else if (props.variant === "mediumFeature") {
      style.borderRadius = "8px";
    } else if (props.variant === "largeFeature") {
      style.maxHeight = "400px";
      style.borderRadius = "8px";
    } else if (props.variant === "header") {
      style.height = "200px";
      style.objectFit = "cover";
      style.borderRadius = "8px";
    }

    return h("img", {
      src: props.url,
      alt: props.description || "",
      style,
      onError: () => {
        state.errored.value = true;
      },
    });
  },
  () => ({ errored: ref(false) }),
);

const Icon = createVueComponent(IconApi, ({ props }) => {
  const iconName =
    typeof props.name === "string"
      ? props.name
      : (props.name as { path?: string })?.path;
  const style = {
    ...getBaseLeafStyle(),
    fontSize: "24px",
    width: "24px",
    height: "24px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };

  return h("span", { class: "material-symbols-outlined", style }, iconName);
});

const Video = createVueComponent(VideoApi, ({ props }) => {
  const style = {
    ...getBaseLeafStyle(),
    width: "100%",
    aspectRatio: "16/9",
    borderRadius: "8px",
    backgroundColor: "#111827",
  };

  return h("video", { src: props.url, controls: true, style });
});

const AudioPlayer = createVueComponent(AudioPlayerApi, ({ props }) => {
  const style = { ...getBaseLeafStyle(), width: "100%" };

  return h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        width: "100%",
      },
    },
    [
      props.description
        ? h(
            "span",
            { style: { fontSize: "12px", color: A2UI_PALETTE.textMuted } },
            props.description,
          )
        : null,
      h("audio", { src: props.url, controls: true, style }),
    ],
  );
});

const Row = createVueComponent(RowApi, ({ props, buildChild }) => {
  return h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "row",
        justifyContent: mapJustify(props.justify),
        alignItems: mapAlign(props.align),
        width: "100%",
        margin: "0",
        padding: "0",
      },
    },
    renderChildList(props.children, buildChild),
  );
});

const Column = createVueComponent(ColumnApi, ({ props, buildChild }) => {
  return h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        justifyContent: mapJustify(props.justify),
        alignItems: mapAlign(props.align),
        width: "100%",
        margin: "0",
        padding: "0",
      },
    },
    renderChildList(props.children, buildChild),
  );
});

const List = createVueComponent(ListApi, ({ props, buildChild }) => {
  const isHorizontal = props.direction === "horizontal";
  const style = {
    display: "flex",
    flexDirection: isHorizontal ? ("row" as const) : ("column" as const),
    alignItems: mapAlign(props.align),
    overflowX: isHorizontal ? ("auto" as const) : ("hidden" as const),
    overflowY: isHorizontal ? ("hidden" as const) : ("auto" as const),
    width: "100%",
    margin: "0",
    padding: "0",
  };

  return h("div", { style }, renderChildList(props.children, buildChild));
});

const Card = createVueComponent(
  CardApi,
  ({ props, buildChild, state }) => {
    // Elevated surface: subtle resting shadow, gentle lift on hover.
    const style = {
      ...getBaseContainerStyle(),
      backgroundColor: A2UI_PALETTE.surface,
      border: `1px solid ${A2UI_PALETTE.border}`,
      borderRadius: "12px",
      boxShadow: state.hovered.value
        ? "0 4px 12px rgba(16, 24, 40, 0.08)"
        : "0 1px 2px rgba(16, 24, 40, 0.05)",
      transition: "box-shadow 0.2s ease",
      width: "100%",
    };

    return h(
      "div",
      {
        style,
        onMouseenter: () => {
          state.hovered.value = true;
        },
        onMouseleave: () => {
          state.hovered.value = false;
        },
      },
      [props.child ? buildChild(props.child) : null],
    );
  },
  () => ({ hovered: ref(false) }),
);

const Tabs = createVueComponent(
  TabsApi,
  ({ props, buildChild, state }) => {
    const tabs = props.tabs || [];

    // Empty state (can occur mid-stream before tabs arrive).
    if (tabs.length === 0) {
      return h(
        "div",
        {
          style: {
            margin: LEAF_MARGIN,
            padding: "12px 16px",
            fontSize: "13px",
            color: A2UI_PALETTE.textMuted,
            backgroundColor: A2UI_PALETTE.surfaceSunken,
            borderRadius: "8px",
          },
        },
        "No tabs",
      );
    }

    // Clamp the selection in case the tab list shrank after selection.
    const selected = Math.min(state.selectedIndex.value, tabs.length - 1);

    return h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          width: "100%",
          margin: LEAF_MARGIN,
        },
      },
      [
        h(
          "div",
          {
            role: "tablist",
            style: {
              display: "flex",
              gap: "4px",
              borderBottom: `1px solid ${A2UI_PALETTE.border}`,
              marginBottom: "12px",
            },
          },
          tabs.map((tab, i: number) => {
            const title =
              typeof tab.title === "string"
                ? tab.title
                : String(tab.title ?? "");
            const isSelected = selected === i;
            const isHovered = state.hoveredIndex.value === i && !isSelected;
            return h(
              "button",
              {
                key: i,
                role: "tab",
                "aria-selected": isSelected ? "true" : "false",
                onClick: () => {
                  state.selectedIndex.value = i;
                },
                onMouseenter: () => {
                  state.hoveredIndex.value = i;
                },
                onMouseleave: () => {
                  state.hoveredIndex.value = null;
                },
                style: {
                  padding: "8px 12px",
                  border: "none",
                  background: "none",
                  marginBottom: "-1px",
                  borderBottom: isSelected
                    ? `2px solid ${A2UI_PRIMARY}`
                    : "2px solid transparent",
                  fontSize: "14px",
                  fontWeight: isSelected ? "600" : "500",
                  cursor: "pointer",
                  color: isSelected
                    ? A2UI_PRIMARY
                    : isHovered
                      ? A2UI_PALETTE.text
                      : A2UI_PALETTE.textMuted,
                  transition: "color 0.15s ease, border-color 0.15s ease",
                },
              },
              title,
            );
          }),
        ),
        h("div", { style: { flex: "1" } }, [
          tabs[selected]?.child ? buildChild(tabs[selected]!.child) : null,
        ]),
      ],
    );
  },
  () => ({
    selectedIndex: ref(0),
    hoveredIndex: ref<number | null>(null),
  }),
);

const Divider = createVueComponent(DividerApi, ({ props }) => {
  const isVertical = props.axis === "vertical";
  const style: Record<string, string> = {
    margin: LEAF_MARGIN,
    border: "none",
    backgroundColor: A2UI_PALETTE.border,
  };

  if (isVertical) {
    style.width = "1px";
    style.height = "100%";
  } else {
    style.width = "100%";
    style.height = "1px";
  }

  return h("div", { style });
});

const Modal = createVueComponent(
  ModalApi,
  ({ props, buildChild, state }) => {
    return h("div", {}, [
      h(
        "div",
        {
          onClick: () => {
            state.isOpen.value = true;
          },
          style: { display: "inline-block", cursor: "pointer" },
        },
        [props.trigger ? buildChild(props.trigger) : null],
      ),
      state.isOpen.value
        ? h(
            "div",
            {
              class: "a2ui-modal-backdrop",
              style: {
                position: "fixed",
                top: "0",
                left: "0",
                right: "0",
                bottom: "0",
                backgroundColor: "rgba(15, 23, 42, 0.5)",
                backdropFilter: "blur(2px)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: "1000",
              },
              onClick: () => {
                state.isOpen.value = false;
              },
            },
            [
              h(
                "div",
                {
                  class: "a2ui-modal-panel",
                  role: "dialog",
                  "aria-modal": "true",
                  style: {
                    backgroundColor: A2UI_PALETTE.surface,
                    padding: "24px",
                    borderRadius: "12px",
                    boxShadow:
                      "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
                    maxWidth: "90%",
                    maxHeight: "90%",
                    overflow: "auto",
                    display: "flex",
                    flexDirection: "column",
                  },
                  onClick: (e: Event) => e.stopPropagation(),
                },
                [
                  h(
                    "div",
                    { style: { display: "flex", justifyContent: "flex-end" } },
                    [
                      h(
                        "button",
                        {
                          "aria-label": "Close",
                          onClick: () => {
                            state.isOpen.value = false;
                          },
                          onMouseenter: () => {
                            state.closeHovered.value = true;
                          },
                          onMouseleave: () => {
                            state.closeHovered.value = false;
                          },
                          style: {
                            border: "none",
                            backgroundColor: state.closeHovered.value
                              ? "#f3f4f6"
                              : "transparent",
                            borderRadius: "6px",
                            color: A2UI_PALETTE.textMuted,
                            fontSize: "18px",
                            lineHeight: "1",
                            cursor: "pointer",
                            padding: "6px 8px",
                            transition: "background-color 0.15s ease",
                          },
                        },
                        "\u00D7",
                      ),
                    ],
                  ),
                  h("div", { style: { flex: "1" } }, [
                    props.content ? buildChild(props.content) : null,
                  ]),
                ],
              ),
            ],
          )
        : null,
    ]);
  },
  () => {
    const isOpen = ref(false);
    const closeHovered = ref(false);
    // ESC closes the dialog; listener only attached while open.
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") isOpen.value = false;
    };
    watch(isOpen, (open) => {
      if (typeof document === "undefined") return;
      if (open) {
        document.addEventListener("keydown", onKeydown);
      } else {
        document.removeEventListener("keydown", onKeydown);
      }
    });
    onUnmounted(() => {
      if (typeof document !== "undefined") {
        document.removeEventListener("keydown", onKeydown);
      }
    });
    return { isOpen, closeHovered };
  },
);

const Button = createVueComponent(
  ButtonApi,
  ({ props, buildChild, state }) => {
    // Variant tokens + full interaction states (hover/pressed/disabled).
    const disabled = props.isValid === false;
    const hovered = state.hovered.value && !disabled;
    const pressed = state.pressed.value && !disabled;

    const palette = (() => {
      if (props.variant === "primary") {
        return {
          backgroundColor: pressed
            ? A2UI_PRIMARY_HOVER
            : hovered
              ? A2UI_PRIMARY_HOVER
              : A2UI_PRIMARY,
          border: "none",
          color: "#ffffff",
        };
      }
      if (props.variant === "borderless") {
        return {
          backgroundColor:
            hovered || pressed ? "rgba(17, 24, 39, 0.04)" : "transparent",
          border: "none",
          color: A2UI_PALETTE.textSecondary,
        };
      }
      return {
        backgroundColor:
          pressed || hovered
            ? A2UI_PALETTE.surfaceSunken
            : A2UI_PALETTE.surface,
        border: `1px solid ${A2UI_PALETTE.borderStrong}`,
        color: A2UI_PALETTE.textSecondary,
      };
    })();

    const style = {
      margin: LEAF_MARGIN,
      padding: "8px 16px",
      cursor: disabled ? "not-allowed" : "pointer",
      ...palette,
      borderRadius: "8px",
      fontSize: "14px",
      fontWeight: "500",
      lineHeight: "1.25",
      opacity: disabled ? "0.5" : "1",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      boxSizing: "border-box",
      transition:
        "background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease",
    };

    return h(
      "button",
      {
        style,
        onClick: props.action,
        disabled,
        onMouseenter: () => {
          state.hovered.value = true;
        },
        onMouseleave: () => {
          state.hovered.value = false;
          state.pressed.value = false;
        },
        onMousedown: () => {
          state.pressed.value = true;
        },
        onMouseup: () => {
          state.pressed.value = false;
        },
      },
      [props.child ? buildChild(props.child) : null],
    );
  },
  () => ({ hovered: ref(false), pressed: ref(false) }),
);

const TextField = createVueComponent(
  TextFieldApi,
  ({ props, state }) => {
    const uniqueId = state.id;
    const isLong = props.variant === "longText";
    const type =
      props.variant === "number"
        ? "number"
        : props.variant === "obscured"
          ? "password"
          : "text";

    const hasError =
      props.validationErrors && props.validationErrors.length > 0;
    const inputStyle = getA2uiInputStyle({
      hasError,
      focused: state.focused.value,
    });
    if (isLong) {
      inputStyle.minHeight = "72px";
      inputStyle.resize = "vertical";
    }

    const focusHandlers = {
      onFocus: () => {
        state.focused.value = true;
      },
      onBlur: () => {
        state.focused.value = false;
      },
    };

    return h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: "6px",
          width: "100%",
          margin: LEAF_MARGIN,
        },
      },
      [
        props.label
          ? h(
              "label",
              { for: uniqueId, style: getA2uiLabelStyle() },
              props.label,
            )
          : null,
        isLong
          ? h("textarea", {
              id: uniqueId,
              style: inputStyle,
              value: props.value || "",
              onInput: (e: Event) =>
                props.setValue((e.target as HTMLTextAreaElement).value),
              ...focusHandlers,
            })
          : h("input", {
              id: uniqueId,
              type,
              style: inputStyle,
              value: props.value || "",
              onInput: (e: Event) =>
                props.setValue((e.target as HTMLInputElement).value),
              ...focusHandlers,
            }),
        hasError
          ? h("span", { style: getA2uiErrorTextStyle() }, props.validationErrors![0])
          : null,
      ],
    );
  },
  () => ({ id: useA2UIUniqueId(), focused: ref(false) }),
);

const CheckBox = createVueComponent(
  CheckBoxApi,
  ({ props, state }) => {
    const uniqueId = state.id;
    const hasError =
      props.validationErrors && props.validationErrors.length > 0;

    return h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          margin: LEAF_MARGIN,
        },
      },
      [
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "8px" } },
          [
            h("input", {
              id: uniqueId,
              type: "checkbox",
              checked: !!props.value,
              onChange: (e: Event) =>
                props.setValue((e.target as HTMLInputElement).checked),
              style: {
                cursor: "pointer",
                width: "16px",
                height: "16px",
                accentColor: A2UI_PRIMARY,
                outline: hasError
                  ? `1px solid ${A2UI_PALETTE.danger}`
                  : "none",
              },
            }),
            props.label
              ? h(
                  "label",
                  {
                    for: uniqueId,
                    style: {
                      cursor: "pointer",
                      fontSize: "14px",
                      color: hasError
                        ? A2UI_PALETTE.danger
                        : A2UI_PALETTE.textSecondary,
                    },
                  },
                  props.label,
                )
              : null,
          ],
        ),
        hasError
          ? h(
              "span",
              { style: { ...getA2uiErrorTextStyle(), marginTop: "4px" } },
              props.validationErrors?.[0],
            )
          : null,
      ],
    );
  },
  () => ({ id: useA2UIUniqueId() }),
);

const ChoicePicker = createVueComponent(
  ChoicePickerApi,
  ({ props, context, state }) => {
    const values = Array.isArray(props.value) ? props.value : [];
    const isMutuallyExclusive = props.variant === "mutuallyExclusive";

    const onToggle = (val: string) => {
      if (isMutuallyExclusive) {
        props.setValue([val]);
      } else {
        const newValues = values.includes(val)
          ? values.filter((v: string) => v !== val)
          : [...values, val];
        props.setValue(newValues);
      }
    };

    type ChoiceOption = {
      label?: string | Record<string, unknown>;
      value: string;
    };
    const options = (props.options || []).filter(
      (opt: ChoiceOption) =>
        !props.filterable ||
        state.filter.value === "" ||
        String(typeof opt.label === "string" ? opt.label : "")
          .toLowerCase()
          .includes(state.filter.value.toLowerCase()),
    );

    return h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          margin: LEAF_MARGIN,
          width: "100%",
        },
      },
      [
        props.label
          ? h("span", { style: getA2uiLabelStyle() }, props.label)
          : null,
        props.filterable
          ? h("input", {
              type: "text",
              placeholder: "Filter options...",
              value: state.filter.value,
              onInput: (e: Event) => {
                state.filter.value = (e.target as HTMLInputElement).value;
              },
              onFocus: () => {
                state.filterFocused.value = true;
              },
              onBlur: () => {
                state.filterFocused.value = false;
              },
              style: getA2uiInputStyle({ focused: state.filterFocused.value }),
            })
          : null,
        h(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: props.displayStyle === "chips" ? "row" : "column",
              flexWrap: props.displayStyle === "chips" ? "wrap" : "nowrap",
              gap: "8px",
            },
          },
          options.map((opt: ChoiceOption, i: number) => {
            const isSelected = values.includes(opt.value);
            const isHovered = state.hovered.value === opt.value;
            const label =
              typeof opt.label === "string"
                ? opt.label
                : String(opt.label ?? opt.value);
            if (props.displayStyle === "chips") {
              return h(
                "button",
                {
                  key: i,
                  onClick: () => onToggle(opt.value),
                  onMouseenter: () => {
                    state.hovered.value = opt.value;
                  },
                  onMouseleave: () => {
                    state.hovered.value = null;
                  },
                  style: {
                    padding: "6px 14px",
                    borderRadius: "9999px",
                    border: isSelected
                      ? `1px solid ${A2UI_PRIMARY}`
                      : isHovered
                        ? `1px solid ${A2UI_PRIMARY}`
                        : `1px solid ${A2UI_PALETTE.borderStrong}`,
                    backgroundColor: isSelected
                      ? A2UI_PRIMARY
                      : isHovered
                        ? A2UI_PRIMARY_SOFT
                        : A2UI_PALETTE.surface,
                    color: isSelected ? "#fff" : A2UI_PALETTE.textSecondary,
                    cursor: "pointer",
                    fontSize: "13px",
                    fontWeight: "500",
                    lineHeight: "1.3",
                    transition:
                      "background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease",
                  },
                },
                label,
              );
            }
            return h(
              "label",
              {
                key: i,
                onMouseenter: () => {
                  state.hovered.value = opt.value;
                },
                onMouseleave: () => {
                  state.hovered.value = null;
                },
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  cursor: "pointer",
                  padding: "6px 8px",
                  borderRadius: "6px",
                  backgroundColor: isHovered
                    ? A2UI_PALETTE.surfaceSunken
                    : "transparent",
                  transition: "background-color 0.15s ease",
                },
              },
              [
                h("input", {
                  type: isMutuallyExclusive ? "radio" : "checkbox",
                  checked: isSelected,
                  onChange: () => onToggle(opt.value),
                  name: isMutuallyExclusive
                    ? `choice-${context.componentModel.id}`
                    : undefined,
                  style: {
                    cursor: "pointer",
                    width: "16px",
                    height: "16px",
                    accentColor: A2UI_PRIMARY,
                  },
                }),
                h(
                  "span",
                  {
                    style: {
                      fontSize: "14px",
                      color: A2UI_PALETTE.textSecondary,
                    },
                  },
                  label,
                ),
              ],
            );
          }),
        ),
      ],
    );
  },
  () => ({
    filter: ref(""),
    filterFocused: ref(false),
    hovered: ref<string | null>(null),
  }),
);

const Slider = createVueComponent(
  SliderApi,
  ({ props, state }) => {
    const uniqueId = state.id;

    return h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: "6px",
          margin: LEAF_MARGIN,
          width: "100%",
        },
      },
      [
        h(
          "div",
          {
            style: {
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            },
          },
          [
            props.label
              ? h(
                  "label",
                  { for: uniqueId, style: getA2uiLabelStyle() },
                  props.label,
                )
              : null,
            // Current value rendered as a primary chip (not bare gray text).
            h(
              "span",
              {
                style: {
                  fontSize: "12px",
                  fontWeight: "600",
                  fontVariantNumeric: "tabular-nums",
                  color: A2UI_PRIMARY,
                  backgroundColor: A2UI_PRIMARY_SOFT,
                  borderRadius: "6px",
                  padding: "2px 8px",
                },
              },
              String(props.value),
            ),
          ],
        ),
        h("input", {
          id: uniqueId,
          type: "range",
          min: props.min ?? 0,
          max: props.max,
          value: props.value ?? 0,
          onInput: (e: Event) =>
            props.setValue(Number((e.target as HTMLInputElement).value)),
          style: {
            width: "100%",
            cursor: "pointer",
            accentColor: A2UI_PRIMARY,
          },
        }),
      ],
    );
  },
  () => ({ id: useA2UIUniqueId() }),
);

const DateTimeInput = createVueComponent(
  DateTimeInputApi,
  ({ props, state }) => {
    const uniqueId = state.id;

    let type = "datetime-local";
    if (props.enableDate && !props.enableTime) type = "date";
    if (!props.enableDate && props.enableTime) type = "time";

    return h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: "6px",
          width: "100%",
          margin: LEAF_MARGIN,
        },
      },
      [
        props.label
          ? h(
              "label",
              { for: uniqueId, style: getA2uiLabelStyle() },
              props.label,
            )
          : null,
        h("input", {
          id: uniqueId,
          type,
          style: getA2uiInputStyle({ focused: state.focused.value }),
          value: props.value || "",
          onInput: (e: Event) =>
            props.setValue((e.target as HTMLInputElement).value),
          onFocus: () => {
            state.focused.value = true;
          },
          onBlur: () => {
            state.focused.value = false;
          },
          min: typeof props.min === "string" ? props.min : undefined,
          max: typeof props.max === "string" ? props.max : undefined,
        }),
      ],
    );
  },
  () => ({ id: useA2UIUniqueId(), focused: ref(false) }),
);

// ============================================================
// Catalog Assembly
// ============================================================

const vueBasicComponents: VueComponentImplementation[] = [
  Text,
  Image,
  Icon,
  Video,
  AudioPlayer,
  Row,
  Column,
  List,
  Card,
  Tabs,
  Divider,
  Modal,
  Button,
  TextField,
  CheckBox,
  ChoicePicker,
  Slider,
  DateTimeInput,
];

export const vueBasicCatalog = new Catalog<VueComponentImplementation>(
  "https://a2ui.org/specification/v0_9/basic_catalog.json",
  vueBasicComponents,
  BASIC_FUNCTIONS,
);

export {
  Text,
  Image,
  Icon,
  Video,
  AudioPlayer,
  Row,
  Column,
  List,
  Card,
  Tabs,
  Divider,
  Modal,
  Button,
  TextField,
  CheckBox,
  ChoicePicker,
  Slider,
  DateTimeInput,
};
