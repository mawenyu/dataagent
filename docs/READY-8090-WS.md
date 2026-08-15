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

## 验收快照

- gateway `mvn test`：112 全绿
- 回归：test-multi-turn.sh 7/7、test-frontend-tool.sh 5/5、test-a2ui-form.sh 8/8
- 隔离实测：docs/evidence/task6-isolation.txt / task6-upload-limit.txt

Hermes 可直接用现跑服务复测公网链路，无需再重启。
