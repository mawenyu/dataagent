# DEVELOPMENT_STATUS — 当前完成度 / 问题清单 / 下一步（2026-08-16 全面审查）

> 每次开发循环更新。基线：main @ P-S（frontend 233+ 绿 / gateway 164 绿 / fork 目标文件全绿、10 既有失败属并行线在途）。

## 本轮审查新发现（两个探查代理 + 主线自查，全部给出行号证据）

### P0（本轮立即修）

1. **明文 secret 入库**：`gateway/src/main/resources/application.yml:10` opencode 密码硬编码并提交。修法：yml 改 `${OPENCODE_SERVER_PASSWORD:}`，启动脚本 source `.env.opencode`（已含同密码），文档同步。
2. **SSE 手写 escape 可产非法 JSON**：`AgUiProtocolService.java:719-721` 只替换 `"`→`'` 与换行，不转义反斜杠；以 `\` 结尾的 RUN_ERROR 消息破坏协议帧。修法：改 Jackson 序列化 + 测试。
3. **仓库无 CLAUDE.md**（新会话冷启动无指引）。补建。

### P1（本轮修）

4. **agents/ 混入上游样例死代码**（会被 build-opencode.sh 部署到每个 .opencode/）：`agents/tool/github-*.ts`（硬编码上游 owner/repo、引用不存在的 env.d.ts）、`agents/agent/triage.md`/`duplicate-pr.md`（用未配置的 opencode/* 模型，实际不可用）、`agents/skills/*`（4 个样例）、`agents/command/*`（8 个上游命令）、`agents/plugins/tui-smoke.tsx`+`smoke-theme.json`（TUI-only）。移到 `agents/upstream-examples/`（不部署）并改 build 脚本排除。
5. **a2ui-tools.ts 过时注释**：头注释"4 个 UI 工具"实为 5 个（漏 request_user_confirm）；build-opencode.sh:61 同样。
6. **文档漂移**：DELIVERY-README 与现状 6 处矛盾（vendor 空目录 / DEEPSEEK_API_KEY 不存在 / scripts 清单 / 版本状态停滞 / example 空 provider）；`docs/spec/workspace-files.md` 仍写 5MB（实际 50MB）且缺 PUT/子目录/baseModified；`workspace-isolation.md` 缺 409 契约。
7. **applySpreadsheetEdits 原生 confirm**（App.vue:97 区域，唯一残留原生弹窗）。

### P2（排入后续循环）

8. AguiEventTranslator.translate ~310 行单方法；全局/会话级文件端点复制粘贴；历史拉取两处重复。
9. 无统一错误映射；ChatThreadStore 磁盘故障 → 500；event loop 阻塞 IO（Files.write / store 全文件锁）。
10. 每事件 `new ObjectMapper()`（AgUiProtocolService 3 处）。
11. 死代码：WorkspaceFileService.sizeOf、A2UiActionHandler.parse、A2UiService.BASIC_CATALOG_ID。
12. fork 10 个既有失败测试（并行线在途，非本线债）。
13. 根目录陈旧顶层 `dist/`（非部署源）。

### P3

14. `agents/e2e-demo/plugins/demo.ts` root 属主；`.opencode/opencode.jsonc:2` `$schema` 键为空字符串（运行无碍）；CORS 通配+credentials（无 auth 期间可接受）。

## 本轮执行记录

- [x] git 清理：运行时产物入 gitignore，MASTER-PROMPT 入库（b205b6d）
- [x] 五文档：CURRENT/TARGET_ARCHITECTURE、PRODUCT_REQUIREMENTS、本文件、ACCEPTANCE_TESTS
- [ ] P0-1 密钥外移（含启动脚本 source + 实测重启验证）
- [ ] P0-2 escape 修复（Jackson 序列化 + 反斜杠用例）
- [ ] P0-3 CLAUDE.md
- [ ] P1-4/5/6/7 清理与文档

## 下一步（修完 P0/P1 后）

P2-8/9 重构（避开 vision 在途文件）→ 移动端 UX 验收 → fork 既有失败清零（随并行线）。
