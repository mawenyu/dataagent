import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { render, waitFor } from "@testing-library/vue";
import { createA2UIMessageRenderer } from "../A2UIMessageRenderer";
import { sanitizeA2uiOperations } from "../a2ui";
import { CopilotKitKey } from "../../providers/keys";

/**
 * A2UI 协议边界：畸形 payload 的降级渲染（2026-08-16 架构师指派，TDD）。
 *
 * 入口边界 = ACTIVITY_SNAPSHOT content.a2ui_operations。gateway 白名单是
 * 第一道防线，但渲染器自身必须兜住：畸形 JSONL 字符串、混入的非对象条目、
 * 超大 props —— 一律降级（能渲染多少渲染多少 + console.warn 留痕），
 * 不允许白屏/渲染异常/无限 loading 骨架。
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

function validOps(text: string) {
  return [
    {
      version: "v0.9",
      createSurface: { surfaceId: "edge", catalogId: CATALOG_ID },
    },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId: "edge",
        components: [
          { id: "root", component: "Text", text, variant: "body" },
        ],
      },
    },
  ];
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

describe("sanitizeA2uiOperations（纯函数边界）", () => {
  it("数组原样保留对象条目，丢弃 null/string/number/数组条目", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const good = { createSurface: { surfaceId: "s" } };
    const out = sanitizeA2uiOperations([good, null, "junk", 42, ["x"]]);
    expect(out).toEqual([good]);
    expect(warn).toHaveBeenCalled();
  });

  it("JSONL 字符串逐行解析：好行保留、坏行跳过", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const jsonl = [
      JSON.stringify({ createSurface: { surfaceId: "s1" } }),
      "{not json",
      JSON.stringify({ deleteSurface: { surfaceId: "s1" } }),
    ].join("\n");
    const out = sanitizeA2uiOperations(jsonl);
    expect(out).toHaveLength(2);
    expect(out[0]).toHaveProperty("createSurface");
    expect(out[1]).toHaveProperty("deleteSurface");
    expect(warn).toHaveBeenCalled();
  });

  it("单行合法 JSON 字符串也接受（非 JSONL 仅一行）", () => {
    const out = sanitizeA2uiOperations(
      JSON.stringify({ createSurface: { surfaceId: "solo" } }),
    );
    expect(out).toHaveLength(1);
  });

  it("全坏 JSONL / 其它类型 → 空数组", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(sanitizeA2uiOperations("{bad\n[worse")).toEqual([]);
    expect(sanitizeA2uiOperations(42)).toEqual([]);
    expect(sanitizeA2uiOperations(undefined)).toEqual([]);
  });
});

describe("A2UIMessageRenderer 畸形 payload 降级", () => {
  it("a2ui_operations 为 JSONL 字符串 → 解析出有效 op 并渲染（非永久 loading）", async () => {
    const jsonl = validOps("FromJSONL")
      .map((op) => JSON.stringify(op))
      .join("\n");
    const { container, queryByTestId } = renderWith({
      a2ui_operations: jsonl,
    });
    await waitFor(
      () => {
        expect(container.textContent ?? "").toContain("FromJSONL");
      },
      { timeout: 5000 },
    );
    expect(queryByTestId("a2ui-loading")).toBeNull();
  });

  it("JSONL 混入坏行 → 有效面照常渲染 + console.warn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const jsonl =
      JSON.stringify(validOps("GoodLines")[0]) +
      "\n{broken\n" +
      JSON.stringify(validOps("GoodLines")[1]);
    const { container } = renderWith({ a2ui_operations: jsonl });
    await waitFor(
      () => {
        expect(container.textContent ?? "").toContain("GoodLines");
      },
      { timeout: 5000 },
    );
    expect(warn).toHaveBeenCalled();
  });

  it("payload 存在但 0 条可用 op（全坏 JSONL）→ 降级错误条而非永久 loading", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { getByTestId, queryByTestId } = renderWith({
      a2ui_operations: "{totally\n[broken",
    });
    await waitFor(() => {
      expect(getByTestId("a2ui-payload-error")).not.toBeNull();
    });
    expect(queryByTestId("a2ui-loading")).toBeNull();
  });

  it("数组全是非对象条目 → 降级错误条而非永久 loading", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { getByTestId, queryByTestId } = renderWith({
      a2ui_operations: [null, "junk", 42],
    });
    await waitFor(() => {
      expect(getByTestId("a2ui-payload-error")).not.toBeNull();
    });
    expect(queryByTestId("a2ui-loading")).toBeNull();
  });

  it("数组混入 null 条目 + 有效 op → 有效面渲染、不抛渲染异常", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = renderWith({
      a2ui_operations: [null, ...validOps("Survivor"), "junk"],
    });
    await waitFor(
      () => {
        expect(container.textContent ?? "").toContain("Survivor");
      },
      { timeout: 5000 },
    );
    expect(warn).toHaveBeenCalled();
    // 整批错误框不得出现
    expect(container.textContent ?? "").not.toContain("A2UI render error");
  });

  it("超大 props（300KB 文本）→ 正常渲染不卡死不白屏", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const big = "x".repeat(300 * 1024);
    const { container } = renderWith({ a2ui_operations: validOps(big) });
    await waitFor(
      () => {
        expect(
          (container.textContent ?? "").includes("x".repeat(1024)),
        ).toBe(true);
      },
      { timeout: 10000 },
    );
  });
});
