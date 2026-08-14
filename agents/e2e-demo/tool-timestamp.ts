// v1 自定义工具（4096 打包二进制的 v2 plugin API 无 tool domain，
// tool 走 v1 约定：.config/opencode/tool/*.ts + tool() 定义）
import { tool } from "@opencode-ai/plugin/tool"

export default tool({
  description: "返回当前服务器时间（ISO 8601）和 Unix 毫秒时间戳",
  args: {
    timezone: tool.schema.string().optional().describe("时区标签，仅用于展示"),
  },
  async execute(args) {
    const now = new Date()
    const iso = args.timezone ? `${now.toISOString()} (${args.timezone})` : now.toISOString()
    return `当前时间: ${iso} (epochMs=${now.getTime()})`
  },
})
