# SPEC: workspace 文件管理（前端面板）

> 状态：已实现（2026-08-15）。任务书：/tmp/claude-task5.txt 任务 A。

## 需求

前端可查看 workspace 文件列表、预览文件内容、上传、下载、删除。workspace 根目录 =
gateway `agui.data-workspace`（默认 `workspace/`，相对 gateway 工作目录）。

## 接口契约（gateway REST，语义化命名）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/files` | GET | 列出目录：`{path, dirs:[...], files:[{name,size,modifiedAt}]}`；`?path=sub/dir` 进入子目录（缺省为根；共享根列表隐藏会话隔离内部目录 `threads/`） |
| `/files/{*name}` | GET | 下载/查看文件内容（支持子目录相对路径；Content-Disposition: attachment；Content-Type 按扩展名，默认 application/octet-stream） |
| `/files` | POST | 上传（multipart/form-data，字段名 `file`），返回 `{name,size}`；`?path=sub/dir` 传入子目录（目录须已存在） |
| `/files/{*name}` | PUT | 文本 body（text/plain）覆盖写，返回 `{name,size}`；文件不存在时新建（spreadsheet 编辑器保存通道） |
| `/files/{*name}` | DELETE | 删除文件（支持子目录相对路径），返回 204 |

会话级（隔离）端点见 `docs/spec/workspace-isolation.md`。其中 PUT `/chat/threads/{threadId}/files/{*name}`
额外支持可选 query `baseModified`（读取时拿到的 modifiedAt 毫秒）做乐观并发检测：与服务端实际
mtime 不符（或文件已不存在）→ **409** `{error:"conflict", message:"file modified since read
(baseModified mismatch)", currentModified}`，不覆盖；省略 baseModified 则直接覆盖。成功响应含 `modifiedAt`。

错误：400 非法文件名/路径/空文件/非法 threadId；404 文件不存在；409 baseModified 冲突（仅会话级 PUT）；413 超限。

## 安全

- **路径穿越防护**：单段文件名只允许 `[A-Za-z0-9][A-Za-z0-9._-]{0,127}`（中文拒绝）；
  子路径逐段校验同白名单（禁 `..`/反斜杠/空段，深度 ≤ 8），解析后再 canonical 校验必须位于
  workspace 根内（双保险）
- **大小限制**：单文件上传/写入 ≤ 50 MB（`agui.files.max-upload-size` 可配；2026-08-15 由 5MB
  上调，与 nginx `client_max_body_size`、前端附件上限对齐）
- 列表不递归（仅列指定目录一层，返回子目录名 + 普通文件）；`.` 开头隐藏文件被文件名校验拒绝

## 前端

- 侧边栏顶部加"会话 / 文件" Tab 切换；文件面板：列表（名称+大小+mtime）、
  点击预览（文本直接显示，>256KB 截断提示）、上传按钮（`<input type=file>`）、
  下载链接、删除（确认后）
- 前端通过 `/agui-api/files`（dev 走 vite proxy，prod 走 nginx）访问

## 验收标准 / 测试用例

gateway（WorkspaceFilesControllerTest）：
1. 上传 → 列表含该文件（名称/大小/mtime）→ GET 内容一致 → DELETE 后 404
2. `../`、中文文件名/路径段、反斜杠/空段、深度 > 8 → 400；不存在文件 GET/DELETE → 404
   （`/` 本身合法：逐段过白名单的子目录相对路径受支持）
3. 超过大小限制 → 413
4. PUT 文本覆盖写/不存在时新建；会话级 PUT 带 baseModified 且与服务端 mtime 不符 → 409 不覆盖

前端（FilesPanel.test.ts）：
4. 列表渲染名称/大小；上传调用 POST multipart；预览文本内容；删除确认

实测：
5. curl 全链路（上传 CSV → 列表 → 下载比对 sha → agent 能在 workspace 读到 → 删除）
6. 页面 200 + bundle grep（files-panel 标记）
