# DataAgent — OpenCode2 定制层（agents / plugins / tools / skills / commands / hooks）

本目录收纳 DataAgent 对 [OpenCode v2](https://github.com/anomalyco/opencode) 的全部定制扩展，
配合定制 fork 分支使用：**[`mawenyu/opencode` @ `dataagent-v2`](https://github.com/mawenyu/opencode/tree/dataagent-v2)**。

## 目录结构

```
agents/
├── build-opencode.sh        # 一键从 fork 源码构建定制 opencode2 并部署本目录扩展
├── opencode.jsonc.example   # 服务端配置样例（provider / model / permission）
├── plugins/                 # 运行时插件（.ts/.tsx，放 .opencode/plugins/）
├── tool/                    # 自定义工具（.ts，放 .opencode/tool/）
├── skills/                  # Agent skills（放 .opencode/skills/）
├── command/                 # 自定义命令（.md，放 .opencode/command/）
├── agent/                   # 子 agent 定义（.md，放 .opencode/agent/）
└── e2e-demo/                # 经过真实链路 e2e 验证的全能力样例（tool+hook+子agent+skill+command）
    ├── plugins/demo.ts          # timestamp 工具 + execute.before hook
    ├── tool-timestamp.ts        # timestamp 自定义工具
    ├── subagents/explorer.md    # summarizer 子 agent
    ├── skills/hello-skill/      # hello-skill
    └── commands/deploy.md       # deploy 命令
```

## 快速开始

```bash
# 构建定制 opencode2（fork dataagent-v2 分支 = v2 官方 + MCP Tool Bridge 等定制）
./agents/build-opencode.sh

# 启动（默认 :4096，Basic 认证见 ~/.config/opencode/service.json）
opencode2 serve --port 4096
```

## 与上游的关系

- **fork**：`mawenyu/opencode`，分支 `dataagent-v2`（基于 `anomalyco/opencode` v2 分支）
- **定制提交**（相对 origin/v2 ahead）：
  - `f756f3b` feat(server): MCP Tool Bridge HTTP endpoint（`POST /api/mcp/:server/tool/:tool/call`）

## e2e 验证

`e2e-demo/` 内所有能力已通过真实链路验证（见 `../docs/plugin-e2e-report.md`）：
工具事件流全齐、hook 触发、子 agent 调用成功、skill/command 可见、复杂交错流事件零乱序。
