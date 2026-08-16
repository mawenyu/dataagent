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
| 销售趋势全链路 | `scripts/test-sales-trend-e2e.sh` | Test 1：RUN_STARTED 首事件/planning(STEP_STARTED)/data tool/多 delta 流式/ACTIVITY_SNAPSHOT(含 Chart)/RUN_FINISHED 末事件，8 断言 |
| 上下文追问 | `scripts/test-context-followup.sh` | Test 2：「哪个区域表现最差？」+ contextSize 单调累积（同 thread wire 证据），5 断言 |
| drill down | `scripts/test-drilldown-why.sh` | Test 3：「为什么？」指代解析 + 因果解释软断言 + contextSize 累积，5 断言 |
| 工具失败恢复 | `scripts/test-tool-failure-recovery.sh` | Test 5：工具执行失败后 RECOVERED(换路径重试成功) 或 EXPLICIT(明确错误) 二选一契约，5 断言 |

## MASTER-PROMPT §16 五场景映射

| Test | 场景 | 现状 |
|---|---|---|
| 1 | "分析最近30天销售趋势"：run/plan/工具/流式/A2UI 渲染 | ✅ `scripts/test-sales-trend-e2e.sh`（8/8，2026-08-16 实测：7 steps、9 工具调用、278 文本 delta、1 个含 Chart 的 ACTIVITY_SNAPSHOT） |
| 2 | "哪个区域最差？"（用上一轮上下文） | ✅ `scripts/test-context-followup.sh`（5/5，2026-08-16 实测：CTX 7896→8424 累积，R2 答出「华南」）；另有 test-multi-turn R3-R4 |
| 3 | "为什么？"（drill down） | ✅ `scripts/test-drilldown-why.sh`（5/5，2026-08-16 实测：CTX 11217→12468，R2 给出量价双低因果链）；另有 test-multi-turn R4 |
| 4 | 数据源不可用 → 友好错误 UI | ✅ `scripts/test-datasource-missing.sh`（5/5：删会话内 CSV → 提问 → TOOL_CALL_RESULT「工具执行失败: 」前缀契约 + RUN_FINISHED 正常收尾）；前端工具卡失败态由 fork F3 补全渲染（complete+前缀 → ✗失败，use-default-render-tool 30/30 绿） |
| 5 | SQL/查询失败 → agent 修复或明确错误 | ✅ `scripts/test-tool-failure-recovery.sh`（5/5，2026-08-16 实测：删 CSV 后 agent 改用 region-sales 聚合文件完成占比饼图，RECOVERED 路径）；RUN_ERROR→错误卡重试已验收(P-I) |

## 本轮新增验收项（P0/P1 修复后必须通过）

- [x] 密钥外移后：`scripts/restart-gateway.sh` 重启 → `test-multi-turn.sh` 7/7（2026-08-16 实测，P2-8/9 重构同车上生产）
- [x] escape 修复：Jackson 序列化单测（gateway 189 绿含反斜杠用例）+ test-multi-turn 回归通过
- [x] agents 清理后：临时 target 重部署 vs `.opencode/` diff —— 实质差异仅 apiKey（设计如此，build 不覆盖既有 jsonc）；`agents/` 空壳目录已清；opencode 日志 plugin error 0 条
- [x] spreadsheetEdits 确认改自绘后：vitest 覆盖（SpreadsheetEditor/ConfirmDialog 绿）；真实链路手动确认待下一轮补

## 前端回归基线

- `vue-frontend` vitest 全绿（当前 237）
- fork 目标文件全绿（既有 10 失败属并行线在途，收敛目标 0）
- `vite build` 通过
