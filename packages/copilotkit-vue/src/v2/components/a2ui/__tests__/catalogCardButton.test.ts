import { describe, expect, it } from "vitest";
import { mountSurface } from "./helpers";
import { A2UI_PALETTE } from "../utils";

/**
 * P-VISION-POLISH B：Card 层级/悬浮抬升 + Button 三变体交互态。
 * 修复点：原实现无 hover/active/disabled 视觉反馈、阴影粗糙（Demo 感）。
 */
describe("A2UI catalog polish — Card", () => {
  it("使用弱边框 + 12px 圆角 + 细腻阴影（替代 0 2px 4px 粗阴影）", () => {
    const { wrapper } = mountSurface([
      { component: "Card", id: "root", child: "t" },
      { component: "Text", id: "t", text: "卡片内容" },
    ]);
    const card = wrapper
      .findAll("div")
      .find((d) => (d.attributes("style") ?? "").includes("box-shadow"));
    expect(card).toBeDefined();
    const style = card!.attributes("style") ?? "";
    expect(style).toContain("border: 1px solid rgb(229, 231, 235)");
    expect(style).toContain("border-radius: 12px");
    expect(style).toContain("0 1px 2px rgba(16, 24, 40, 0.05)");
    expect(style).toContain("transition");
  });

  it("hover 时阴影抬升（mouseenter/mouseleave 往返）", async () => {
    const { wrapper } = mountSurface([
      { component: "Card", id: "root", child: "t" },
      { component: "Text", id: "t", text: "卡片内容" },
    ]);
    const card = wrapper
      .findAll("div")
      .find((d) => (d.attributes("style") ?? "").includes("box-shadow"));
    expect(card).toBeDefined();

    await card!.trigger("mouseenter");
    expect(card!.attributes("style")).toContain(
      "0 4px 12px rgba(16, 24, 40, 0.08)",
    );

    await card!.trigger("mouseleave");
    expect(card!.attributes("style")).toContain(
      "0 1px 2px rgba(16, 24, 40, 0.05)",
    );
  });
});

describe("A2UI catalog polish — Button", () => {
  const mountButton = (extra: Record<string, unknown> = {}) =>
    mountSurface([
      { component: "Column", id: "root", children: ["btn"] },
      {
        component: "Button",
        id: "btn",
        child: "label",
        action: { name: "noop" },
        ...extra,
      },
      { component: "Text", id: "label", text: "提交" },
    ]);

  it("primary 变体：主色底白字、8px 圆角、500 字重、过渡动画", () => {
    const { wrapper } = mountButton({ variant: "primary" });
    const btn = wrapper.find("button");
    const style = btn.attributes("style") ?? "";
    expect(style).toContain("color: rgb(255, 255, 255)");
    expect(style).toContain("--a2ui-primary-color, #2563eb");
    expect(style).toContain("border-radius: 8px");
    expect(style).toContain("font-weight: 500");
    expect(style).toContain("transition");
  });

  it("primary hover 加深（mouseenter → hover 色），离开后还原", async () => {
    const { wrapper } = mountButton({ variant: "primary" });
    const btn = wrapper.find("button");
    await btn.trigger("mouseenter");
    expect(btn.attributes("style")).toContain(
      "--a2ui-primary-hover-color, #1d4ed8",
    );
    await btn.trigger("mouseleave");
    expect(btn.attributes("style")).toContain(
      "--a2ui-primary-color, #2563eb",
    );
  });

  it("default 变体 hover 下沉底色；borderless 保持透明", async () => {
    const { wrapper } = mountButton();
    const btn = wrapper.find("button");
    expect(btn.attributes("style")).toContain(
      "background-color: rgb(255, 255, 255)",
    );
    await btn.trigger("mouseenter");
    expect(btn.attributes("style")).toContain(
      "background-color: rgb(249, 250, 251)",
    );

    const borderless = mountButton({ variant: "borderless" });
    const b2 = borderless.wrapper.find("button");
    expect(b2.attributes("style")).toContain("background-color: transparent");
    await b2.trigger("mouseenter");
    expect(b2.attributes("style")).toContain("rgba(17, 24, 39, 0.04)");
  });

  it("禁用态（isValid=false）：disabled + 实心弱化配色 + not-allowed，hover 不再变化", async () => {
    const { wrapper } = mountButton({ variant: "primary", isValid: false });
    const btn = wrapper.find("button");
    expect(btn.attributes("disabled")).toBeDefined();
    const before = btn.attributes("style") ?? "";
    // P28-B：弃用 opacity 0.5（真实对比度随底色塌陷，过不了 WCAG AA）——
    // 改实心 muted 配色 #e5e7eb 底 + #4b5563 字，任何 variant 禁用后统一
    expect(before).not.toContain("opacity");
    expect(before).toContain("cursor: not-allowed");
    expect(before).toContain("background-color: rgb(229, 231, 235)");
    expect(before).toContain("color: rgb(75, 85, 99)");
    await btn.trigger("mouseenter");
    expect(btn.attributes("style")).toBe(before);
  });

  it("禁用态文字/底色对比度满足 WCAG AA（≥4.5:1）", () => {
    // WCAG 2.x 相对亮度与对比度公式，钉住禁用配色的可访问性底线
    const luminance = (hex: string) => {
      const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const lin = ch.map((v) =>
        v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4),
      );
      return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
    };
    const text = luminance(A2UI_PALETTE.textDisabled);
    const bg = luminance(A2UI_PALETTE.surfaceDisabled);
    const ratio = (bg + 0.05) / (text + 0.05);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
