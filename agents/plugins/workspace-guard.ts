/**
 * dataagent.workspace-guard — workspace 写权限白名单插件（P33 二期）。
 *
 * 机制：opencode effect 插件 API（plugin loader 识别 default export 的 `effect` 键，
 * 见 fork packages/core/src/plugin/supervisor.ts），注册 tool execute.before 钩子 ——
 * 全插件体系里唯一可失败的钩子：返回 Tool.Error 即在工具执行前拒绝该调用，
 * 模型收到拒绝原因后可将产出改写进合规目录（与内置 plan 模式同款手法，
 * 见 fork packages/core/src/plugin/plan.ts）。
 *
 * 规则（只拦写类工具 write/edit/patch；read/glob/grep/shell 等不拦 ——
 * 隔离是组织性写边界，读不限）：
 *  - 目标路径在 workspace/threads/<本会话 threadId>/ 内 → 放行（自己的会话目录）
 *  - 目标在系统临时目录（os.tmpdir()）内 → 放行（中间计算 scratch）
 *  - 其余一律拒绝：共享公共区（workspace/ 根）、别的会话目录、仓库代码……
 *    拒绝消息里给出合规路径，模型可自我纠正。
 *
 * sessionID → threadId 映射：读 gateway 落盘的 data/threads.json（mtime 缓存，
 * 结构 {threads: {threadId: {sessionId}}}，见 gateway JsonThreadRepository）。
 * 查不到映射的 session（非 gateway 链路）：workspace/ 根下一律拒写，其余路径放行。
 *
 * 依赖解析与 a2ui-tools.ts 同款：fork 源码优先（OPENCODE_FORK_PATH 可覆盖）。
 * 注意 Tool.Error 靠 _tag 字符串匹配（runner Effect.catchTag("Tool.Error")），
 * 即便模块实例双载也不影响拒绝语义。
 */
import path from "node:path"
import fs from "node:fs"
import os from "node:os"

const FORK = process.env.OPENCODE_FORK_PATH ?? "/home/ubuntu/opencode-fork"
const { Plugin } = await import(`${FORK}/packages/plugin/src/effect/index.ts`)
const { Tool } = await import(`${FORK}/packages/schema/src/tool.ts`)
// effect 需与 fork 同实例（TaggedError 靠 _tag 匹配，双载其实也可，但保持同源最稳）
const { Effect } = await import(`${FORK}/packages/plugin/node_modules/effect/dist/index.js`)

/** 写类工具 → 从 input 提取目标路径列表。 */
const WRITE_TOOLS = new Set(["write", "edit", "patch"])

function targetsOf(tool: string, input: any): string[] {
  if (tool === "write" || tool === "edit") {
    return typeof input?.path === "string" ? [input.path] : []
  }
  if (tool === "patch") {
    const text = typeof input?.patchText === "string" ? input.patchText : ""
    const out: string[] = []
    for (const m of text.matchAll(/^\*\*\* (?:Add|Delete|Update) File: (.+)$/gm)) out.push(m[1].trim())
    for (const m of text.matchAll(/^\*\*\* Move to: (.+)$/gm)) out.push(m[1].trim())
    return out
  }
  return []
}

/** sessionID → threadId 反查表（data/threads.json，mtime 变化才重读）。 */
const STORE = process.env.AGUI_THREADS_STORE ?? path.join(process.cwd(), "data", "threads.json")
let cache: { mtimeMs: number; bySessionId: Map<string, string> } = { mtimeMs: -1, bySessionId: new Map() }
function threadOf(sessionID: string): string | undefined {
  try {
    const mtimeMs = fs.statSync(STORE).mtimeMs
    if (mtimeMs !== cache.mtimeMs) {
      const raw = JSON.parse(fs.readFileSync(STORE, "utf8"))
      const bySessionId = new Map<string, string>()
      for (const [threadId, entry] of Object.entries<any>(raw?.threads ?? {})) {
        if (entry?.sessionId) bySessionId.set(entry.sessionId, threadId)
      }
      cache = { mtimeMs, bySessionId }
    }
  } catch {
    // store 不可读 → 保持旧缓存（首次则空表 = 所有 session 按未知处理）
  }
  return cache.bySessionId.get(sessionID)
}

export default Plugin.define({
  id: "dataagent.workspace-guard",
  effect: (ctx) =>
    ctx.tool.hook("execute.before", (event) => {
      if (!WRITE_TOOLS.has(event.tool)) return Effect.void
      const input = event.input as any
      const targets = targetsOf(event.tool, input)
      if (targets.length === 0) return Effect.void

      const root = process.cwd()
      const workspaceRoot = path.join(root, "workspace")
      const threadId = threadOf(event.sessionID)
      const allowedDir = threadId ? path.join(workspaceRoot, "threads", threadId) : undefined
      const tmpDir = fs.realpathSync(os.tmpdir())

      for (const t of targets) {
        const abs = path.resolve(root, t)
        // 注意：workspace 根/会话目录可能尚未创建，realpath 不可用 —— 用 normalize 后的
        // 字符串前缀判定（白名单字符集保证无符号链接花样之外的穿越；组织性边界足够）。
        const inTmp = abs === tmpDir || abs.startsWith(tmpDir + path.sep)
        const inOwnDir = allowedDir != null && (abs === allowedDir || abs.startsWith(allowedDir + path.sep))
        if (inTmp || inOwnDir) continue

        const known = threadId != null
        const inWorkspace = abs === workspaceRoot || abs.startsWith(workspaceRoot + path.sep)
        // 未知 session：只护 workspace（共享区 + 所有会话目录）；其余路径放行。
        if (!known && !inWorkspace) continue

        return new Tool.Error({
          message:
            `写入被拒绝（workspace 写权限白名单）：目标 ${t} 不在允许范围内。` +
            (known
              ? `本会话只允许写入数据工作目录 workspace/threads/${threadId}/（公共数据目录 workspace/ 只读，其他会话目录不可写）。` +
                `请把产出改写到 workspace/threads/${threadId}/ 下后重试。`
              : `workspace/ 目录（含公共区与各会话目录）对本会话只读；临时文件请用 ${tmpDir}。`),
          metadata: { guard: "workspace-guard", tool: event.tool, target: t, threadId: threadId ?? null },
        }) as any
      }
      return Effect.void
    }),
})
