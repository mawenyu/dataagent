import { describe, expect, it } from "vitest";
import { mountSurface } from "./helpers";

/**
 * P-VISION-POLISH C：表单控件统一输入风格（聚焦环/错误态/标签层级）。
 * 修复点：原实现边框 #ccc、无 focus 反馈、错误态刺眼纯红、标签层级随意。
 */
describe("A2UI catalog polish — TextField", () => {
  const mountField = (extra: Record<string, unknown> = {}) =>
    mountSurface([
      { component: "Column", id: "root", children: ["f"] },
      { component: "TextField", id: "f", label: "名称", ...extra },
    ]);

  it("输入框统一风格：8/12 padding、#d1d5db 边框、8px 圆角、过渡", () => {
    const { wrapper } = mountField();
    const input = wrapper.find("input");
    const style = input.attributes("style") ?? "";
    expect(style).toContain("padding: 8px 12px");
    expect(style).toContain("border: 1px solid rgb(209, 213, 219)");
    expect(style).toContain("border-radius: 8px");
    expect(style).toContain("transition");
  });

  it("聚焦时出现主色边框 + 聚焦环，失焦还原", async () => {
    const { wrapper } = mountField();
    const input = wrapper.find("input");
    await input.trigger("focus");
    const focused = input.attributes("style") ?? "";
    expect(focused).toContain("--a2ui-primary-color, #2563eb");
    expect(focused).toContain("--a2ui-primary-focus-ring");
    await input.trigger("blur");
    expect(input.attributes("style")).toContain(
      "border: 1px solid rgb(209, 213, 219)",
    );
  });

  it("错误态：#dc2626 边框 + 12px 错误文案，标签使用 13px/500 层级", () => {
    const { wrapper } = mountField({ validationErrors: ["必填项"] });
    const input = wrapper.find("input");
    expect(input.attributes("style")).toContain(
      "border: 1px solid rgb(220, 38, 38)",
    );
    const error = wrapper
      .findAll("span")
      .find((s) => s.text() === "必填项");
    expect(error).toBeDefined();
    expect(error!.attributes("style")).toContain("color: rgb(220, 38, 38)");
    expect(error!.attributes("style")).toContain("font-size: 12px");

    const label = wrapper.find("label");
    expect(label.attributes("style")).toContain("font-size: 13px");
    expect(label.attributes("style")).toContain("font-weight: 500");
    expect(label.attributes("style")).toContain("color: rgb(55, 65, 81)");
  });

  it("longText 变体 textarea 同样享有聚焦环", async () => {
    const { wrapper } = mountField({ variant: "longText" });
    const area = wrapper.find("textarea");
    expect(area.exists()).toBe(true);
    await area.trigger("focus");
    expect(area.attributes("style")).toContain("--a2ui-primary-focus-ring");
  });
});

describe("A2UI catalog polish — CheckBox", () => {
  it("勾选框 accent-color 主色、16px 尺寸；错误态标签/描边用 danger token", () => {
    const { wrapper } = mountSurface([
      { component: "Column", id: "root", children: ["c"] },
      {
        component: "CheckBox",
        id: "c",
        label: "记住我",
        validationErrors: ["必选"],
      },
    ]);
    const input = wrapper.find("input[type=checkbox]");
    const style = input.attributes("style") ?? "";
    expect(style).toContain("accent-color");
    expect(style).toContain("--a2ui-primary-color, #2563eb");
    expect(style).toContain("width: 16px");
    expect(style).toContain("height: 16px");
    expect(style).toContain("#dc2626");
  });
});

describe("A2UI catalog polish — ChoicePicker", () => {
  const mountPicker = (extra: Record<string, unknown> = {}) =>
    mountSurface([
      { component: "Column", id: "root", children: ["p"] },
      {
        component: "ChoicePicker",
        id: "p",
        label: "维度",
        displayStyle: "chips",
        options: [
          { label: "销售额", value: "sales" },
          { label: "订单量", value: "orders" },
        ],
        value: ["sales"],
        ...extra,
      },
    ]);

  it("chips：选中主色实心，未选中 hover 浅主色底", async () => {
    const { wrapper } = mountPicker();
    const chips = wrapper.findAll("button");
    expect(chips.length).toBe(2);
    const [selected, unselected] = chips;
    expect(selected!.attributes("style")).toContain(
      "color: rgb(255, 255, 255)",
    );
    expect(selected!.attributes("style")).toContain(
      "--a2ui-primary-color, #2563eb",
    );
    const beforeHover = unselected!.attributes("style") ?? "";
    expect(beforeHover).toContain("background-color: rgb(255, 255, 255)");
    await unselected!.trigger("mouseenter");
    expect(unselected!.attributes("style")).toContain(
      "--a2ui-primary-soft-color, #eff6ff",
    );
  });

  it("filterable 搜索框享有统一输入风格与聚焦环", async () => {
    const { wrapper } = mountPicker({ filterable: true });
    const filter = wrapper.find("input[type=text]");
    expect(filter.exists()).toBe(true);
    expect(filter.attributes("style")).toContain("padding: 8px 12px");
    await filter.trigger("focus");
    expect(filter.attributes("style")).toContain(
      "--a2ui-primary-focus-ring",
    );
  });

  it("列表模式行 hover 底色 + 圆角，radio/checkbox accent-color", async () => {
    const { wrapper } = mountSurface([
      { component: "Column", id: "root", children: ["p"] },
      {
        component: "ChoicePicker",
        id: "p",
        options: [
          { label: "甲", value: "a" },
          { label: "乙", value: "b" },
        ],
        value: [],
      },
    ]);
    const rows = wrapper.findAll("label");
    expect(rows.length).toBeGreaterThan(0);
    const row = rows[0]!;
    await row.trigger("mouseenter");
    expect(row.attributes("style")).toContain(
      "background-color: rgb(249, 250, 251)",
    );
    expect(row.attributes("style")).toContain("border-radius: 6px");
    const input = wrapper.find("input");
    expect(input.attributes("style")).toContain("accent-color");
  });
});

describe("A2UI catalog polish — Slider", () => {
  it("滑杆 accent-color 主色，当前值渲染为主色 chip（tabular-nums）", () => {
    const { wrapper } = mountSurface([
      { component: "Column", id: "root", children: ["s"] },
      { component: "Slider", id: "s", label: "置信度", value: 42, max: 100 },
    ]);
    const range = wrapper.find("input[type=range]");
    expect(range.attributes("style")).toContain(
      "--a2ui-primary-color, #2563eb",
    );
    const chip = wrapper.findAll("span").find((s) => s.text() === "42");
    expect(chip).toBeDefined();
    const style = chip!.attributes("style") ?? "";
    expect(style).toContain("--a2ui-primary-soft-color, #eff6ff");
    expect(style).toContain("font-variant-numeric: tabular-nums");
    expect(style).toContain("border-radius: 6px");
  });
});

describe("A2UI catalog polish — DateTimeInput", () => {
  it("日期输入统一输入风格 + 聚焦环", async () => {
    const { wrapper } = mountSurface([
      { component: "Column", id: "root", children: ["d"] },
      {
        component: "DateTimeInput",
        id: "d",
        label: "起止",
        enableDate: true,
        enableTime: false,
      },
    ]);
    const input = wrapper.find("input[type=date]");
    expect(input.exists()).toBe(true);
    expect(input.attributes("style")).toContain("padding: 8px 12px");
    await input.trigger("focus");
    expect(input.attributes("style")).toContain(
      "--a2ui-primary-focus-ring",
    );
  });
});
