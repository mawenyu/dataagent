import { z } from "zod";

export type A2UIOperation = Record<string, unknown>;

export const A2UISurfaceActivityType = "a2ui-surface";

export const A2UIActivityContentSchema = z.object({
  operations: z.array(z.record(z.string(), z.unknown())),
});

/**
 * dataagent fork (2026-08-16, 协议边界降级): sanitize the raw
 * `a2ui_operations` payload before it reaches the surface processor.
 *
 * The gateway whitelist is the first line of defense, but the renderer must
 * degrade gracefully on its own: malformed entries (null / string / number /
 * nested arrays) are dropped with console.warn instead of throwing during
 * grouping (a single null entry previously killed the whole batch and even
 * the render pass). A string payload is treated as JSONL — one JSON op per
 * line, bad lines skipped — because a model emitting JSONL text instead of a
 * structured array should still render whatever lines are valid.
 *
 * 第二批（2026-08-16）：入口消毒管线再加三段 ——
 *  1. 超大 payload 截断：单条 string 超 maxStringChars 截断留 marker；
 *     整条 op 序列化超 maxOpBytes 整条丢弃（兄弟 op 不受拖累）。渲染
 *     2MB 文本在 jsdom/真浏览器都会卡，必须在上游闸口截住。
 *  2. 重复 op 去重：断连重放/快照重叠会重复送达同一批 op；逐字节相同
 *     的 op 只留第一条，同 surfaceId 的重复 createSurface 只留第一条
 *     （web_core 对重复 createSurface 直接 throw "already exists"）。
 *  3. out-of-order 归一化：乱序流里 updateComponents/updateDataModel
 *     先于 createSurface 到达时，逐 op 容错会把它们永久丢弃（"Surface
 *     not found"）；稳定地把 createSurface 提前、deleteSurface 押后，
 *     同批内容不再丢失。
 */

/** 单条 string 值上限（默认 1MB；第一批实测 300KB 正常渲染，不可误伤）。 */
const DEFAULT_MAX_STRING_CHARS = 1024 * 1024;
/** 整条 op 序列化硬上限（默认 4MB）—— 超限整条丢弃。 */
const DEFAULT_MAX_OP_BYTES = 4 * 1024 * 1024;
const TRUNCATION_MARKER = "…[truncated]";

export interface SanitizeA2uiOptions {
  maxStringChars?: number;
  maxOpBytes?: number;
}

/** 深度遍历：超长 string 截断留 marker；只有真的改了才返回新对象。 */
function truncateLongStrings(
  value: unknown,
  maxChars: number,
  counter: { count: number },
): unknown {
  if (typeof value === "string") {
    if (value.length <= maxChars) return value;
    counter.count++;
    return value.slice(0, maxChars) + TRUNCATION_MARKER;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((item) => {
      const next = truncateLongStrings(item, maxChars, counter);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? out : value;
  }
  if (value !== null && typeof value === "object") {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const next = truncateLongStrings(v, maxChars, counter);
      if (next !== v) changed = true;
      out[k] = next;
    }
    return changed ? out : value;
  }
  return value;
}

/** 稳定归一化：createSurface → 其余（保持相对序）→ deleteSurface。 */
function orderA2uiOperations(ops: A2UIOperation[]): A2UIOperation[] {
  const rank = (op: A2UIOperation) =>
    "createSurface" in op ? 0 : "deleteSurface" in op ? 2 : 1;
  return ops
    .map((op, index) => ({ op, index }))
    .sort((a, b) => rank(a.op) - rank(b.op) || a.index - b.index)
    .map((entry) => entry.op);
}

export function sanitizeA2uiOperations(
  input: unknown,
  opts?: SanitizeA2uiOptions,
): A2UIOperation[] {
  const maxStringChars = opts?.maxStringChars ?? DEFAULT_MAX_STRING_CHARS;
  const maxOpBytes = opts?.maxOpBytes ?? DEFAULT_MAX_OP_BYTES;
  const warn = (what: string) =>
    console.warn(`[A2UI Vue] dropping malformed operation payload: ${what}`);

  const keepObjects = (items: unknown[]): A2UIOperation[] => {
    const out: A2UIOperation[] = [];
    for (const item of items) {
      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        out.push(item as A2UIOperation);
      } else {
        warn(
          `non-object entry (${Array.isArray(item) ? "array" : String(item === null ? "null" : typeof item)})`,
        );
      }
    }
    return out;
  };

  let ops: A2UIOperation[];
  if (Array.isArray(input)) {
    ops = keepObjects(input);
  } else if (typeof input === "string") {
    const text = input.trim();
    if (!text) return [];
    // Whole-string JSON first (single op or a JSON array), then JSONL.
    let parsedWhole: unknown;
    let wholeOk = false;
    try {
      parsedWhole = JSON.parse(text);
      wholeOk = true;
    } catch {
      /* fall through to JSONL */
    }
    if (wholeOk) {
      if (Array.isArray(parsedWhole)) {
        ops = keepObjects(parsedWhole);
      } else if (parsedWhole !== null && typeof parsedWhole === "object") {
        ops = [parsedWhole as A2UIOperation];
      } else {
        warn("parsed JSON is not an operation object");
        return [];
      }
    } else {
      ops = [];
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed: unknown = JSON.parse(trimmed);
          if (
            parsed !== null &&
            typeof parsed === "object" &&
            !Array.isArray(parsed)
          ) {
            ops.push(parsed as A2UIOperation);
          } else {
            warn(`JSONL line is not an object: ${trimmed.slice(0, 60)}`);
          }
        } catch {
          warn(`unparseable JSONL line: ${trimmed.slice(0, 60)}`);
        }
      }
    }
  } else {
    if (input !== undefined && input !== null) {
      warn(`unexpected payload type: ${typeof input}`);
    }
    return [];
  }

  // ---- 第二批管线：体积闸口 → 截断 → 去重 → 归一化 ----

  // 1) 整条 op 超硬上限 → 整条丢弃（序列化一次，去重阶段复用）。
  const serialized = new Map<A2UIOperation, string>();
  ops = ops.filter((op) => {
    let json: string;
    try {
      json = JSON.stringify(op);
    } catch {
      warn("op is not serializable (circular?) — dropped");
      return false;
    }
    if (json.length > maxOpBytes) {
      warn(`op exceeds ${maxOpBytes}B hard cap (${json.length}B) — dropped`);
      return false;
    }
    serialized.set(op, json);
    return true;
  });

  // 2) 超长 string 截断（截后 op 变了，序列化缓存失效，去重重新算）。
  ops = ops.map((op) => {
    const counter = { count: 0 };
    const next = truncateLongStrings(op, maxStringChars, counter);
    if (counter.count > 0) {
      console.warn(
        `[A2UI Vue] truncated ${counter.count} oversized string value(s) beyond ${maxStringChars} chars`,
      );
      serialized.delete(op);
    }
    return next as A2UIOperation;
  });

  // 3) 重复去重：逐字节相同的 op 只留第一条；同 surfaceId 的重复
  //    createSurface 只留第一条（web_core 对重复 createSurface 会 throw）。
  const seenJson = new Set<string>();
  const seenSurfaces = new Set<string>();
  ops = ops.filter((op) => {
    const json = serialized.get(op) ?? JSON.stringify(op);
    if (seenJson.has(json)) {
      warn("duplicate op (byte-identical, likely replay overlap) — dropped");
      return false;
    }
    seenJson.add(json);
    const cs = op.createSurface as { surfaceId?: unknown } | undefined;
    if (cs && typeof cs.surfaceId === "string") {
      if (seenSurfaces.has(cs.surfaceId)) {
        warn(`duplicate createSurface for surface '${cs.surfaceId}' — dropped`);
        return false;
      }
      seenSurfaces.add(cs.surfaceId);
    }
    return true;
  });

  // 4) out-of-order 归一化：createSurface 稳定提前、deleteSurface 押后。
  return orderA2uiOperations(ops);
}

export function getOperationSurfaceId(operation: A2UIOperation): string {
  const surfaceId =
    (operation.surfaceId as string | undefined) ??
    ((operation.beginRendering as { surfaceId?: string } | undefined)
      ?.surfaceId as string | undefined) ??
    ((operation.surfaceUpdate as { surfaceId?: string } | undefined)
      ?.surfaceId as string | undefined) ??
    ((operation.dataModelUpdate as { surfaceId?: string } | undefined)
      ?.surfaceId as string | undefined) ??
    ((operation.deleteSurface as { surfaceId?: string } | undefined)
      ?.surfaceId as string | undefined) ??
    ((operation.createSurface as { surfaceId?: string } | undefined)
      ?.surfaceId as string | undefined) ??
    ((operation.updateComponents as { surfaceId?: string } | undefined)
      ?.surfaceId as string | undefined) ??
    ((operation.updateDataModel as { surfaceId?: string } | undefined)
      ?.surfaceId as string | undefined);

  return surfaceId ?? "default";
}
