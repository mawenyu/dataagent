# SPEC: workspace 文件管理（前端面板）

> 状态：已实现（2026-08-15）。任务书：/tmp/claude-task5.txt 任务 A。

## 需求

前端可查看 workspace 文件列表、预览文件内容、上传、下载、删除。workspace 根目录 =
gateway `agui.data-workspace`（默认 `workspace/`，相对 gateway 工作目录）。

## 接口契约（gateway REST，语义化命名）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/files` | GET | 列出文件：`{files:[{name,size,modifiedAt}]}`（只列顶层普通文件，按名称排序） |
| `/files/{name}` | GET | 下载/查看文件内容（Content-Disposition: attachment；Content-Type 按扩展名，默认 application/octet-stream） |
| `/files` | POST | 上传（multipart/form-data，字段名 `file`），返回 `{name,size}` |
| `/files/{name}` | DELETE | 删除文件，返回 204 |

错误：404 文件不存在；400 非法文件名/空文件；413 超限。

## 安全

- **路径穿越防护**：文件名只允许 `[A-Za-z0-9._-]`（中文及路径分隔符一律拒绝），
  解析后再 canonical 校验必须位于 workspace 根内（双保险）
- **大小限制**：单文件上传 ≤ 5 MB（`agui.files.max-upload-size` 可配）
- 列表不递归、不列目录、不列隐藏文件（`.` 开头被文件名校验拒绝）

## 前端

- 侧边栏顶部加"会话 / 文件" Tab 切换；文件面板：列表（名称+大小+mtime）、
  点击预览（文本直接显示，>256KB 截断提示）、上传按钮（`<input type=file>`）、
  下载链接、删除（确认后）
- 前端通过 `/agui-api/files`（dev 走 vite proxy，prod 走 nginx）访问

## 验收标准 / 测试用例

gateway（WorkspaceFilesControllerTest）：
1. 上传 → 列表含该文件（名称/大小/mtime）→ GET 内容一致 → DELETE 后 404
2. `../`、含 `/`、中文文件名 → 400；不存在文件 GET/DELETE → 404
3. 超过大小限制 → 413

前端（FilesPanel.test.ts）：
4. 列表渲染名称/大小；上传调用 POST multipart；预览文本内容；删除确认

实测：
5. curl 全链路（上传 CSV → 列表 → 下载比对 sha → agent 能在 workspace 读到 → 删除）
6. 页面 200 + bundle grep（files-panel 标记）
