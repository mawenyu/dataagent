import { describe, expect, it } from "vitest";
// SFC <style> 不进 jsdom,用 ?raw 拿源码做回归闸(与 fork 侧类名断言互补:
// 那边管内容容器可读性上限,这边管应用侧卡片外框不再钉死)
import appSource from "../App.vue?raw";

function styleBlock(className: string): string {
  const re = new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`, "m");
  const m = appSource.match(re);
  if (!m) throw new Error(`.${className} 规则不存在`);
  return m[1];
}

describe("App 布局卡片宽度自适应(2026-08-17, bug 修复, architect-dispatched)", () => {
  it("caps-card(能力页/文件页工作画布)不再有 max-width 上限", () => {
    const block = styleBlock("caps-card");
    expect(block).not.toMatch(/max-width\s*:/);
    // 仍是 flex 自适应列(随窗口拉伸)
    expect(block).toMatch(/flex\s*:\s*1/);
    expect(block).toMatch(/width\s*:\s*100%/);
  });

  it("chat-card(对话卡)不再有 max-width 上限(可读性上限在 fork 的 cpk:max-w-5xl)", () => {
    const block = styleBlock("chat-card");
    expect(block).not.toMatch(/max-width\s*:/);
    expect(block).toMatch(/flex\s*:\s*1/);
    expect(block).toMatch(/width\s*:\s*100%/);
  });
});
