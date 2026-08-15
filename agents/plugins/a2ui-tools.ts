/**
 * dataagent.a2ui-tools — A2UI 生成式 UI 工具注册（真实 tool.transform，非 prompt 契约）。
 *
 * 背景（2026-08-15 实测）：render_a2ui / render_report 等之前只靠 gateway 的
 * <tool_call> prompt 契约 —— 模型以原生 tool call 形式调用时 opencode 没有注册
 * 这些工具，provider 按名调用得到 "Unknown tool"。本插件把 4 个 UI 工具注册进
 * opencode（codemode:false，否则只经 CodeMode 暴露，按名调用仍 Unknown tool）。
 *
 * 职责划分：
 * - opencode 端（本插件）：注册工具定义（input schema 即模型可见的契约）、
 *   execute 做轻量校验并回执结构化结果（模型据此继续叙述）。
 * - gateway 端（AguiEventTranslator/A2UiBridgeService/ReportRenderer 等）：
 *   在 session.tool.called 事件拦截同名调用，确定性展开/校验后产 ACTIVITY_SNAPSHOT
 *   （真正的 UI 事件）——UI 渲染逻辑单一真源在 Java 侧，本插件不复制。
 *
 * 依赖解析：fork 源码优先（OPENCODE_FORK_PATH 可覆盖），与运行中的 v2 分支
 * 插件 API 严格同源（npm 包 1.18.15 是旧 API，无 tool.transform）。
 */
const FORK = process.env.OPENCODE_FORK_PATH ?? "/home/ubuntu/opencode-fork"
const { Plugin } = await import(`${FORK}/packages/plugin/src/promise/index.ts`)

const CATALOG_COMPONENTS =
  "Text,Image,Icon,Row,Column,List,Card,Tabs,Divider,Button,TextField,CheckBox,ChoicePicker,Slider,DateTimeInput," +
  "MetricCard,DataTable,BarChart,LineChart,PieChart,InsightCard,WarningCard,ActionButton,Badge,Markdown"

const ok = (surfaceId: string, detail: string) => ({
  output: { status: "rendered", surfaceId },
  content: `UI surface "${surfaceId}" rendered (${detail}). The user can already see it; do NOT paste the JSON back into chat.`,
})

export default Plugin.define({
  id: "dataagent.a2ui-tools",
  setup: async (ctx) => {
    await ctx.tool.transform((tools) => {
      // ---- render_a2ui: 声明式 surface（组件树 + 数据模型）----
      tools.add({
        name: "render_a2ui",
        options: { codemode: false },
        description:
          `在用户聊天中渲染一个 A2UI UI surface（看板/表单/卡片等）。` +
          `组件只能用 catalog 白名单: ${CATALOG_COMPONENTS}。` +
          `components 是扁平数组（每个含 component+id，children 用 id 引用，root 的 id 必须是 "root"），` +
          `数据尽量放 data 并用 {path} 绑定。数字报告类需求优先用 render_report。`,
        input: {
          type: "object",
          properties: {
            surfaceId: { type: "string", description: "稳定的 surface id；同名即就地更新" },
            components: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  component: { type: "string" },
                  id: { type: "string" },
                },
                required: ["component", "id"],
                additionalProperties: true,
              },
              description: "A2UI v0.9 扁平组件列表",
            },
            data: { type: "object", additionalProperties: true, description: "surface 数据模型（可选）" },
            catalogId: { type: "string", description: "可省略，默认 data-agent catalog" },
          },
          required: ["surfaceId", "components"],
          additionalProperties: false,
        },
        output: {
          type: "object",
          properties: { status: { type: "string" }, surfaceId: { type: "string" } },
          required: ["status", "surfaceId"],
          additionalProperties: false,
        },
        execute: async (args: { surfaceId: string; components: unknown[]; data?: unknown; catalogId?: string }) => {
          if (!Array.isArray(args.components) || args.components.length === 0) {
            return { output: { status: "error", surfaceId: args.surfaceId ?? "" }, content: "components 不能为空" }
          }
          return ok(args.surfaceId, `${args.components.length} components`)
        },
      })

      // ---- render_report: 数字报告（服务端真实聚合 CSV）----
      tools.add({
        name: "render_report",
        options: { codemode: false },
        description:
          "渲染一份数据报告（KPI 卡 + 图表 + 明细表）。你只给选择集，" +
          "数字由服务端从 workspace CSV 真实计算 —— 禁止自己算数或手写组件 JSON。",
        input: {
          type: "object",
          properties: {
            title: { type: "string" },
            dataFile: { type: "string", description: "workspace 内 CSV 文件名（如 sales-2026-08.csv）" },
            kpis: {
              type: "array",
              items: { type: "string", enum: ["totalSales", "orderCount", "avgOrderValue", "totalQuantity", "topRegion", "topCategory"] },
            },
            charts: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["bar", "line", "pie"] },
                  groupBy: { type: "string", enum: ["region", "category", "date", "channel"] },
                  title: { type: "string" },
                },
                required: ["type", "groupBy"],
                additionalProperties: false,
              },
            },
            table: {
              type: "object",
              properties: {
                groupBy: { type: "string", enum: ["region", "category", "date", "channel"] },
                title: { type: "string" },
              },
              required: ["groupBy"],
              additionalProperties: false,
            },
            actions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  event: { type: "string" },
                  context: { type: "object", additionalProperties: true },
                },
                required: ["label", "event"],
                additionalProperties: false,
              },
            },
            surfaceId: { type: "string" },
          },
          required: ["title", "dataFile"],
          additionalProperties: false,
        },
        output: {
          type: "object",
          properties: { status: { type: "string" }, surfaceId: { type: "string" } },
          required: ["status", "surfaceId"],
          additionalProperties: false,
        },
        execute: async (args: { title: string; dataFile: string; surfaceId?: string }) => {
          const sid = args.surfaceId ?? "report"
          return ok(sid, `report "${args.title}" from ${args.dataFile}`)
        },
      })

      // ---- render_slides: 演示文稿（Tabs surface）----
      tools.add({
        name: "render_slides",
        options: { codemode: false },
        description:
          "把内容渲染成分页演示文稿（每页一个 tab）。bullets 是纯文本要点，note 是演讲备注。",
        input: {
          type: "object",
          properties: {
            title: { type: "string" },
            slides: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  heading: { type: "string" },
                  bullets: { type: "array", items: { type: "string" } },
                  note: { type: "string" },
                },
                required: ["heading", "bullets"],
                additionalProperties: false,
              },
            },
            surfaceId: { type: "string" },
          },
          required: ["title", "slides"],
          additionalProperties: false,
        },
        output: {
          type: "object",
          properties: { status: { type: "string" }, surfaceId: { type: "string" } },
          required: ["status", "surfaceId"],
          additionalProperties: false,
        },
        execute: async (args: { title: string; slides: unknown[]; surfaceId?: string }) => {
          const sid = args.surfaceId ?? "slides"
          return ok(sid, `${args.slides?.length ?? 0} slides`)
        },
      })

      // ---- update_canvas: 研究/文档画布（可追加的就地更新 surface）----
      tools.add({
        name: "update_canvas",
        options: { codemode: false },
        description:
          "把结构化内容（研究报告/文档）写入画布 surface。同名 surfaceId 就地更新；" +
          "append=true 时新 sections 追加到现有内容之后。",
        input: {
          type: "object",
          properties: {
            title: { type: "string" },
            sections: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  heading: { type: "string" },
                  markdown: { type: "string" },
                },
                required: ["heading", "markdown"],
                additionalProperties: false,
              },
            },
            append: { type: "boolean" },
            surfaceId: { type: "string" },
          },
          required: ["title", "sections"],
          additionalProperties: false,
        },
        output: {
          type: "object",
          properties: { status: { type: "string" }, surfaceId: { type: "string" } },
          required: ["status", "surfaceId"],
          additionalProperties: false,
        },
        execute: async (args: { title: string; sections: unknown[]; append?: boolean; surfaceId?: string }) => {
          const sid = args.surfaceId ?? "canvas"
          return ok(sid, `${args.sections?.length ?? 0} sections${args.append ? " appended" : ""}`)
        },
      })
    })
  },
})
