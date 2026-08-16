# SPEC: workspace 会话隔离 + ChatGPT 式上传（task6）

> 状态：已实现（2026-08-15）。任务来源：用户 task6 指令（/tmp/claude-task6-go.txt 未落盘，按用户口头摘要
> "workspace 会话隔离 + ChatGPT 式上传" + task5 既定 SPEC/TDD 流程执行）。

## 背景

task5 之前 workspace 是**全局共享**单目录（`agui.data-workspace`，默认 `workspace/`）：
所有会话的 agent 读写同一批文件，`/files` API 列出的也是同一目录。这导致：
- 会话 A 上传的 CSV 会出现在会话 B 的文件面板里，agent 跨会话串数据；
- 用户无法像 ChatGPT 一样在输入框直接贴附件 —— 必须先切到"文件"面板上传。

## 需求

### A. workspace 会话隔离

1. 每个会话（thread）拥有独立的工作目录：`<dataWorkspace>/threads/<threadId>/`。
2. agent run 时 prompt 中的"数据工作目录"指向**该会话的目录**（而非共享根）。
3. 会话目录**懒创建 + 播种（seed）**：首次使用时创建，并把共享根下的普通文件
   （示例数据，如销售 CSV）拷入作为初始数据 —— 保证"分析本月销售情况"在新会话
   依然开箱可用。已存在的目录不重复播种（用户删了示例文件不会被复活）。
4. 文件 API 按会话隔离：新增 `/chat/threads/{threadId}/files` 系列端点（契约见下），
   前端文件面板显示**当前会话**的文件，切换会话即切换文件列表。
5. 删除会话时级联删除其工作目录（递归）。
6. 旧 `/files` 端点保留，仍指向共享根（向后兼容 + 旧测试不炸；共享根现在主要承担
   示例数据 seed 源的角色）。
7. 安全不变式：threadId 白名单 `[A-Za-z0-9._-]{1,128}`（与 run 校验一致），文件名
   白名单不变，解析后 canonical 路径必须在会话目录内。

### B. ChatGPT 式上传（聊天输入框附件）

1. 聊天输入框"+"菜单出现"Add file"入口（fork `CopilotChat` 原生 attachments 能力），
   支持点击选择与拖拽上传。
2. 选中即上传（uploading 状态）到**当前会话**的工作目录；完成后附件以 chip/队列
   形式挂在输入框上方（fork `CopilotChatAttachmentQueue`），可单独移除。
3. 发送消息时附件随消息发出（multimodal content parts，`metadata.filename` 携带
   文件名）；gateway 提取用户消息时把附件文件名写进 prompt（"用户随消息上传了文件：
   xxx.csv，已保存在数据工作目录"），agent 直接读取分析。
4. 仅附件无文字也可发送（gateway 侧用默认引导语，不再报 "empty user message"）。
5. 上传失败/超限/类型不符 → toast 提示（复用现有 toast stack）。

## 接口契约

### B1. 会话级文件 API（新增）

```
GET    /chat/threads/{threadId}/files            → { path, dirs:[...], files:[{name,size,modifiedAt}] }
                                                   （?path=sub/dir 进入子目录）
POST   /chat/threads/{threadId}/files            multipart 字段名 file → {name,size}（?path= 入已存在子目录）
GET    /chat/threads/{threadId}/files/{*name}    下载/查看（支持子目录；Content-Disposition attachment）
PUT    /chat/threads/{threadId}/files/{*name}    text/plain 覆盖写 → {name,size,modifiedAt}
DELETE /chat/threads/{threadId}/files/{*name}    204 / 404
```

- threadId 非法（白名单外）→ 400 `{error:"invalid threadId"}`；thread 不存在也允许
  操作（目录懒创建，与 run 的自动建档行为一致 —— 前端先上传后发消息时 thread
  尚未建档）。
- PUT 支持可选 query `baseModified`（读取时拿到的 modifiedAt 毫秒）乐观并发检测（P15）：
  文件当前 mtime 与 baseModified 不符（或文件已不存在）→ **409**
  `{error:"conflict", message:"file modified since read (baseModified mismatch)", currentModified}`，
  不覆盖；省略 baseModified 则直接覆盖写。用于表格编辑器/agent 编辑在读取后被第三方
  改动时防止静默丢改。
- 错误码与 `/files` 一致：非法文件名 400 / 超限 413 / 空文件 400；另加 409（baseModified 冲突）。

### B2. run prompt 变化

- `<environment>` 中"数据工作目录"= `<dataWorkspace>/threads/<threadId>`（相对路径，
  与 OpenCode cwd 约定不变）。
- 用户消息含附件时追加：
  `<attachments>\n用户随消息上传了文件: a.csv, b.json（已保存到数据工作目录）\n</attachments>`
- 消息 content 为 multimodal parts 数组时：拼接 text parts 为用户文本；
  收集带 `metadata.filename` 的 part 为附件列表。纯附件消息文本回退为
  "请分析我上传的数据文件"。

### B3. 前端 attachments 配置

```ts
CopilotChat :attachments="{
  enabled: true,
  accept: '.csv,.json,.txt,.md,.xlsx,.png,.jpg,.jpeg,.log',
  maxSize: 50 * 1024 * 1024,       // 与 gateway 上限一致（2026-08-15 413 修复后 50MB）
  onUpload: async (file) => {      // 上传到当前会话工作目录
    await threadFilesApi.upload(file)
    return { type: 'url', value: threadFilesApi.downloadUrl(file.name),
             mimeType: file.type, metadata: { filename: file.name } }
  },
  onUploadFailed: (e) => pushToast({ type: 'error', ... })
}"
```

## 验收标准

1. gateway `mvn test` 全绿（含新增隔离/附件用例）；前端 vitest 全绿；vite build 通过。
2. curl 实测：建会话 T1/T2 → 各上传不同文件 → 各自 `/chat/threads/{id}/files`
   只见自己的文件；共享根 `/files` 不受影响。
3. curl SSE 实测：T1 发消息 → gateway 日志/prompt 中数据工作目录为
   `workspace/threads/T1`；T1 新目录自动播种示例 CSV。
4. 删除会话 T2 → `workspace/threads/T2` 目录被删除。
5. 附件消息实测：构造 content parts 用户消息（含 metadata.filename）POST
   `/agent/run` → SSE RUN_FINISHED 且 agent prompt 含附件文件名。
6. 前端实测：页面 200；bundle 静态校验含 attachments 配置与 threads files API 路径。
7. 证据存 `docs/evidence/task6-*.txt`；commit + push。

## 测试用例

### gateway（WorkspaceFileService / Controller / ProtocolService）

- `forThread`：合法 threadId 各自隔离目录；非法 threadId（`..`、`a/b`、空）→ empty/400
- 首次 `forThread` 访问播种共享根文件；第二次访问（目录已存在）不重复播种
- 会话级 list/upload/read/put/delete 全路径；超限 413；非法名 400
- 删除会话级联删目录（ChatThreadsController DELETE 或 store 层）
- prompt 组装：数据工作目录含 threadId；多模态 content（text+document parts）→
  文本拼接 + `<attachments>` 段；纯附件消息回退引导语

### 前端（vitest）

- `useWorkspaceFiles` 接受 threadId 参数，API 路径含 threadId；切换 threadId
  refresh 拉对应列表
- FilesPanel 接收当前 threadId（prop/watch），切换会话刷新
- attachments onUpload 调用上传到当前会话 URL；onUploadFailed 弹 toast

## 边界（明确不做）

- 欢迎页（空会话）自绘输入框不支持附件 —— 附件入口在主聊天输入框；首条消息
  发出后欢迎页即消失。
- ~~agent 侧跨目录遍历不做硬隔离~~ → 二期（P33-B）起**写操作已硬隔离**（见下）；
  读操作仍不做硬隔离（OpenCode `external_directory: allow` 本就放开；读共享是
  公共区参考数据的正常用法；HTTP API 层有白名单+canonical 校验）。
- 附件内容不进 LLM context（文件落盘，agent 用工具读 —— 与 ChatGPT 的
  "文件进 workspace" 语义一致；图片 base64 直传不在本期）。

---

## 二期（P33，2026-08-16）：公共区 + agent 写权限白名单 + 面板两区

> 状态：已实现并验收（gateway 225 绿 / 前端 291 绿 / guard e2e 5/5）。
> 一期把会话目录隔开了，但共享根仍是"谁都能写"：agent 会把产出写进公共区、
> 甚至覆盖示例 CSV。二期把共享根升格为**公共数据区**——对用户可写、对 agent 只读。

### A. prompt 层约定（P33-A，gateway 9f224d3）

`<environment>` 段由 `AgUiProtocolService.environmentSection()` 单点组装（run 与
a2uiAction 续跑两个 call site 共用），新增一行：

```
公共数据目录: workspace（所有会话共享的参考数据，只读——不要在该目录创建/修改/删除文件；你的产出写到数据工作目录）
```

实测效果：agent 在 prompt 层即礼貌拒绝往公共区写（不触发工具调用）。

### B. 插件层硬拦（P33-B，agents/plugins/workspace-guard.ts，1cfbdb0）

opencode effect 插件（fork `Plugin.define` + `effect` 入口，与内置 plan 模式同款），
注册 `execute.before` 钩子（全插件体系唯一可失败钩子），对写类工具
`write/edit/patch` 实施白名单：

| 目标路径 | 判定 |
|---|---|
| `workspace/threads/<本会话 threadId>/` 内 | 放行 |
| `os.tmpdir()` 内 | 放行（中间计算 scratch） |
| 其余（公共区根 / 别人会话目录 / 仓库代码…） | 返回 `Tool.Error` 拒绝，消息给出合规路径，模型可自我纠正改写 |

- sessionID→threadId 反查：读 gateway 落盘的 `data/threads.json`（mtime 缓存，
  `AGUI_THREADS_STORE` 可覆盖）。
- 查不到映射的 session（非 gateway 链路）：`workspace/` 树一律拒写，其余路径放行。
- patch 工具目标从 `patchText` 的 `*** Add/Delete/Update File:` / `*** Move to:` 头提取。
- **读不限**：read/glob/grep/bash 等不拦 —— 隔离是组织性写边界。

e2e 实证（`scripts/test-workspace-guard.sh`，直连 opencode :4096 绕过 prompt 自觉，
5/5 PASS，证据 `docs/evidence/2026-08-16-p33b-workspace-guard.txt`）：
未知 session 写公共区根→拒+文件未落盘；/tmp→放行；绑定 session 写自己目录→放行；
写别人目录→拒；覆盖公共区 CSV→拒。

### C. 文件面板两区（P33-C，前端 2d0a109）

FilesPanel 拆为 **会话文件 / 公共数据** 两区（树交互抽为 `FileTree.vue`，
两区各一实例互不串状态）：

- 会话文件：`/chat/threads/{threadId}/files`（一期契约不变），badge「仅本会话」；
  未选会话显示空态引导、不发请求。
- 公共数据：legacy `/agui-api/files` 共享根，badge「所有会话共享 · agent 只读」；
  用户可正常上传/预览/编辑/删除（走 gateway REST，不经 opencode 插件）。
  用户由此上传的参考数据对所有会话的 agent 可读（读不隔离），
  同时仍是一期会话目录的 seed 源（A.3 播种语义不变）。

### 二期验收记录

1. gateway 225/225 绿（P33-A 新增 prompt 段 2 例红→绿）。
2. 前端 291/291 绿 + typecheck 干净（P33-C 新增两区 3 例 + task6 用例改 URL 感知桩）。
3. workspace-guard e2e 5/5（插件级 Tool.Error 实证，见上）。
4. 真实链路回归：`scripts/test-multi-turn.sh`（结果见 DEVELOPMENT_STATUS 执行记录）。
