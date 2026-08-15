# READY-8090-WS — task6 部署通知（给 Hermes）

> 时间：2026-08-15 12:20（Asia/Shanghai）
> 状态：**READY-8090-WS** —— gateway :8090 已是 task6 全量构建，实测通过，可部署/复测。

## 本次就绪内容

- **task6 workspace 会话隔离 + ChatGPT 式上传**（df2c6ad）：会话级目录
  `workspace/threads/<threadId>`（懒创建+播种）、会话级文件 API
  `/chat/threads/{id}/files`、输入框附件即传即存、级联删除
- **413 修复**（ecce4ef）：上传上限 50MB（gateway + codec + nginx 三层一致）
- **隔离回归修复**：a2uiAction 续跑 prompt 补会话级数据工作目录提示
  （本会话发现并已验证：test-a2ui-form.sh 8/8）
- **vision-P0/P1**（338ab52/370f327，并行会话）：组件清单三处同源 +
  MESSAGES_SNAPSHOT + RAW debug 通道

## 运行态（已实测）

- opencode :4096（bun，fork 源码，插件 dataagent.a2ui-tools + acme.demo 已注册）
- gateway :8090（pid 当前运行中，jar = main@370f327+ 构建）
- vite dev :3001；公网 http://101.34.246.179/agui/ 200；/agui-api/files 200

## 验收快照（2026-08-15 全量回归，追加修复后）

- gateway `mvn test`：128 全绿；前端 vitest：66 全绿；vite build 通过
- 回归全套：multi-turn 7/7、frontend-tool 5/5、a2ui-form 8/8（×3 连续）、
  a2ui-all-components 31/31（4 组全组件一次过）
- 公网实测：/agui/ 200；/agui-api/agent/run SSE 18 类事件全齐（79 text delta）；
  /agui-api/chat/threads/{id}/files 200
- 追加修复（9b58938）：截断式终止的尾随事件泄漏（a2uiAction 续跑拿到旧回答）
  —— server 工具注册后不再截断 run；frontend 工具截断时 abort opencode 执行
- 隔离实测：docs/evidence/task6-isolation.txt / task6-upload-limit.txt

Hermes 可直接用现跑服务复测公网链路，无需再重启。
