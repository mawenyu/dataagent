# A2UI 协议边界第二批 —— 实测证据（2026-08-16）

派单：重复 message/op id 去重、out-of-order 事件、超大 payload 截断。TDD 先红后绿。
实现：`packages/copilotkit-vue/src/v2/components/a2ui.ts` `sanitizeA2uiOperations()`
管线追加三段（体积闸口 → 截断 → 去重 → 归一化），FORK.md 条目 20。
测试：`__tests__/A2UIBoundaryBatch2.test.ts`（10 例）。

## 红测实录（实现前，vitest run 摘抄）

```
Test Files  1 failed (1)
     Tests  7 failed | 3 passed (10)
```

7 红含两类硬证据：

1. **out-of-order 内容丢失**：`updateComponents` 先于 `createSurface` 到达 →
   web_core MessageProcessor 抛 `A2uiStateError: Surface not found for message`
   （message-processor.js:232），被逐 op 容错捕获后**永久丢弃**——该组件
   内容从此消失，不再渲染。纯函数断言与渲染断言（"OutOfOrder" 文本）双红。
2. **超大 payload 卡死**：2MB 文本 prop 的渲染用例 **5000ms 整例超时**
   （`Test timed out in 5000ms`）——不是慢，是 jsdom 下直接卡不出结果。
   这证明截断必须在进入渲染器前的消毒闸口完成，而非渲染层兜底。

3 例防守性用例当日即绿（不同 surface 的 createSurface 互不误伤等语义
守卫），用来钉住不可误伤的正确行为。

## 绿测实录（实现后）

```
✓ A2UIBoundaryBatch2.test.ts (10 tests) 138ms
✓ A2UIBoundaryPayloads.test.ts (10 tests) 93ms   ← 第一批零回归
Test Files  2 passed (2)
     Tests  20 passed (20)
```

关键对照：

| 场景 | 修复前 | 修复后 |
|---|---|---|
| 2MB 文本渲染 | 单例 5000ms 超时卡死 | 截断至 1MB + marker，整文件 10 例 138ms |
| updateComponents 先于 createSurface | 内容永久丢失（warn 后跳过） | 归一化后照常渲染 |
| 整批 op 重复送达（重放重叠） | 重复 createSurface throw→warn 噪音，双 surface 风险 | 逐字节去重，单 surface 渲染，无 render error |
| 300KB 文本（第一批耐压） | 正常渲染 | 仍正常渲染（1MB 上限不误伤） |

## 管线顺序与依据

体积闸口（整条丢弃）→ 截断（保留但瘦身）→ 去重（序列化 key）→ 归一化
（createSurface 提前 / deleteSurface 押后）。序列化结果在闸口阶段算一次、
去重阶段复用（截断命中的 op 缓存失效重算），避免大 payload 双重
JSON.stringify。

上限默认值：单 string 1MB、整条 op 4MB；`opts.{maxStringChars,maxOpBytes}`
可注入（测试用 1KB/4KB 小上限快速断言，生产用默认值）。
