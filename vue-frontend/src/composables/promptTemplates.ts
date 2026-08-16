/**
 * P-b: 提示词模板 / 快捷指令（共享数据源）。
 *
 * 两组：开场模板（欢迎页场景卡，填充输入框可编辑再发）与追问指令
 *（会话进行中顶栏 ✨ 模板面板，点击直接作为 user 消息发送）。
 * 数据源唯一 —— 欢迎页卡片与快捷面板都从 PROMPT_TEMPLATES 派生，防漂移。
 */

export interface PromptTemplate {
  id: string
  title: string
  desc: string
  prompt: string
  group: '开场' | '追问'
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  // ---- 开场（P-D 既有四卡的文案原样迁移，id 新增） ----
  {
    id: 'op-sales',
    group: '开场',
    title: '销售分析',
    desc: '总额 / 区域排名 / 品类结构',
    prompt: '分析本月销售情况：总销售额、各区域销售额排名、品类销售结构，并指出值得关注的异常波动。',
  },
  {
    id: 'op-dashboard',
    group: '开场',
    title: '可视化看板',
    desc: '指标卡 + 图表直观呈现',
    prompt: '分析本月各区域销售额，用图表看板展示：顶部核心指标卡，下方销售额柱状图与占比图。',
  },
  {
    id: 'op-weekly',
    group: '开场',
    title: '周报生成',
    desc: '核心指标 + 趋势 + 风险',
    prompt: '根据 workspace 里的销售数据生成本周周报：核心指标一览、按日趋势变化、同比异常点与风险提示，用 Markdown 格式输出。',
  },
  {
    id: 'op-clean',
    group: '开场',
    title: '数据清洗',
    desc: '缺失 / 重复 / 异常值体检',
    prompt: '检查 workspace 里 CSV 文件的数据质量：缺失值、重复行、明显异常值，给出清洗建议，并生成清洗后的新文件。',
  },
  // ---- 追问（会话中途的快捷指令） ----
  {
    id: 'fu-summary',
    group: '追问',
    title: '一句话总结',
    desc: '结论 + 3 个关键数据点',
    prompt: '用一句话总结上述结论，并列出最关键的 3 个数据点。',
  },
  {
    id: 'fu-risk',
    group: '追问',
    title: '最关键的风险',
    desc: '解释原因 + 给建议',
    prompt: '指出上述分析中最值得关注的一个风险，解释原因并给出应对建议。',
  },
  {
    id: 'fu-report',
    group: '追问',
    title: '整理成报告',
    desc: 'Markdown 周报格式',
    prompt: '把本轮分析整理成 Markdown 报告格式输出：结论先行，关键指标列表，风险与建议。',
  },
  {
    id: 'fu-chart',
    group: '追问',
    title: '图表重新呈现',
    desc: '关键指标 → 看板',
    prompt: '把上述结论里的关键指标用图表看板重新呈现：顶部指标卡，下方趋势与占比图。',
  },
]

export function templatesByGroup(group: PromptTemplate['group']): PromptTemplate[] {
  return PROMPT_TEMPLATES.filter((t) => t.group === group)
}
