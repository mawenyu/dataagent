# SPEC: CopilotKit 官方 example 能力 → DataAgent 真实功能

> 状态：进行中（2026-08-15）。任务书：/tmp/claude-task5.txt 任务 B。
> 参考实现调研：ref/copilotkit-examples/showcases/{spreadsheet,presentation,research-canvas,banking,generative-ui*}。
> 红线：全部接真实 agent（opencode2 → DeepSeek），禁 mock 数据。

## 总设计原则（banking 示例的核心教训）

**模型只产"小选择集"，gateway 代码确定性展开成 A2UI ops** —— 不让模型手写大段组件 JSON
（实测：模型写 18 组件的大 JSON 会产出 bracket 不匹配的不合法 JSON，见
docs/evidence/2026-08-15-a2ui-all-components.txt 注）。确定性展开器可单测、零幻觉、零注入。

## B1. render_report（generative-ui / banking 模式）✅ 已完成（2026-08-15）

模型输出 `{title, kpis[], charts[], table?}` 选择集；gateway 用 workspace 真实数据
计算指标并展开为 A2UI surface。

### 接口契约

server tool `render_report`，arguments：
```json
{
  "surfaceId": "sales-report",          // 可选，默认 "report"
  "title": "八月销售报告",
  "dataFile": "sales-2026-08.csv",      // workspace 内文件（白名单名校验）
  "kpis": ["totalSales", "orderCount", "avgOrderValue", "topRegion", "topCategory"],
  "charts": [
    {"type": "bar",  "groupBy": "region",   "title": "区域销售额"},
    {"type": "line", "groupBy": "date",     "title": "每日趋势"},
    {"type": "pie",  "groupBy": "category", "title": "品类占比"}
  ],
  "table": {"groupBy": "region", "title": "区域明细"},
  "actions": [{"label": "下钻华北", "event": "drill_down", "context": {"region": "华北"}}]
}
```
- kpis 枚举：totalSales/orderCount/avgOrderValue/totalQuantity/topRegion/topCategory（未知项跳过并告警）
- groupBy 枚举：region/category/date/channel（CSV 列名映射：区域/品类/日期/渠道；未知列 → 400 级拒绝该 chart 并告警）
- gateway 解析 CSV（列头自动识别：销售额/数量/单价列必须存在，缺失则返回错误文本而非崩）

### 展开结果
ACTIVITY_SNAPSHOT：Column root → Row(MetricCard×N) → BarChart/LineChart/PieChart →
DataTable → ActionButton×M；数据全部内联（gateway 算好的真实聚合值），不用 {path}。

### 验收
- 单测：假 CSV → 展开 ops 组件结构/数值断言；非法枚举/缺列 → 优雅降级
- curl 实测："给我一份本月销售报告" → ACTIVITY_SNAPSHOT + 文本无 JSON 泄漏

## B2. render_slides（presentation 模式）✅ 已完成（2026-08-15）

模型输出 `{title, slides:[{heading, bullets[], note?}]}`；gateway 确定性展开为
A2UI Tabs（每页一个 tab：Markdown 渲染 bullets，note 作 caption Text）。
slugline 长 slide 由模型写内容（结构小、内容纯文本，JSON 风险低）。

### 验收
- 单测：slides → Tabs 结构断言；空 slides 拒绝
- curl 实测："把本月销售分析做成 5 页演示" → Tabs surface

## B3. update_canvas（research-canvas 模式）✅ 已完成（2026-08-15）

模型输出 `{title, sections:[{heading, markdown}], append?}`；gateway 展开为
A2UI Column of Card+Markdown sections。同名 surfaceId 重复调用 = 就地更新（覆盖或
append 追加）。a2uiAction（如 approve_section）→ agent 续跑更新 canvas。

### 验收
- 单测：sections 展开 / append 语义 / 同名更新
- curl 实测两轮：生成研究报告 canvas → a2uiAction 追加一节 → surface 更新

## B4. spreadsheet（spreadsheet 模式）

前端"文件"面板增强：CSV 文件可"表格编辑"打开 —— 可编辑网格（contenteditable
单元格），保存经 PUT /files/{name}（新增 gateway 端点，raw body 覆盖写，同白名单
防护）。agent 侧：frontend tool `applySpreadsheetEdits {file, cells:[{row,col,value}]}`
→ 前端渲染确认卡（HITL：显示变更数 + 确认/取消）→ 确认后落盘并回传结果。

### 接口契约
- `PUT /files/{name}`：text body 覆盖写（同 POST 的白名单/大小限制），返回 {name,size}
- frontend tool `applySpreadsheetEdits`：parameters {file: string, cells: [{row:number, col:number, value:string}]}；handler 应用变更 → 确认卡（frontend 内嵌确认，不用 A2UI）→ PUT 保存 → 返回 "已应用 N 处变更"

### 验收
- gateway 单测 PUT；前端 vitest（网格渲染/编辑/保存/确认卡）
- curl 实测 PUT 覆盖写 + 文件面板端到端

## B5. banking 模式映射说明（无需新代码）

业务面板 = 已有 render_a2ui 看板 + a2uiAction 回环（demonstrated in 需求8）。
HITL 审批 = B4 的确认卡模式推广。本 spec 记录映射，不重复造轮子。

## 通用验收门槛
- 每特性：spec 本节更新状态 → gateway/前端 TDD 先红后绿 → curl SSE 实测证据入
  docs/evidence/ → vite build + 部署 + bundle grep → commit+push
