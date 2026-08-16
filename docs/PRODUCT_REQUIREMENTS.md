# PRODUCT_REQUIREMENTS — Data Agent 核心体验（2026-08-16 审查定稿）

## 产品定位

像和专业数据分析师聊天一样使用的 AI Data Agent Web App。不是 chat demo。

## 核心场景（Vertical Slice，已可用）

"分析最近 30 天销售情况，告诉我最值得关注的问题" →
planning → 工具执行（bash/read workspace CSV）→ 流式文本 + 工具卡可视化 →
结论 + A2UI 看板（KPI/图表/表格）→ 追问"为什么华东下降"用上下文续分析。

## 体验契约（现状达成度）

| # | 契约 | 状态 |
|---|---|---|
| 1 | Agent 工作过程可见：工具卡（状态点/spinner/耗时/失败✗）、step、reasoning 折叠 | ✅ F3/P-L |
| 2 | 等待不焦虑：流式输出、停止按钮、骨架屏、超时兜底(120s)+错误卡重试 | ✅ F4/P-B/P-R |
| 3 | 多会话：列表/搜索/置顶/归档/多选批量/重命名/删除(modal)/分叉/导出(MD+JSON) | ✅ F2/P7/P-G/P-H/P-Q/P-A/P-M |
| 4 | 文件：ChatGPT 式上传(拖拽/粘贴/chip/校验提示)、会话隔离、目录树、在线预览(csv 表格/json/md)、大文件下载提示、表格编辑(乐观锁) | ✅ task6/P-J/P-C/P-N/P15 |
| 5 | 消息操作：复制(hover)/重新生成(末条)/时间戳 | ✅ P-S |
| 6 | 用量可观测：context 徽章分级警示、累计 token 分桶明细 | ✅ P-K |
| 7 | 断网：离线徽章、恢复自动续跑 | ✅ P-I |
| 8 | 错误产品化：内联错误卡(5xx 码徽章)、toast、无裸 500/原生弹窗 | ✅ P-B/P-I/P-C |
| 9 | 键盘可达：Ctrl+K 搜索、Ctrl+N 新建、Esc/Tab 圈定、aria | ✅ P-O |
| 10 | 生成式 UI：28 组件 A2UI 看板/表单/向导,HITL 确认卡 | ✅ vision 线 |

## 残留 UX 缺口（优先级排序）

1. ~~applySpreadsheetEdits 的 window.confirm~~ ✅ 已闭环（P1：App.vue 改 Promise 化自绘确认 modal，ConfirmDialog.vue；全仓原生弹窗清零）
2. 移动端适配粗（sidebar 抽屉已有；A2UI 看板/工具卡小屏未验收）— P2
3. 消息区 Markdown 表格/代码块已有，但长会话首屏性能依赖 v-memo（vision P11 已 38×）；继续观察 — P3
4. 欢迎页与主输入框能力差异（主输入框 Enter/Shift+Enter/附件有；语音转写未接业务）— P3

## 禁止（MASTER-PROMPT 红线复述）

fake 数据 / mock agent / Markdown 冒充 UI / 原生 alert·confirm·prompt / 静默 catch / TODO 堆砌。
