/**
 * acme.demo — 一个插件同时演示 5 种能力：
 *  1) tool.transform    加 timestamp 工具
 *  2) agent.transform   修改文件定义的 explorer 子 agent 的 description
 *  3) skill（文件方式） .opencode/skills/hello-skill/SKILL.md（本插件不重复注册）
 *  4) command.transform 加 /demo-review 命令
 *  5) tool.hook         execute.before 打日志到 stderr（验证 hook 触发）
 *
 * 依赖解析：直接相对引用 monorepo 源码（免 bun add @opencode-ai/plugin）。
 */
import { Plugin } from "/home/ubuntu/opencode-v2-verify/packages/plugin/src/promise/index.ts"

export default Plugin.define({
  id: "acme.demo",
  setup: async (ctx) => {
    // ---- 1) tool: timestamp ----
    await ctx.tool.transform((tools) => {
      tools.add({
        name: "timestamp",
        // codemode 默认 true 时工具只经 CodeMode execute 暴露；设为 false 才能
        // 让 provider 直接按名调用（否则模型收到 Unknown tool）。
        options: { codemode: false },
        description: "返回当前服务器时间（ISO 8601）和 Unix 毫秒时间戳",
        input: {
          type: "object",
          properties: {
            timezone: { type: "string", description: "时区标签，仅用于展示" },
          },
          additionalProperties: false,
        },
        output: {
          type: "object",
          properties: {
            iso: { type: "string" },
            epochMs: { type: "number" },
          },
          required: ["iso", "epochMs"],
          additionalProperties: false,
        },
        execute: async ({ timezone }: { timezone?: string }) => {
          const now = new Date()
          const iso = timezone ? `${now.toISOString()} (${timezone})` : now.toISOString()
          const out = { iso, epochMs: now.getTime() }
          return {
            output: out,
            content: `当前时间: ${out.iso} (epochMs=${out.epochMs})`,
          }
        },
      })
    })

    // ---- 2) agent.transform: 插件方式新建子 agent（展示与文件方式互补）----
    // 注意（实测坑）：对文件已定义的 agent 改 description 会被后加载的文件配置
    // 覆盖 —— 插件 transform 适合新建或改非文件字段。
    await ctx.agent.transform((agents) => {
      agents.update("summarizer", (agent) => {
        agent.mode = "subagent"
        agent.description = "中文摘要子 agent（插件 acme.demo 动态定义）"
        agent.system = "你是 summarizer：把输入内容压缩成不超过 5 条要点的中文摘要。"
      })
    })

    // ---- 4) command.transform: /demo-review ----
    await ctx.command.transform((commands) => {
      commands.update("demo-review", (command) => {
        command.description = "演示命令：快速审查当前项目结构（插件注册）"
        command.template =
          "列出当前项目目录结构，指出每个文件的用途，最后给出一段简短的项目健康度评价。"
      })
    })

    // ---- 5) hook: execute.before 打日志 ----
    await ctx.tool.hook("execute.before", (event) => {
      console.error(
        `[acme.demo hook] execute.before tool=${event.tool} input=${JSON.stringify(event.input)?.slice(0, 200)}`,
      )
    })
  },
})
