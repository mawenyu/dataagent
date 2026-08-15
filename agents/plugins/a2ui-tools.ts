/**
 * dataagent.a2ui-tools — A2UI 生成式 UI 工具注册（真实 tool.transform，非 prompt 契约）。
 *
 * 背景（2026-08-15 实测）：render_a2ui / render_report 等之前只靠 gateway 的
 * <tool_call> prompt 契约 —— 模型以原生 tool call 形式调用时 opencode 没有注册
 * 这些工具，provider 按名调用得到 "Unknown tool"。本插件把 5 个 UI 工具注册进
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
const GATEWAY = process.env.AGUI_GATEWAY_URL ?? "http://127.0.0.1:8090"
const { Plugin } = await import(`${FORK}/packages/plugin/src/promise/index.ts`)

// 与 gateway A2UiBridgeService.ALLOWED_COMPONENTS + 前端 dataAgentCatalog 严格同源：
// 18 个 basic catalog 组件 + 10 个自定义组件（2026-08-15 补 Video/AudioPlayer/Modal ——
// 此前插件漏列导致模型不知道这三个组件可用）
const CATALOG_COMPONENTS =
  "Text,Image,Icon,Video,AudioPlayer,Row,Column,List,Card,Tabs,Divider,Modal," +
  "Button,TextField,CheckBox,ChoicePicker,Slider,DateTimeInput," +
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
          `components 传空数组 = 关闭该 surface（从聊天中移除看板）；` +
          `数据尽量放 data 并用 {path} 绑定。数字报告类需求优先用 render_report。` +
          ` 关键 props 契约（严格遵守，不要自创字段名）：` +
          `Text{text,variant?}; Image{url,description?}; Icon{name}; Video/AudioPlayer{url}; ` +
          `Row/Column/List{children:[id],justify?,align?}; Card{child:id 单个}; ` +
          `Tabs{tabs:[{title,child:id}]}; Modal{trigger:id,content:id}; ` +
          `Button{child:文本组件id,variant?,action:{event:{name,context?}}}; ` +
          `TextField{label,value:{path}}; CheckBox{label,value:{path}}; ` +
          `ChoicePicker{label,options:[{value,label}],value:{path}}; Slider{label,min,max,value:{path}}; ` +
          `DateTimeInput{label,enableDate,enableTime,value:{path}}; ` +
          `MetricCard{title,value,delta?,trend?}; DataTable{columns:[{key,label}],rows}; ` +
          `BarChart/LineChart{title,xField,yField,data}; PieChart{title,labelField,valueField,data}; ` +
          `Badge{text,variant?}; Markdown{text}; InsightCard{title,text,variant?}; WarningCard{title,text}; ` +
          `ActionButton{label,variant?,action:{event:{name,context?}}}。` +
          ` 表单校验：表单组件（TextField/CheckBox/ChoicePicker/Slider/DateTimeInput/Button）支持 ` +
          `checks:[{call,args,message}] 声明前端即时校验规则（无需回传服务端）——` +
          `call 可用 required/regex/length/numeric/email/greaterThan/lessThan/contains 等，` +
          `args 里用 {path} 引用 data 字段，例：` +
          `checks:[{call:"required",args:{value:{path:"keyword"}},message:"关键词必填"}]；` +
          `校验失败字段红框+错误文案，带 checks 的 Button 自动 disabled。`,
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
          // P5-1: 回执先过 gateway 裁决（POST /a2ui/validate，与 render 同一校验
          // 管线）——被拒时如实告知模型原因并可纠正重试，不再自称"已渲染"。
          // gateway 不可达时回退乐观回执（本地开发/部署顺序容错）。
          try {
            const res = await fetch(`${GATEWAY}/a2ui/validate`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(args),
              signal: AbortSignal.timeout(3000),
            })
            if (res.ok) {
              const verdict = (await res.json()) as { ok: boolean; reason?: string }
              if (!verdict.ok) {
                return {
                  output: { status: "rejected", surfaceId: args.surfaceId ?? "" },
                  content:
                    `Surface NOT rendered — gateway rejected it: ${verdict.reason}. ` +
                    `Do NOT claim it was rendered. Fix the components (whitelist: ${CATALOG_COMPONENTS}) and call render_a2ui again.`,
                }
              }
            }
          } catch {
            // gateway 不可达 → 乐观回执（原行为）
          }
          return ok(args.surfaceId, `${args.components.length} components`)
        },
      })

      // ---- request_user_confirm: HITL 确认（vision-P3，interrupt/resume）----
      // agent 调即中断：gateway 渲染确认卡片并结束本轮；用户点击经 A2UI action
      // 以新 run 回传 hitl_confirm/hitl_cancel（context.actionId 关联）。
      tools.add({
        name: "request_user_confirm",
        options: { codemode: false },
        description:
          `在执行不可逆/高风险操作（删除文件、覆盖数据、批量修改等）之前请求用户确认。` +
          `调用后必须立即结束本轮回复（简短说明在等待用户确认即可，不要继续执行该操作）；` +
          `用户的选择会通过后续消息回传（hitl_confirm / hitl_cancel，context.actionId 与本次调用一致），` +
          `收到 hitl_confirm 才执行操作，收到 hitl_cancel 则放弃并告知用户。`,
        input: {
          type: "object",
          properties: {
            actionId: { type: "string", description: "待决操作的稳定 id（[A-Za-z0-9_-]，如 del-sales-csv）" },
            title: { type: "string", description: "确认卡片标题（如 删除确认）" },
            message: { type: "string", description: "向用户说明将执行的操作与后果" },
            confirmLabel: { type: "string", description: "确认按钮文案（默认 确认）" },
            cancelLabel: { type: "string", description: "取消按钮文案（默认 取消）" },
          },
          required: ["actionId", "title", "message"],
          additionalProperties: false,
        },
        output: {
          type: "object",
          properties: { status: { type: "string" }, surfaceId: { type: "string" } },
          required: ["status", "surfaceId"],
          additionalProperties: false,
        },
        execute: async (args: { actionId: string }) => ({
          output: { status: "awaiting_user", surfaceId: `hitl-${args.actionId ?? ""}` },
          content: "Confirmation card shown to the user. END your turn now and wait for the user's choice (hitl_confirm/hitl_cancel).",
        }),
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
