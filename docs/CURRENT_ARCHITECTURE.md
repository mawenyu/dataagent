# CURRENT_ARCHITECTURE — DataAgent 现有架构（2026-08-16 全面审查）

> 事实来源：仓库代码实读（非文档转述）。审查记录见本轮 DEVELOPMENT_STATUS。

## 总链路

```
浏览器 (vite :3001 dev / nginx /agui/ 生产)
  └─ Vue3 + @copilotkit/vue(fork 1.67.1-fork.1, directAgents)
       │  /agui-api/* (vite proxy 或 nginx → :8090)
       ▼
Java gateway :8090 (Spring WebFlux, 27 类 ~5200 行)
  ├─ POST /agent/run (SSE)          → AgUiProtocolService 编排
  ├─ /chat/threads*(CRUD/messages/branch) → ChatThreadStore(data/threads.json 原子写)
  ├─ /files, /chat/threads/{id}/files → WorkspaceFileService(白名单/50MB/子目录)
  ├─ POST /a2ui/validate            → render_a2ui 回执前裁决
  └─ 兜底代理 /**                   → opencode(剥认证头)
       │  WebClient (Basic auth)
       ▼
OpenCode server :4096 (bun 跑 fork 源码, .opencode/ 插件)
  └─ dataagent.a2ui-tools 插件: render_a2ui / request_user_confirm /
     render_report / render_slides / update_canvas (5 个工具,只回执不落盘)
       │  SSE 事件流(session.* v2 方言)
       ▼
gateway AguiEventTranslator 翻译为 AG-UI 事件(text/tool/step/reasoning/
  activity/state/lifecycle,EventOrderer 乱序重排,200ms interval)
  └─ 服务端工具(render_a2ui 等)在 translator 内被 A2UiBridgeService/
     ReportRenderer/SlidesRenderer/CanvasRenderer/HitlConfirmHandler
     确定性展开为 ACTIVITY_SNAPSHOT
       │
       ▼
DeepSeek (deepseek-reasoner 主 / deepseek-chat 备)
```

## 前端结构（vue-frontend）

- 无 pinia；组合式 composables：useThreads / useWorkspaceFiles / useContextUsage(累计分桶) / useAgentState / useNetworkStatus / useRunErrorRecovery / chatAttachments / welcomeAttachments / exportThread / filePreview / spreadsheetEdits / focusTrap / useGlobalShortcuts
- 组件：App / ThreadSidebar(搜索/置顶/归档/多选/导出/分叉标记/modal) / FilesPanel(目录树/预览/编辑) / FilePreviewModal / RunErrorCard / BranchDialog / DefaultToolRender / RenderA2uiToolCall / SpreadsheetEditor
- fork 定制（FORK.md 条目 1-12）：directAgents、thread clone toRaw 修复、welcome gating、工具卡(F3 耗时/状态/失败态、P-L 长文本折叠)、maxRows=3、消息级操作(P-S)
- A2UI 渲染面（vision 线）：packages/copilotkit-vue/src/v2/components/a2ui/* + vue-frontend/src/a2ui/dataAgentCatalog

## 持久化

- gateway `data/threads.json`（元数据/sessionId 映射/surface 快照/分叉前缀，单文件 synchronized 原子写）
- 消息正文：OpenCode session 自持久化，gateway 实时拉取转换（不落盘）
- 文件：`workspace/`（共享根，含播种数据）+ `workspace/threads/{threadId}/`（会话隔离，懒创建+播种+级联删除）
- opencode 配置：`.opencode/`（不入库，agents/ 的部署副本）

## 部署

- 三件套启动：`scripts/up.sh`（幂等）/ `scripts/restart-gateway.sh`（kill→package→/tmp 副本→启动）
- 生产：nginx `/agui/` 静态 + `/agui-api/` 代理；公网 101.34.246.179

## 已知结构性问题（详见 DEVELOPMENT_STATUS）

1. application.yml 明文 opencode 密码已入库（P0）
2. RUN_ERROR 拼装 escape() 不转义反斜杠 → 可产非法 JSON（P0）
3. 无 CLAUDE.md；agents/ 混入上游样例死代码（github-triage 等）会被部署
4. AguiEventTranslator.translate 单方法 ~310 行；重复转换层若干
5. 无统一错误映射；ChatThreadStore IO 故障 → 500；event loop 阻塞 IO
