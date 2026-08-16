import { describe, expect, it } from "vitest";
import { mountSurface } from "./helpers";

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

  it("禁用态（isValid=false）：disabled + 半透明 + not-allowed，hover 不再变化", async () => {
    const { wrapper } = mountButton({ variant: "primary", isValid: false });
    const btn = wrapper.find("button");
    expect(btn.attributes("disabled")).toBeDefined();
    const before = btn.attributes("style") ?? "";
    expect(before).toContain("opacity: 0.5");
    expect(before).toContain("cursor: not-allowed");
    await btn.trigger("mouseenter");
    expect(btn.attributes("style")).toContain("opacity: 0.5");
    expect(btn.attributes("style")).not.toContain("#1d4ed8");
  });
});
