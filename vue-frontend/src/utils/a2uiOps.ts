/**
 * A2UI 消息内容扫描工具（布局分栏：对话栏引用卡 + 中央工作区共用）。
 *
 * 容错对齐 fork 侧 sanitize 语义：非对象条目跳过；surfaceId 覆盖
 * 顶层/beginRendering/surfaceUpdate/dataModelUpdate/deleteSurface/
 * createSurface/updateComponents/updateDataModel 各形态（与 fork
 * getOperationSurfaceId 同序）。只读扫描，不修改 ops。
 */

export interface A2uiOpScan {
  surfaceIds: string[] // 去重、按出现顺序
  componentCount: number // updateComponents/surfaceUpdate 里组件总数
}

function opSurfaceId(op: Record<string, unknown>): string {
  const v =
    (op.surfaceId as string | undefined) ??
    (op.beginRendering as { surfaceId?: string } | undefined)?.surfaceId ??
    (op.surfaceUpdate as { surfaceId?: string } | undefined)?.surfaceId ??
    (op.dataModelUpdate as { surfaceId?: string } | undefined)?.surfaceId ??
    (op.deleteSurface as { surfaceId?: string } | undefined)?.surfaceId ??
    (op.createSurface as { surfaceId?: string } | undefined)?.surfaceId ??
    (op.updateComponents as { surfaceId?: string } | undefined)?.surfaceId ??
    (op.updateDataModel as { surfaceId?: string } | undefined)?.surfaceId
  return v ?? 'default'
}

function opComponentCount(op: Record<string, unknown>): number {
  const u1 = op.updateComponents as { components?: unknown } | undefined
  if (Array.isArray(u1?.components)) return u1.components.length
  const u2 = op.surfaceUpdate as { components?: unknown } | undefined
  if (Array.isArray(u2?.components)) return u2.components.length
  return 0
}

export function scanA2uiOps(ops: unknown): A2uiOpScan {
  const surfaceIds: string[] = []
  let componentCount = 0
  if (Array.isArray(ops)) {
    for (const raw of ops) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const op = raw as Record<string, unknown>
      const sid = opSurfaceId(op)
      if (!surfaceIds.includes(sid)) surfaceIds.push(sid)
      componentCount += opComponentCount(op)
    }
  }
  return { surfaceIds, componentCount }
}

/** activity message 是否为 a2ui-surface 且带可用 payload。 */
export function isA2uiSurfaceMessage(m: unknown): boolean {
  if (!m || typeof m !== 'object') return false
  const msg = m as { role?: unknown; activityType?: unknown; content?: unknown }
  if (msg.role !== 'activity' || msg.activityType !== 'a2ui-surface') return false
  const ops = (msg.content as { a2ui_operations?: unknown } | undefined)?.a2ui_operations
  return Array.isArray(ops) && ops.length > 0
}
