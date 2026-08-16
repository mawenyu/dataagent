import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { render, waitFor } from "@testing-library/vue";
import { createA2UIMessageRenderer } from "../A2UIMessageRenderer";
import { sanitizeA2uiOperations } from "../a2ui";
import { CopilotKitKey } from "../../providers/keys";

/**
 * A2UI 协议边界第二批（2026-08-16 架构师指派，TDD 先红）：
 *
 *  1. 重复 op 去重 —— 断连重放/快照重叠会把同一批 op 重复送达；逐字节
 *     相同的 op 只留第一条，同 surface 的重复 createSurface 只留第一条
 *     （web_core 对重复 createSurface 直接 throw "already exists"）。
 *  2. out-of-order 归一化 —— 乱序流（updateComponents 先于 createSurface）
 *     目前被逐 op 容错永久丢弃（"Surface not found"），内容丢失；入口
 *     消毒必须把 createSurface 稳定提前、deleteSurface 稳定押后。
 *  3. 超大 payload 截断 —— 单条 string 超过上限截断留 marker；整条 op
 *     序列化后超硬上限整条丢弃（兄弟 op 不受拖累）。
 */

function copilotKitProvide() {
  return {
    [CopilotKitKey as symbol]: {
      copilotkit: ref({
        properties: {},
        setProperties: () => undefined,
        runAgent: async () => undefined,
      }),
      executingToolCallIds: ref(new Set()),
      a2uiTheme: ref({}),
      a2uiCatalog: ref(undefined),
      a2uiLoadingComponent: ref(undefined),
      a2uiIncludeSchema: ref(true),
    },
  };
}

const CATALOG_ID = "https://a2ui.org/specification/v0_9/basic_catalog.json";

function createSurfaceOp(surfaceId = "edge") {
  return {
    version: "v0.9",
    createSurface: { surfaceId, catalogId: CATALOG_ID },
  };
}

function textOp(text: string, surfaceId = "edge", id = "root") {
  return {
    version: "v0.9",
    updateComponents: {
      surfaceId,
      components: [{ id, component: "Text", text, variant: "body" }],
    },
  };
}

function renderWith(content: unknown) {
  const renderer = createA2UIMessageRenderer({ theme: {} });
  return render(renderer.render, {
    props: {
      activityType: "a2ui-surface",
      content,
      message: {},
      agent: {},
    },
    global: { provide: copilotKitProvide() },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("重复 op 去重（重放/快照重叠）", () => {
  it("逐字节相同的 op 只保留第一条 + console.warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ops = [createSurfaceOp(), textOp("dup"), createSurfaceOp(), textOp("dup")];
    const out = sanitizeA2uiOperations(ops);
    expect(out).toHaveLength(2);
    expect(out[0]).toHaveProperty("createSurface");
    expect(out[1]).toHaveProperty("updateComponents");
    expect(warn).toHaveBeenCalled();
  });

  it("同 surfaceId 的重复 createSurface（内容不同）只保留第一条", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const second = {
      version: "v0.9",
      createSurface: { surfaceId: "edge", catalogId: CATALOG_ID, sendDataModel: true },
    };
    const out = sanitizeA2uiOperations([createSurfaceOp(), second]);
    expect(out).toHaveLength(1);
    expect((out[0] as any).createSurface.sendDataModel).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("不同 surface 的 createSurface 互不误伤", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = sanitizeA2uiOperations([createSurfaceOp("a"), createSurfaceOp("b")]);
    expect(out).toHaveLength(2);
  });

  it("渲染层：整批重复送达 → 只渲染一个 surface，无 render error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const batch = [createSurfaceOp(), textOp("Replayed")];
    const { container } = renderWith({
      a2ui_operations: [...batch, ...batch],
    });
    await waitFor(
      () => {
        expect(container.textContent ?? "").toContain("Replayed");
      },
      { timeout: 5000 },
    );
    expect(
      container.querySelectorAll('[data-surface-id="edge"]'),
    ).toHaveLength(1);
    expect(container.textContent ?? "").not.toContain("A2UI render error");
  });
});

describe("out-of-order 事件归一化", () => {
  it("纯函数：createSurface 稳定提前、deleteSurface 稳定押后，其余保持相对序", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ops = [
      { deleteSurface: { surfaceId: "edge" } },
      textOp("first"),
      createSurfaceOp(),
      textOp("second"),
    ];
    const out = sanitizeA2uiOperations(ops);
    expect(out.map((op) => Object.keys(op).find((k) => k !== "version"))).toEqual([
      "createSurface",
      "updateComponents",
      "updateComponents",
      "deleteSurface",
    ]);
    // 同类之间保持原始相对序
    expect((out[1] as any).updateComponents.components[0].text).toBe("first");
    expect((out[2] as any).updateComponents.components[0].text).toBe("second");
  });

  it("渲染层：updateComponents 先于 createSurface 到达 → 内容不丢失照常渲染", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = renderWith({
      a2ui_operations: [textOp("OutOfOrder"), createSurfaceOp()],
    });
    await waitFor(
      () => {
        expect(container.textContent ?? "").toContain("OutOfOrder");
      },
      { timeout: 5000 },
    );
    expect(container.textContent ?? "").not.toContain("A2UI render error");
  });

  it("渲染层：updateDataModel 先于 createSurface 到达 → 不丢不炸", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const dataOp = {
      version: "v0.9",
      updateDataModel: { surfaceId: "edge", path: "/title", value: "DM" },
    };
    const { container } = renderWith({
      a2ui_operations: [dataOp, createSurfaceOp(), textOp("AfterDM")],
    });
    await waitFor(
      () => {
        expect(container.textContent ?? "").toContain("AfterDM");
      },
      { timeout: 5000 },
    );
  });
});

describe("超大 payload 截断", () => {
  it("纯函数：超过上限的 string 值被截断并留 marker + console.warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const big = "y".repeat(4096);
    const out = sanitizeA2uiOperations([textOp(big)], {
      maxStringChars: 1024,
    });
    const text = (out[0] as any).updateComponents.components[0]
      .text as string;
    expect(text.length).toBeLessThan(1100);
    expect(text).toContain("truncated");
    expect(text.startsWith("y".repeat(100))).toBe(true);
    expect(warn).toHaveBeenCalled();
  });

  it("纯函数：整条 op 序列化超硬上限 → 整条丢弃，兄弟 op 存活", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fat = {
      updateComponents: {
        surfaceId: "edge",
        components: [
          { id: "fat", component: "Text", text: "z".repeat(8192) },
        ],
      },
    };
    const out = sanitizeA2uiOperations([createSurfaceOp(), fat, textOp("thin")], {
      maxOpBytes: 4096,
      maxStringChars: 1024 * 1024,
    });
    // fat 整条被丢弃（不是截断后保留）
    expect(out).toHaveLength(2);
    expect(out.some((op) => JSON.stringify(op).includes("fat"))).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it("渲染层：2MB 文本 → 截断渲染（含 marker）不卡死不白屏", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const big = "Q".repeat(2 * 1024 * 1024);
    const { container } = renderWith({
      a2ui_operations: [createSurfaceOp(), textOp(big)],
    });
    await waitFor(
      () => {
        expect(container.textContent ?? "").toContain("truncated");
      },
      { timeout: 10000 },
    );
    // 截断后绝不可能把 2MB 全文渲染出来
    expect((container.textContent ?? "").length).toBeLessThan(1.5 * 1024 * 1024);
  });
});
