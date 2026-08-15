# ACCEPTANCE_TESTS — 端到端验收场景（2026-08-16）

> 原则：真实服务（gateway :8090 + opencode :4096 + DeepSeek）、无 mock。
> 现有可执行脚本优先复用；每次大循环跑一遍并留证据到 docs/evidence/。

## 既有可执行验收（scripts/）

| 场景 | 脚本 | 覆盖 |
|---|---|---|
| 多轮上下文 | `scripts/test-multi-turn.sh` | 5 轮连续 run、暗号记忆、工具使用 |
| 附件全链路 | `scripts/test-attachment-e2e.sh` | 上传→多模态 run→agent 读文件答出独特数值；413 |
| 前端工具 | `scripts/test-frontend-tool.sh` | frontend tool 续跑 |
| A2UI 表单 | `scripts/test-a2ui-form.sh` | HITL 表单 8 断言 |
| A2UI 全组件 | `scripts/test-a2ui-all-components.sh` | 28 组件 31 断言 |
| 事件顺序 | `scripts/test-event-order-e2e.py` | 乱序重排 |

## MASTER-PROMPT §16 五场景映射

| Test | 场景 | 现状 |
|---|---|---|
| 1 | "分析最近30天销售趋势"：run/plan/工具/流式/A2UI 渲染 | test-multi-turn R1-R2 + test-a2ui-all-components 覆盖 |
| 2 | "哪个区域最差？"（用上一轮上下文） | test-multi-turn R3-R4 |
| 3 | "为什么？"（drill down） | test-multi-turn R4；深化追问可补一轮 |
| 4 | 数据源不可用 → 友好错误 UI | ✅ `scripts/test-datasource-missing.sh`（5/5：删会话内 CSV → 提问 → TOOL_CALL_RESULT「工具执行失败: 」前缀契约 + RUN_FINISHED 正常收尾）；前端工具卡失败态由 fork F3 补全渲染（complete+前缀 → ✗失败，use-default-render-tool 30/30 绿） |
| 5 | SQL/查询失败 → agent 修复或明确错误 | 部分：RUN_ERROR→错误卡重试已验收(P-I)；agent 自愈靠模型能力，抽查式验收 |

## 本轮新增验收项（P0/P1 修复后必须通过）

- [ ] 密钥外移后：`scripts/restart-gateway.sh` 重启 → `test-multi-turn.sh` 5/5（认证不断）
- [ ] escape 修复：构造以 `\` 结尾的 RUN_ERROR（单测覆盖）+ test-multi-turn 回归
- [ ] agents 清理后：`.opencode/` 重新部署 diff 为空、a2ui-tools 插件仍加载（opencode 启动日志无 plugin error）
- [ ] spreadsheetEdits 确认改自绘后：vitest 覆盖 + 手动一次真实编辑确认

## 前端回归基线

- `vue-frontend` vitest 全绿（当前 237）
- fork 目标文件全绿（既有 10 失败属并行线在途，收敛目标 0）
- `vite build` 通过
