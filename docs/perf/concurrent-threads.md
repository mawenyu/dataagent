# 多会话并发隔离压测（vision-P20，2026-08-16 生产实测）

> 证据：docs/evidence/2026-08-16-p20-*.sse（7 份真实 run 流）

## 场景 1：3 会话并发 run（各含暗号记忆 + shell 工具调用）

| 会话 | 任务 | 事件数 | 跨线程事件 | contextSize 轨迹 | 结果 |
|---|---|---|---|---|---|
| p20-A | 暗号朱雀71 + 数 csv 文件 | 114 | **0** | 7805→7941 | 暗号✓ 文件数✓ |
| p20-B | 暗号玄武88 + 数行数 | 282 | **0** | 7811→7964→8156 | 暗号✓ 137 行✓ |
| p20-C | 暗号青龙93 + 列文件 | 98 | **0** | 7803→7948 | 暗号✓ 文件名✓ |

- **threadId 隔离**：三流并发下每个事件的 threadId 均与所属会话一致（wrong_thread=0）
- **token 分桶**：CUSTOM context_usage / STATE_DELTA 的 contextSize 各会话独立单调增长，互不同步污染
- **上下文隔离**：暗号互不串（A/B/C 各自答出自己的暗号）

## 场景 2：并发 HITL + 交叉裁决

- p20-A（删 e2e-up.txt）与 p20-B（删 region csv）**同时**挂起确认卡
  （hitl-del-e2e-up / hitl-del-region-result-csv）
- 两个 resume **并发**发出：A confirm + B cancel
- 结果：A 的 e2e-up.txt 已删 ✓；B 的 region 文件保留 ✓ —— 裁决各落各的工作区

## 架构保障点（核验依据）

- threadId → OpenCode session 映射在 ThreadRepository（JsonThreadRepository，synchronized 单文件原子写）
- 每 run 独立 event 流订阅（per-session /api/event），translator 实例状态按流隔离
- surface registry / 文件工作区 / metrics hitlStarts 均以 threadId 为键
- 共享根只读播种；会话工作区物理隔离（task6）

## 结论
3 并发 run + 并发 HITL 裁决下无串流、无上下文污染、无工作区串写。
瓶颈备注：DeepSeek 串行 provider 下 3 并发 run 总耗时 ≈ 单 run（事件数多者）
的 1.2~1.5 倍，未见 gateway 侧排队瓶颈。
