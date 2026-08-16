import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { safeParseActivityContent } from "../activity-parse-cache";

/**
 * 收尾2（FORK#24）：activity 消息的 zod safeParse 按 (message, content引用) 记忆化。
 * 定位证据：CDP profiler 实锤流式期间热点 = zod _parse/_parseSync +
 * zod-to-json-schema（长 reasoning 每个 delta 重渲消息列表 → 每条 activity
 * 消息全量 safeParse 大 discriminated union → GC 抖动、秒级冻结）。
 */
describe("safeParseActivityContent", () => {
  const schema = z.object({ ops: z.array(z.object({ op: z.string() })) });

  it("content 引用不变 → 只 parse 一次（渲染多少次都一样）", () => {
    const spy = vi.spyOn(schema, "safeParse");
    const message = { id: "a1" };
    const content = { ops: [{ op: "createSurface" }] };

    const r1 = safeParseActivityContent(schema, message, content);
    const r2 = safeParseActivityContent(schema, message, content);
    const r3 = safeParseActivityContent(schema, message, content);

    expect(r1.success).toBe(true);
    expect(r2).toBe(r1); // 同一次结果
    expect(r3).toBe(r1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("content 引用变化 → 重新 parse（ACTIVITY_SNAPSHOT 更新必须生效）", () => {
    const spy = vi.spyOn(schema, "safeParse");
    const message = { id: "a1" };
    const c1 = { ops: [{ op: "createSurface" }] };
    const c2 = { ops: [{ op: 123 }] }; // op 非 string → 校验失败

    const r1 = safeParseActivityContent(schema, message, c1);
    const r2 = safeParseActivityContent(schema, message, c2);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(false);
  });

  it("不同 message 各自缓存（互不串）", () => {
    const spy = vi.spyOn(schema, "safeParse");
    const m1 = { id: "a1" };
    const m2 = { id: "a2" };
    const content = { ops: [] };

    safeParseActivityContent(schema, m1, content);
    safeParseActivityContent(schema, m2, content);
    safeParseActivityContent(schema, m1, content);
    safeParseActivityContent(schema, m2, content);
    expect(spy).toHaveBeenCalledTimes(2); // 每条消息一次
  });
});
