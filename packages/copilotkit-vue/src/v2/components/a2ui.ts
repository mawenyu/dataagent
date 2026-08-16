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
 *     not found"）；按 surface 分段归一化（createSurface 提段首），
 *     deleteSurface 是段屏障不被越过（第三批修订，复活序列语义）。
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

/** per-surface 段内归一化：字节级去重 + createSurface 提段首。 */
function normalizeSegment(
  segment: A2UIOperation[],
  warn: (what: string) => void,
): A2UIOperation[] {
  const seen = new Set<string>();
  let create: A2UIOperation | null = null;
  const rest: A2UIOperation[] = [];
  for (const op of segment) {
    // key 必须取自截断后的 op：截断后逐字节相同 = 渲染结果相同，理应去重
    const json = JSON.stringify(op);
    if (seen.has(json)) {
      warn("duplicate op (byte-identical, likely replay overlap) — dropped");
      continue;
    }
    seen.add(json);
    if ("createSurface" in op) {
      if (create) {
        const sid = (op.createSurface as { surfaceId?: unknown })?.surfaceId;
        warn(`duplicate createSurface for surface '${sid}' within one segment — dropped`);
        continue;
      }
      create = op;
      continue;
    }
    rest.push(op);
  }
  return create ? [create, ...rest] : rest;
}

/**
 * 第三批（2026-08-16）：per-surface 分段归一化，deleteSurface 是段屏障。
 *
 * 第二批的全局 rank 排序（create 一律提前 / delete 一律押后）在
 * [create, delete, create] 复活序列上双重出错：吞掉复活 create、
 * 把 delete 挪到复活之后（终态 = 面被删，内容全丢）。正确语义：
 * 任何归一化都不得越过同 surface 的 deleteSurface —— 段内才把
 * createSurface 提到段首并做字节级去重。
 */
function normalizeA2uiOperations(
  ops: A2UIOperation[],
  warn: (what: string) => void,
): A2UIOperation[] {
  const surfaceOrder: string[] = [];
  const bySurface = new Map<string, A2UIOperation[]>();
  for (const op of ops) {
    const sid = getOperationSurfaceId(op);
    if (!bySurface.has(sid)) {
      bySurface.set(sid, []);
      surfaceOrder.push(sid);
    }
    bySurface.get(sid)!.push(op);
  }
  const out: A2UIOperation[] = [];
  for (const sid of surfaceOrder) {
    let segment: A2UIOperation[] = [];
    const flush = () => {
      if (segment.length) out.push(...normalizeSegment(segment, warn));
      segment = [];
    };
    for (const op of bySurface.get(sid)!) {
      if ("deleteSurface" in op) {
        flush();
        out.push(op); // 段屏障：delete 保持原位，归一化不得越过
      } else {
        segment.push(op);
      }
    }
    flush();
  }
  return out;
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

  // ---- 第二批/第三批管线：体积闸口 → 截断 → 分段归一化 ----

  // 1) 整条 op 超硬上限 → 整条丢弃。
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
    return true;
  });

  // 2) 超长 string 截断（必须在去重之前：去重 key 取自截断后的 op）。
  ops = ops.map((op) => {
    const counter = { count: 0 };
    const next = truncateLongStrings(op, maxStringChars, counter);
    if (counter.count > 0) {
      console.warn(
        `[A2UI Vue] truncated ${counter.count} oversized string value(s) beyond ${maxStringChars} chars`,
      );
    }
    return next as A2UIOperation;
  });

  // 3+4) per-surface 分段归一化：deleteSurface 为段屏障，段内字节级
  //      去重 + createSurface 提段首（见 normalizeA2uiOperations 注释）。
  return normalizeA2uiOperations(ops, warn);
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
