import { describe, expect, it } from "vitest";
import { mountSurface } from "./helpers";

/**
 * P-VISION-POLISH D：Tabs 现代下划线页签 + Modal 产品化弹层。
 * 修复点：Tabs 选中态简陋、无 hover/空态；Modal 灰幕生硬、无动画、无 ESC。
 */
describe("A2UI catalog polish — Tabs", () => {
  const mountTabs = (tabs: unknown[] = [
    { title: "概览", child: "c1" },
    { title: "明细", child: "c2" },
  ]) =>
    mountSurface([
      { component: "Tabs", id: "root", tabs },
      { component: "Text", id: "c1", text: "内容一" },
      { component: "Text", id: "c2", text: "内容二" },
    ]);

  it("页签条 #e5e7eb 底边；选中页签主色 + 2px 下划线；未选中弱化色", () => {
    const { wrapper } = mountTabs();
    const buttons = wrapper.findAll("button");
    expect(buttons.length).toBe(2);
    const [active, inactive] = buttons;
    expect(active!.attributes("style")).toContain(
      "--a2ui-primary-color, #2563eb",
    );
    expect(active!.attributes("style")).toContain("border-bottom: 2px solid");
    expect(inactive!.attributes("style")).toContain(
      "color: rgb(107, 114, 128)",
    );
    expect(inactive!.attributes("style")).toContain("transition");
  });

  it("未选中页签 hover 加深为近黑色", async () => {
    const { wrapper } = mountTabs();
    const inactive = wrapper.findAll("button")[1]!;
    await inactive.trigger("mouseenter");
    expect(inactive.attributes("style")).toContain("color: rgb(17, 24, 39)");
    await inactive.trigger("mouseleave");
    expect(inactive.attributes("style")).toContain(
      "color: rgb(107, 114, 128)",
    );
  });

  it("点击切换页签内容仍然工作", async () => {
    const { wrapper } = mountTabs();
    expect(wrapper.text()).toContain("内容一");
    await wrapper.findAll("button")[1]!.trigger("click");
    expect(wrapper.text()).toContain("内容二");
  });

  it("空 tabs 渲染弱化占位而非空白", () => {
    const { wrapper } = mountTabs([]);
    expect(wrapper.text()).toContain("No tabs");
    const placeholder = wrapper
      .findAll("div")
      .find((d) => (d.text() ?? "").includes("No tabs"));
    expect(placeholder!.attributes("style")).toContain(
      "color: rgb(107, 114, 128)",
    );
  });
});

describe("A2UI catalog polish — Modal", () => {
  const mountModal = () =>
    mountSurface([
      { component: "Modal", id: "root", trigger: "trg", content: "body" },
      { component: "Text", id: "trg", text: "打开" },
      { component: "Text", id: "body", text: "弹层正文" },
    ]);

  it("打开后：role=dialog + aria-modal，深藍灰半透明背板 + 毛玻璃", async () => {
    const { wrapper } = mountModal();
    expect(wrapper.text()).not.toContain("弹层正文");
    const trigger = wrapper
      .findAll("div")
      .find(
        (d) =>
          d.text() === "打开" &&
          (d.attributes("style") ?? "").includes("cursor: pointer"),
      )!;
    await trigger.trigger("click");
    const dialog = wrapper.find("[role=dialog]");
    expect(dialog.exists()).toBe(true);
    expect(dialog.attributes("aria-modal")).toBe("true");
    const backdrop = wrapper.find(".a2ui-modal-backdrop");
    expect(backdrop.exists()).toBe(true);
    expect(backdrop.attributes("style")).toContain("rgba(15, 23, 42, 0.5)");
    // 注：backdrop-filter 毛玻璃在源码中保留，jsdom 不支持该属性故不在此断言。
  });

  it("面板 12px 圆角 + 双层阴影 + pop-in 动画类", async () => {
    const { wrapper } = mountModal();
    const trigger = wrapper
      .findAll("div")
      .find(
        (d) =>
          d.text() === "打开" &&
          (d.attributes("style") ?? "").includes("cursor: pointer"),
      )!;
    await trigger.trigger("click");
    const panel = wrapper.find(".a2ui-modal-panel");
    expect(panel.exists()).toBe(true);
    const style = panel.attributes("style") ?? "";
    expect(style).toContain("border-radius: 12px");
    expect(style).toContain("0 20px 25px -5px");
  });

  it("ESC 关闭弹层；关闭按钮有 aria-label 与 hover 态", async () => {
    const { wrapper } = mountModal();
    const trigger = wrapper
      .findAll("div")
      .find(
        (d) =>
          d.text() === "打开" &&
          (d.attributes("style") ?? "").includes("cursor: pointer"),
      )!;
    await trigger.trigger("click");
    expect(wrapper.find("[role=dialog]").exists()).toBe(true);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[role=dialog]").exists()).toBe(false);

    // 重开验证关闭按钮
    await trigger.trigger("click");
    const close = wrapper.find("button[aria-label=Close]");
    expect(close.exists()).toBe(true);
    await close.trigger("mouseenter");
    expect(close.attributes("style")).toContain(
      "background-color: rgb(243, 244, 246)",
    );
  });

  it("静态动画样式表只注入一次且内容固定", async () => {
    mountModal();
    mountModal();
    const tags = document.querySelectorAll("#a2ui-vue-catalog-styles");
    expect(tags.length).toBe(1);
    const css = tags[0]!.textContent ?? "";
    expect(css).toContain("@keyframes a2ui-pop-in");
    expect(css).toContain("@keyframes a2ui-fade-in");
  });
});
