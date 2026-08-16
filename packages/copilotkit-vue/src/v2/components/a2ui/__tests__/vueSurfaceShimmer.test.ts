import { describe, expect, it } from "vitest";
import { mountSurface } from "./helpers";

/**
 * P-VISION-POLISH F：流式 shimmer 占位 —— keyframes 移到共享静态样式表。
 * 修复点：原实现每个 shimmer 实例经 innerHTML 注入一份重复 <style>
 * （渲染面内唯一 innerHTML 使用点），N 个流式组件 = N 份重复样式。
 */
describe("A2UI catalog polish — streaming shimmer placeholder", () => {
  it("未就绪组件渲染 shimmer：class 化动画，无 innerHTML style 子节点", () => {
    const { wrapper } = mountSurface([
      { component: "Column", id: "root", children: ["ghost", "ok"] },
      { component: "Text", id: "ok", text: "已就绪" },
      // ghost 组件尚未到达 → shimmer 占位
    ]);

    const shimmer = wrapper.find(".a2ui-shimmer");
    expect(shimmer.exists()).toBe(true);
    expect(shimmer.classes()).toContain("a2ui-shimmer");
    // 不再内嵌 <style> 子节点（keyframes 由共享样式表提供）
    expect(shimmer.element.querySelector("style")).toBeNull();
    expect(shimmer.element.innerHTML).toBe("");

    // 共享静态样式表包含 shimmer keyframes，且全文档只注入一次
    const tags = document.querySelectorAll("#a2ui-vue-catalog-styles");
    expect(tags.length).toBe(1);
    expect(tags[0]!.textContent ?? "").toContain("@keyframes a2ui-shimmer");

    // 正常组件照渲染
    expect(wrapper.text()).toContain("已就绪");
  });
});
