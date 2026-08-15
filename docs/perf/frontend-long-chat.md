# 前端长会话渲染性能（vision-P11，2026-08-16 实测）

> 复现：jsdom `vitest run src/a2ui/longChatPerf.test.ts`（500 混合消息：user/assistant/
> 工具卡 ≈5:4:1）；真实浏览器 `/agui/a2ui-gallery.html?batch=longchat&n=500`（耗时上屏，
> 截图 READY-VISION-p11-longchat.png）。
> fork 回归：`packages/copilotkit-vue` 聊天测试目录 50 文件（615 例）——优化后与基线
> 失败集完全一致（6 个既有失败，0 新增）。

## 优化内容

fork `CopilotChatMessageView` 消息循环加 `v-memo`，签名为
`id:role:内容长度:toolCalls数:各工具args长度`：
- @ag-ui/client 对流式 delta 是**原地修改**（`o.content += delta`，对象身份不变），
  对象 identity 不能作 memo key —— 这是关键约束（首版 identity 签名导致 12 个工具
  流式测试失败，修正后 0 新增失败）
- 流式中仅"签名变化的活动消息"重渲染；历史消息整树跳过
- 工具结果到达走 messages.length 依赖；isRunning 翻转触发一次全量（换页/完成态）

## before / after（jsdom，500 条消息）

| 场景 | before | after | 提升 |
|---|---|---|---|
| 流式 delta 重渲染（每 tick） | 313.2ms | **8.3ms** | **≈38×** |
| 首屏 500 条 | 2202ms | 2012ms | ≈持平（v-memo 不加速首屏，符合预期） |
| 追加 1 条 | 290ms | 322ms | 持平（噪声范围） |

真实浏览器（优化后构建）：500 条首屏 **336.7ms**。

## 虚拟滚动可行性结论

**当前不引入真虚拟滚动**（vue-virtual-scroller 等）：
1. v-memo 后流式 tick 已降到个位数 ms，500 条首屏浏览器 337ms —— 痛点已解；
2. 聊天列表是**可变高度 + 底部吸附自动滚动 + 工具卡折叠展开**，虚拟滚动的
   高度估算/滚动锚定改造成本与回归风险高（fork 有大量滚动/插槽测试）；
3. 若未来消息量到 2000+：优先考虑 `content-visibility: auto`（浏览器原生
   离屏懒渲染，零 JS 侵入），仍不够再评估虚拟滚动。

## 已知边界
- v-memo 签名按"长度"近似内容变化：同长度内容替换（编辑场景）不会触发重渲染 ——
  本栈消息不可编辑，无此路径；若未来引入消息编辑需把签名改为版本号。
