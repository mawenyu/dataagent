/**
 * Style utilities for Vue A2UI basic catalog components.
 * Mirrors the React renderer's catalog/basic/utils.ts.
 */

import type { CSSProperties } from "vue";

/** Standard leaf margin from the implementation guide. */
export const LEAF_MARGIN = "8px";

/** Standard internal padding for visually bounded containers. */
export const CONTAINER_PADDING = "16px";

/** Standard border for cards and inputs. */
export const STANDARD_BORDER = "1px solid #ccc";

/** Standard border radius. */
export const STANDARD_RADIUS = "8px";

/**
 * Design tokens for the Vue A2UI catalog (dataagent polish, 2026-08-16).
 * Goal (MASTER-PROMPT §9): mature SaaS look — neutral gray scale, one
 * primary accent, consistent radii/elevation — instead of browser defaults.
 */
export const A2UI_PALETTE = {
  /** Near-black primary text. */
  text: "#111827",
  /** Secondary body text. */
  textSecondary: "#374151",
  /** Muted labels/captions. */
  textMuted: "#6b7280",
  /** Subtle borders/dividers. */
  border: "#e5e7eb",
  /** Input borders (slightly stronger than dividers). */
  borderStrong: "#d1d5db",
  /** Card/panel background. */
  surface: "#ffffff",
  /** Sunken background (hover fills, loading blocks). */
  surfaceSunken: "#f9fafb",
  /** Destructive / validation error. */
  danger: "#dc2626",
  /** Warning text. */
  warningText: "#b45309",
  /** Warning border. */
  warningBorder: "#f59e0b",
  /** Warning soft background. */
  warningSoft: "#fffbeb",
} as const;

/** Primary accent — themable via --a2ui-primary-color, refined blue fallback. */
export const A2UI_PRIMARY = "var(--a2ui-primary-color, #2563eb)";
/** Primary accent hover — themable via --a2ui-primary-hover-color. */
export const A2UI_PRIMARY_HOVER = "var(--a2ui-primary-hover-color, #1d4ed8)";
/** Primary soft fill (selected chips, value badges). */
export const A2UI_PRIMARY_SOFT = "var(--a2ui-primary-soft-color, #eff6ff)";
/** Focus ring halo. */
export const A2UI_FOCUS_RING =
  "var(--a2ui-primary-focus-ring, rgba(37, 99, 235, 0.15))";

export const mapJustify = (j?: string): string => {
  switch (j) {
    case "center":
      return "center";
    case "end":
      return "flex-end";
    case "spaceAround":
      return "space-around";
    case "spaceBetween":
      return "space-between";
    case "spaceEvenly":
      return "space-evenly";
    case "start":
      return "flex-start";
    case "stretch":
      return "stretch";
    default:
      return "flex-start";
  }
};

export const mapAlign = (a?: string): string => {
  switch (a) {
    case "start":
      return "flex-start";
    case "center":
      return "center";
    case "end":
      return "flex-end";
    case "stretch":
      return "stretch";
    default:
      return "stretch";
  }
};

export const getBaseLeafStyle = (): CSSProperties => ({
  margin: LEAF_MARGIN,
  boxSizing: "border-box",
});

export const getBaseContainerStyle = (): CSSProperties => ({
  margin: LEAF_MARGIN,
  padding: CONTAINER_PADDING,
  border: STANDARD_BORDER,
  borderRadius: STANDARD_RADIUS,
  boxSizing: "border-box",
});

/**
 * Shared form-field style (TextField / DateTimeInput / ChoicePicker filter).
 * Encodes the focus ring and error border so all inputs behave identically.
 */
export const getA2uiInputStyle = (opts: {
  hasError?: boolean;
  focused?: boolean;
}): CSSProperties => ({
  padding: "8px 12px",
  width: "100%",
  fontSize: "14px",
  lineHeight: "1.4",
  color: A2UI_PALETTE.text,
  backgroundColor: A2UI_PALETTE.surface,
  border: `1px solid ${
    opts.hasError
      ? A2UI_PALETTE.danger
      : opts.focused
        ? A2UI_PRIMARY
        : A2UI_PALETTE.borderStrong
  }`,
  borderRadius: "8px",
  boxShadow:
    !opts.hasError && opts.focused ? `0 0 0 3px ${A2UI_FOCUS_RING}` : "none",
  outline: "none",
  boxSizing: "border-box",
  transition: "border-color 0.15s ease, box-shadow 0.15s ease",
});

/** Label style shared by form controls. */
export const getA2uiLabelStyle = (): CSSProperties => ({
  fontSize: "13px",
  fontWeight: "500",
  color: A2UI_PALETTE.textSecondary,
});

/** Validation error text style. */
export const getA2uiErrorTextStyle = (): CSSProperties => ({
  fontSize: "12px",
  color: A2UI_PALETTE.danger,
});

/**
 * Warning chip used for degraded rendering (unknown component / cycle).
 * Visible and calm — a placeholder, not an error splat.
 */
export const getWarningChipStyle = (): CSSProperties => ({
  padding: "8px 12px",
  border: `1px dashed ${A2UI_PALETTE.warningBorder}`,
  borderRadius: "8px",
  backgroundColor: A2UI_PALETTE.warningSoft,
  color: A2UI_PALETTE.warningText,
  fontSize: "12px",
  lineHeight: "1.4",
  boxSizing: "border-box",
});

const A2UI_CATALOG_STYLE_ID = "a2ui-vue-catalog-styles";

/**
 * Injects the catalog's static keyframes/transition stylesheet once.
 * Content is a fixed string — never derived from payload data.
 */
export function ensureA2uiCatalogStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(A2UI_CATALOG_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = A2UI_CATALOG_STYLE_ID;
  style.textContent = `
@keyframes a2ui-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes a2ui-pop-in {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes a2ui-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.a2ui-modal-backdrop { animation: a2ui-fade-in 0.15s ease-out; }
.a2ui-modal-panel { animation: a2ui-pop-in 0.18s cubic-bezier(0.16, 1, 0.3, 1); }
.a2ui-shimmer { animation: a2ui-shimmer 1.5s ease-in-out infinite; }
`;
  document.head.appendChild(style);
}
