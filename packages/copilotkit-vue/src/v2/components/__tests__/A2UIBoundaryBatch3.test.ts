import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { render, waitFor } from "@testing-library/vue";
import { createA2UIMessageRenderer } from "../A2UIMessageRenderer";
import { sanitizeA2uiOperations } from "../a2ui";
import { CopilotKitKey } from "../../providers/keys";

/**
 * A2UI 协议边界第三批（2026-08-16 架构师指派，TDD 先红）：
 * 20+ op 的 pipeline 组合顺序交互。
 *
 *  a) truncate 后 dedupe 的 key 稳定性 —— 去重 key 必须取自截断后的
 *     op（截断后逐字节相同 = 渲染结果相同，理应去重；上限内有差异
 *     的绝不可误撞）。
 *  b) deleteSurface 屏障与同 id 复活 —— [create, delete, create] 是
 *     合法的"销毁重建"序列：去重不得吞掉复活 create，归一化不得把
 *     delete 押过复活点（第二批的全局 rank 排序在这两个维度上都错，
 *     本批改为 per-surface 分段归一化，delete 是段屏障）。
 *  c) JSONL 坏行与超大 op 混合流 —— 解析/闸口/截断/去重/归一化五段
 *     在 JSONL 路径上的组合。
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

function deleteSurfaceOp(surfaceId = "edge") {
  return { version: "v0.9", deleteSurface: { surfaceId } };
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

/** op 类别名（断言序列用）。 */
function kind(op: Record<string, unknown>): string {
  if ("createSurface" in op) return "create";
  if ("deleteSurface" in op) return "delete";
  if ("updateDataModel" in op) return "data";
  return "update";
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

describe("a) truncate 后 dedupe 的 key 稳定性", () => {
  it("截断后逐字节相同的 op 去重为一条（key 取自截断后）", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const head = "A".repeat(2000);
    const a = textOp(head + "-tail-one");
    const b = textOp(head + "-tail-two-DIFFERENT");
    const out = sanitizeA2uiOperations([a, b], { maxStringChars: 1024 });
    // 截断到 1024 后两条完全一样 → 渲染结果相同 → 只留一条
    expect(out).toHaveLength(1);
  });

  it("上限内有差异的 op 绝不因截断误撞", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = textOp("A".repeat(500) + "-within-cap-one");
    const b = textOp("A".repeat(500) + "-within-cap-two");
    const out = sanitizeA2uiOperations([a, b], { maxStringChars: 1024 });
    expect(out).toHaveLength(2);
  });

  it("26 op 流：13 对仅截断尾部不同 → 去重后恰 13 条", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ops: unknown[] = [];
    for (let i = 0; i < 13; i++) {
      const head = `H${i}-` + "B".repeat(2000);
      ops.push(textOp(head + "-x"), textOp(head + "-y"));
    }
    const out = sanitizeA2uiOperations(ops, { maxStringChars: 1024 });
    expect(out).toHaveLength(13);
  });
});

describe("b) deleteSurface 屏障与同 id 复活", () => {
  it("纯函数：[create, delete, create] 三条全保留且顺序不动", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = sanitizeA2uiOperations([
      createSurfaceOp(),
      deleteSurfaceOp(),
      createSurfaceOp(),
    ]);
    expect(out.map(kind)).toEqual(["create", "delete", "create"]);
  });

  it("纯函数：段内（无 delete 间隔）重复 createSurface 仍去重", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const dup = {
      version: "v0.9",
      createSurface: { surfaceId: "edge", catalogId: CATALOG_ID, sendDataModel: true },
    };
    const out = sanitizeA2uiOperations([createSurfaceOp(), dup]);
    expect(out).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
  });

  it("纯函数：段内乱序仍归一（create 提到段首），但不得越过 delete 屏障", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = sanitizeA2uiOperations([
      textOp("before"),
      createSurfaceOp(),
      deleteSurfaceOp(),
      textOp("after"),
      createSurfaceOp(),
    ]);
    expect(out.map(kind)).toEqual([
      "create",
      "update",
      "delete",
      "create",
      "update",
    ]);
    expect((out[1] as any).updateComponents.components[0].text).toBe("before");
    expect((out[4] as any).updateComponents.components[0].text).toBe("after");
  });

  it("渲染层：复活序列 [create+Old, delete, create+New] → 只渲染 New", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = renderWith({
      a2ui_operations: [
        createSurfaceOp(),
        textOp("Old"),
        deleteSurfaceOp(),
        createSurfaceOp(),
        textOp("New"),
      ],
    });
    await waitFor(
      () => {
        expect(container.textContent ?? "").toContain("New");
      },
      { timeout: 5000 },
    );
    expect(container.textContent ?? "").not.toContain("Old");
    expect(container.textContent ?? "").not.toContain("A2UI render error");
  });

  it("渲染层：21 op 三轮复活循环 → 终态正确", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ops: unknown[] = [];
    for (let round = 0; round < 3; round++) {
      // 每轮 7 条：create + root Column（挂 t0/t1）+ 2 update + 2 data +
      // delete；末轮以一条逐字节重复的 root op 顶替 delete（顺便压测
      // 复活段的重复去重）。root 必不可少 —— VueSurface 只从 id="root"
      // 起渲染，无 root 的 surface 永远停在 shimmer 占位。
      const rootOp = {
        version: "v0.9",
        updateComponents: {
          surfaceId: "cycle",
          components: [{ id: "root", component: "Column", children: ["t0", "t1"] }],
        },
      };
      ops.push(createSurfaceOp("cycle"));
      ops.push(rootOp);
      for (let j = 0; j < 2; j++) {
        ops.push(textOp(`r${round}t${j}`, "cycle", `t${j}`));
      }
      ops.push({
        version: "v0.9",
        updateDataModel: { surfaceId: "cycle", path: "/r", value: round },
      });
      ops.push({
        version: "v0.9",
        updateDataModel: { surfaceId: "cycle", path: "/r2", value: round },
      });
      if (round < 2) ops.push(deleteSurfaceOp("cycle"));
      else ops.push(rootOp); // 逐字节重复（截胡 delete，压测复活段去重）
    }
    expect(ops).toHaveLength(21);
    const { container } = renderWith({ a2ui_operations: ops });
    await waitFor(
      () => {
        expect(container.textContent ?? "").toContain("r2t1");
      },
      { timeout: 5000 },
    );
    // 前轮内容必须随 delete 消失
    expect(container.textContent ?? "").not.toContain("r0t0");
    expect(container.textContent ?? "").not.toContain("r1t1");
  });
});

describe("c) JSONL 坏行与超大 op 混合流", () => {
  it("纯函数：27 行混合流 —— 好行存活/坏行跳过/整条超限丢弃/长串截断/乱序归一", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const lines: string[] = [];
    // 8 条乱序 update（create 在最后）
    for (let i = 0; i < 8; i++) lines.push(JSON.stringify(textOp(`L${i}`, "mix", `c${i}`)));
    // 6 行坏行
    lines.push("{broken", "[array-line]", '"just-a-string"', "{not-json", "42", "{{{");
    // 1 条整条超限（4KB 闸口下 8KB 文本）
    lines.push(JSON.stringify(textOp("F".repeat(8192), "mix", "fat")));
    // 1 条长串截断（2KB > 1KB 上限但整条 < 4KB 闸口）
    lines.push(JSON.stringify(textOp("T".repeat(2048), "mix", "long")));
    // 10 条重复 update（与首批逐字节相同 → 去重）
    for (let i = 0; i < 8; i++) lines.push(JSON.stringify(textOp(`L${i}`, "mix", `c${i}`)));
    lines.push(JSON.stringify(textOp("L0", "mix", "c0")));
    lines.push(JSON.stringify(textOp("L1", "mix", "c1")));
    // create 押在最后（乱序）
    lines.push(JSON.stringify(createSurfaceOp("mix")));
    expect(lines).toHaveLength(27);

    const out = sanitizeA2uiOperations(lines.join("\n"), {
      maxStringChars: 1024,
      maxOpBytes: 4096,
    });

    // 存活：create + 8 update + 1 截断 update = 10
    expect(out).toHaveLength(10);
    expect(kind(out[0])).toBe("create", "createSurface 必须归一到段首");
    const ids = out.slice(1).map(
      (op) => (op as any).updateComponents.components[0].id as string,
    );
    expect(ids).toEqual(["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "long"]);
    expect(ids).not.toContain("fat");
    const longText = (out[9] as any).updateComponents.components[0]
      .text as string;
    expect(longText).toContain("truncated");
    expect(longText.length).toBeLessThan(1100);
  });

  it("渲染层：JSONL 混合流（坏行+重复+乱序 create 押尾）照常渲染", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const lines = [
      JSON.stringify(textOp("MixedStream", "mj")),
      "{garbage-line",
      JSON.stringify(textOp("MixedStream", "mj")), // 重复
      JSON.stringify(createSurfaceOp("mj")),
    ];
    const { container } = renderWith({ a2ui_operations: lines.join("\n") });
    await waitFor(
      () => {
        expect(container.textContent ?? "").toContain("MixedStream");
      },
      { timeout: 5000 },
    );
    expect(container.textContent ?? "").not.toContain("A2UI render error");
  });
});

describe("d) 30 op 总集成：五段管线顺序交互", () => {
  it("多 surface + 乱序 + 重复 + 复活 + 超大混合 → 精确输出序列", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ops: unknown[] = [];
    // surface "s1"：乱序 update×3 开头
    for (let i = 0; i < 3; i++) ops.push(textOp(`s1-${i}`, "s1", `a${i}`));
    // surface "s2"：完整序列 + 逐字节重复一轮
    const s2 = [createSurfaceOp("s2"), textOp("s2-x", "s2", "b0"), textOp("s2-y", "s2", "b1")];
    ops.push(...s2, ...s2);
    // surface "s1"：delete + 复活 create + 新内容
    ops.push(deleteSurfaceOp("s1"), createSurfaceOp("s1"), textOp("s1-reborn", "s1", "a9"));
    // surface "s3"：create 带超长 string（截断）+ 整条超限 op（丢弃）
    ops.push(createSurfaceOp("s3"));
    ops.push(textOp("W".repeat(2048), "s3", "w0"));
    ops.push(textOp("G".repeat(8192), "s3", "fat"));
    // 坏条目混入数组
    ops.push(null, "junk", 7);
    // s1 的 create 始终未到段首（第一批 3 条 update 乱序）→ 补 create 在队尾
    ops.push(createSurfaceOp("s1"));
    // surface "s4"：4 条乱序 update + create 押尾
    for (let i = 0; i < 4; i++) ops.push(textOp(`s4-${i}`, "s4", `d${i}`));
    ops.push(createSurfaceOp("s4"));
    // s2 追加 3 条不同 path 的 updateDataModel（段内原位存活）
    for (let i = 0; i < 3; i++) {
      ops.push({
        version: "v0.9",
        updateDataModel: { surfaceId: "s2", path: `/p${i}`, value: i },
      });
    }
    // s2 首条 update 的逐字节重复 ×3（段内去重）
    ops.push(textOp("s2-x", "s2", "b0"), textOp("s2-x", "s2", "b0"), textOp("s2-x", "s2", "b0"));
    expect(ops).toHaveLength(30);

    const out = sanitizeA2uiOperations(ops, {
      maxStringChars: 1024,
      maxOpBytes: 4096,
    });

    // s1 段1：[update×3]（无 create，保持原序）；delete；段2：[create, update]
    //   —— 队尾 create 与复活 create 同段（无 delete 间隔）→ 去重
    // s2：[create, update, update, data, data, data]（重复一轮全部去重）
    // s3：[create, update(截断)]（fat 整条丢弃）
    // s4：[create, update×4]（乱序 create 提到段首）
    const bySurface = new Map<string, string[]>();
    for (const op of out) {
      const sid =
        ((op as any).createSurface?.surfaceId ??
          (op as any).updateComponents?.surfaceId ??
          (op as any).updateDataModel?.surfaceId ??
          (op as any).deleteSurface?.surfaceId) as string;
      if (!bySurface.has(sid)) bySurface.set(sid, []);
      bySurface.get(sid)!.push(kind(op));
    }
    expect(bySurface.get("s1")).toEqual([
      "update",
      "update",
      "update",
      "delete",
      "create",
      "update",
    ]);
    expect(bySurface.get("s2")).toEqual([
      "create",
      "update",
      "update",
      "data",
      "data",
      "data",
    ]);
    expect(bySurface.get("s3")).toEqual(["create", "update"]);
    expect(bySurface.get("s4")).toEqual([
      "create",
      "update",
      "update",
      "update",
      "update",
    ]);
    // 全局顺序按 surface 首现分组：s1 → s2 → s3 → s4
    expect(out.map(kind)).toEqual([
      "update", "update", "update", "delete", "create", "update",
      "create", "update", "update", "data", "data", "data",
      "create", "update",
      "create", "update", "update", "update", "update",
    ]);
  });
});
