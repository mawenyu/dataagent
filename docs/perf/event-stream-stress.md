# AG-UI 事件流压测报告（vision-P16，2026-08-16）

> 复现：gateway `mvn test -Dtest=EventStreamStressTest`；
> 前端 `vitest run src/agents/eventStreamStress.test.ts`；
> 真实 run 证据 `docs/evidence/2026-08-16-p16-event-stress.sse`（2463 事件）。

## gateway translator（JUnit，合成 ~1200 OpenCode 事件/流）

| 用例 | 结果 |
|---|---|
| 1000 text delta + 50 reasoning + 5 交错工具调用（顺序流） | 1000 delta 严格按序拼接一致；5 工具 START/END 全透传；RUN_FINISHED 收尾 ✅ |
| 跨 key 乱序（tool.called 先于 input.ended 到达） | EventOrderer（TreeMap 无缺口前缀下发）自愈，delta 顺序一致 ✅ |
| 内存稳定：15 × 1200 事件连续翻译 | **堆增长 0MB**（9MB→9MB，GC 后），translator 无状态泄漏 ✅ |

### 乱序契约（实测确认，构造依据）
- 非 delta 事件带 `durable.seq`（每会话单调）；delta 事件**无 seq**，锚定所属
  流（text/reasoning/tool 按种类+id 隔离）最近的有 seq 事件
- 同 key 内 delta 按到达序（OpenCode 单 SSE 连接保序，不存在同 key 乱序的
  真实到达模型）；跨 key seq 缺口由 orderer 愈合；缺口永不补齐时
  `agui.event-reorder-timeout`（默认 3s）强制 flush 兜底

## 前端消费（vitest，真实 HttpAgent + fetch mock）

| 用例 | 结果 |
|---|---|
| 1000 delta + 5 工具交错 + **SSE 任意字节分片**（17 片跨事件边界） | 消息内容严格按序（d0…d999）；5 工具调用 + 5 结果完整 ✅ |
| 20 次连续大流 run | 无订阅累积（residual subscribers=0），状态无错乱 ✅ |

## 生产真实 run（DeepSeek reasoner，2463 事件）

- 构成：2070 TEXT_MESSAGE_CONTENT + 255 REASONING_MESSAGE_CONTENT +
  2 工具调用（102 TOOL_CALL_ARGS）+ 3 STEP 对 + 3 STATE_DELTA + MESSAGES_SNAPSHOT + RUN_FINISHED
- 语义级顺序核验：200 行"序号|平方|立方"列表 **1..200 连续无缺行**（若事件
  乱序/丢失列表必然断裂）
- MESSAGES_SNAPSHOT 9 条消息与流终态一致；无 RUN_ERROR

## 结论
单 run 2000+ 事件量级下，gateway 翻译顺序一致性、乱序自愈、内存（零增长）、
前端 SSE 分片鲁棒性、订阅生命周期全部达标。瓶颈不在事件管道；
token 吞吐受 LLM 侧限制（~20 delta/s），远低于管道容量。
