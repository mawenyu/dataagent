import { describe, expect, it, vi } from "vitest";
import { mountSurface } from "./helpers";

/**
 * P-VISION-POLISH A：Text 排版层级 + Divider 弱化 + 未知组件降级占位。
 * 目标（MASTER-PROMPT §9）：成熟 SaaS 视觉层级，而非浏览器默认样式/Demo 感。
 */
describe("A2UI catalog polish — Text typography", () => {
  it("h1~h5 有明确的字号/字重/行高层级（非浏览器默认）", () => {
    const { wrapper } = mountSurface([
      { component: "Column", id: "root", children: ["h1", "h2", "h3"] },
      { component: "Text", id: "h1", text: "标题一", variant: "h1" },
      { component: "Text", id: "h2", text: "标题二", variant: "h2" },
      { component: "Text", id: "h3", text: "标题三", variant: "h3" },
    ]);

    const h1 = wrapper.find("h1");
    const h2 = wrapper.find("h2");
    const h3 = wrapper.find("h3");
    expect(h1.exists()).toBe(true);

    const s1 = h1.attributes("style") ?? "";
    const s2 = h2.attributes("style") ?? "";
    const s3 = h3.attributes("style") ?? "";
    // 明确层级：24/20/18，字重 700/600/600，颜色使用 token 而非继承
    expect(s1).toContain("font-size: 24px");
    expect(s1).toContain("font-weight: 700");
    expect(s1).toContain("line-height: 1.3");
    expect(s2).toContain("font-size: 20px");
    expect(s2).toContain("font-weight: 600");
    expect(s3).toContain("font-size: 18px");
    // 标题颜色为近黑 token
    expect(s1).toContain("color: rgb(17, 24, 39)");
  });

  it("body/caption 使用正文字号与弱化色 token", () => {
    const { wrapper } = mountSurface([
      { component: "Column", id: "root", children: ["body", "cap"] },
      { component: "Text", id: "body", text: "正文" },
      { component: "Text", id: "cap", text: "注释", variant: "caption" },
    ]);

    const body = wrapper.find("span");
    const cap = wrapper.find("small");
    expect(body.attributes("style") ?? "").toContain("font-size: 14px");
    expect(body.attributes("style") ?? "").toContain("line-height: 1.6");
    expect(cap.attributes("style") ?? "").toContain("font-size: 12px");
    expect(cap.attributes("style") ?? "").toContain(
      "color: rgb(107, 114, 128)",
    );
  });
});

describe("A2UI catalog polish — Divider", () => {
  it("分隔线使用弱化边框色（#e5e7eb）而非粗糙 #ccc", () => {
    const { wrapper } = mountSurface([
      { component: "Column", id: "root", children: ["d"] },
      { component: "Divider", id: "d" },
    ]);
    const divider = wrapper
      .findAll("div")
      .find((d) => (d.attributes("style") ?? "").includes("height: 1px"));
    expect(divider).toBeDefined();
    const style = divider!.attributes("style") ?? "";
    expect(style).toContain("rgb(229, 231, 235)");
    expect(style).not.toContain("rgb(204, 204, 204)");
  });
});

describe("A2UI catalog polish — unknown component placeholder", () => {
  it("未知组件渲染为警示 chip（虚线边框+浅黄底）而非裸红字，且保留 console.warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { wrapper } = mountSurface([
      { component: "Column", id: "root", children: ["ghost", "ok"] },
      { component: "Gauge", id: "ghost", value: 1 },
      { component: "Text", id: "ok", text: "存活" },
    ]);

    expect(wrapper.text()).toContain("存活");
    expect(wrapper.text()).toContain("Unknown component: Gauge");

    const placeholder = wrapper
      .findAll("div")
      .find(
        (d) =>
          d.element.children.length === 0 &&
          (d.text() ?? "").includes("Unknown component: Gauge"),
      );
    expect(placeholder).toBeDefined();
    const style = placeholder!.attributes("style") ?? "";
    expect(style).toContain("dashed");
    expect(style).toContain("rgb(255, 251, 235)"); // #fffbeb 浅黄底
    expect(style).not.toMatch(/color:\s*red/);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("Gauge"))).toBe(
      true,
    );
    warn.mockRestore();
  });
});
