# A2UI 性能与规模基线（vision-P5-2，2026-08-15 实测）

> 环境：Tencent Cloud CVM（2C/4G 量级，共享带宽）；gateway JDK17 + Spring Boot 3.3.5（-Xmx384m）；
> 前端 jsdom（vitest，较真实浏览器慢，作上界）+ chrome-headless-shell 真实浏览器（画廊页）。
> 复现：gateway `mvn test -Dtest=A2UiPerfTest`；前端 `vitest run src/a2ui/renderPerf.test.ts`；
> 真实浏览器 `/agui/a2ui-gallery.html?batch=perf`（耗时直接上屏，截图 READY-VISION-perf.png）。

## 规模上限（设计值，gateway 强制）

| 上限 | 值 | 位置 | 超限行为 |
|---|---|---|---|
| 单 surface 组件数 | 100 | A2UiBridgeService.MAX_COMPONENTS | 整面拒绝 + warn 日志（validate/execute 同管线） |
| components payload | 64KB | MAX_PAYLOAD_CHARS | 同上 |
| ACTIVITY_SNAPSHOT 分片 | 无（单帧） | — | 上限内单帧直发；surface 更新走同名 replace |
| 数据模型（updateDataModel） | 无独立上限 | 受 spring.codec.max-in-memory-size 50MB 约束 | 见下方实测（52KB rows 正常） |

## 实测基线

### gateway 处理（flatten + normalize + 环检测 + 白名单 + surface 注册）

| 场景 | 耗时 |
|---|---|
| execute @ 100 组件（上限） | best 0.76ms / avg 2.05ms（50 次） |
| validate @ 100 组件 | ~1ms |
| 超限拒绝（150 组件） | 3.75ms（快速失败） |

### 前端渲染（首屏，组件树到 DOM）

| 场景 | jsdom（上界） | 真实浏览器 |
|---|---|---|
| 单 surface 100 组件（MetricCard×99 + Column） | 184.8ms | **52.0ms**（截图上屏值） |
| 多 surface 并发 5 × 20 组件 | 131.9ms | — |
| 同名 surface 二次渲染（replace 近似） | 173.4ms | — |
| 1000 行 DataTable（rows JSON 52KB） | 684.4ms | — |

### 大 payload（>500KB 契约行为）

- components 超 64KB / 组件超 100 → gateway 拒绝（`payload too large`），
  插件回执携带原因（P5-1 同步后模型会如实 narrate + 纠正重试）。
- 数据模型大 payload 不拆分：单帧 updateDataModel；52KB/1000 行实测渲染 684ms（jsdom）。
  500KB+ 数据模型在协议上可行（50MB codec 上限内），但**无流式分片** ——
  大行数表格建议 agent 侧分页（前 N 行 + "查看更多" action），这是设计建议而非缺陷。
- SSE 传输：单帧 64KB 内对 Netty/浏览器均无异样（全部 e2e 证据帧在此量级）。

## 结论

当前规模上限内（100 组件/64KB surface、52KB 数据模型）**渲染与处理耗时全部在
亚秒级**，真实浏览器 100 组件首屏 52ms，无性能瓶颈；超限路径快速失败且
agent 叙事一致（P5-1）。回归线：jsdom 100 组件 < 5s（测试断言，实际 ~185ms）。
