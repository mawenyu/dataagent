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
 */
export function sanitizeA2uiOperations(input: unknown): A2UIOperation[] {
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

  if (Array.isArray(input)) return keepObjects(input);

  if (typeof input === "string") {
    const text = input.trim();
    if (!text) return [];
    // Whole-string JSON first (single op or a JSON array), then JSONL.
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) return keepObjects(parsed);
      if (parsed !== null && typeof parsed === "object") {
        return [parsed as A2UIOperation];
      }
      warn("parsed JSON is not an operation object");
      return [];
    } catch {
      /* fall through to JSONL */
    }
    const out: A2UIOperation[] = [];
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
          out.push(parsed as A2UIOperation);
        } else {
          warn(`JSONL line is not an object: ${trimmed.slice(0, 60)}`);
        }
      } catch {
        warn(`unparseable JSONL line: ${trimmed.slice(0, 60)}`);
      }
    }
    return out;
  }

  if (input !== undefined && input !== null) {
    warn(`unexpected payload type: ${typeof input}`);
  }
  return [];
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
