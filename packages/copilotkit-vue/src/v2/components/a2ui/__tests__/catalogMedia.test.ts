import { describe, expect, it } from "vitest";
import { mountSurface } from "./helpers";

/**
 * P-VISION-POLISH E：媒体组件缺态补齐 —— Image 加载底色/失败降级/空 url 占位。
 * 修复点：原实现图片失败只显示破图图标（浏览器默认），无 empty/error 态。
 */
describe("A2UI catalog polish — Image", () => {
  it("正常图片：加载底色 + 变体圆角（feature/header）", () => {
    const { wrapper } = mountSurface([
      { component: "Column", id: "root", children: ["img"] },
      {
        component: "Image",
        id: "img",
        url: "https://example.com/a.png",
        variant: "largeFeature",
      },
    ]);
    const img = wrapper.find("img");
    expect(img.exists()).toBe(true);
    const style = img.attributes("style") ?? "";
    expect(style).toContain("background-color: rgb(243, 244, 246)");
    expect(style).toContain("border-radius: 8px");
  });

  it("icon/avatar 变体不加强制圆角底色以外的装饰（avatar 保持圆形）", () => {
    const { wrapper } = mountSurface([
      { component: "Column", id: "root", children: ["img"] },
      {
        component: "Image",
        id: "img",
        url: "https://example.com/a.png",
        variant: "avatar",
      },
    ]);
    const style = wrapper.find("img").attributes("style") ?? "";
    expect(style).toContain("border-radius: 50%");
  });

  it("加载失败：破图替换为虚线占位（含描述文案），img 移除", async () => {
    const { wrapper } = mountSurface([
      { component: "Column", id: "root", children: ["img"] },
      {
        component: "Image",
        id: "img",
        url: "https://example.com/broken.png",
        description: "销售趋势图",
      },
    ]);
    const img = wrapper.find("img");
    expect(img.exists()).toBe(true);
    await img.trigger("error");
    expect(wrapper.find("img").exists()).toBe(false);
    const placeholder = wrapper
      .findAll("div")
      .find((d) => d.element.children.length === 0 && d.text().includes("销售趋势图"));
    expect(placeholder).toBeDefined();
    const style = placeholder!.attributes("style") ?? "";
    expect(style).toContain("dashed");
    expect(style).toContain("color: rgb(107, 114, 128)");
  });

  it("空 url：直接渲染占位（Image unavailable）而非破图 img", () => {
    const { wrapper } = mountSurface([
      { component: "Column", id: "root", children: ["img"] },
      { component: "Image", id: "img" },
    ]);
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.text()).toContain("Image unavailable");
  });
});

describe("A2UI catalog polish — Video/AudioPlayer", () => {
  it("视频 8px 圆角 + 深色加载底色", () => {
    const { wrapper } = mountSurface([
      { component: "Column", id: "root", children: ["v"] },
      { component: "Video", id: "v", url: "https://example.com/v.mp4" },
    ]);
    const style = wrapper.find("video").attributes("style") ?? "";
    expect(style).toContain("border-radius: 8px");
  });

  it("音频描述使用弱化色 token（#6b7280）", () => {
    const { wrapper } = mountSurface([
      { component: "Column", id: "root", children: ["a"] },
      {
        component: "AudioPlayer",
        id: "a",
        url: "https://example.com/a.mp3",
        description: "播报",
      },
    ]);
    const desc = wrapper.findAll("span").find((s) => s.text() === "播报");
    expect(desc).toBeDefined();
    expect(desc!.attributes("style")).toContain("color: rgb(107, 114, 128)");
  });
});
