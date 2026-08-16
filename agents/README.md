# DataAgent — OpenCode2 定制层（agents / plugins / tools / skills / commands / hooks）

本目录收纳 DataAgent 对 [OpenCode v2](https://github.com/anomalyco/opencode) 的全部定制扩展，
配合定制 fork 分支使用：**[`mawenyu/opencode` @ `dataagent-v2`](https://github.com/mawenyu/opencode/tree/dataagent-v2)**。

## 目录结构

```
agents/
├── build-opencode.sh        # 一键从 fork 源码构建定制 opencode2 并部署本目录扩展
├── opencode.jsonc.example   # 服务端配置样例（provider / model / permission）
├── plugins/                 # 运行时插件（.ts/.tsx，放 .opencode/plugins/）
│   ├── a2ui-tools.ts            # 5 个服务端裁决工具（业务唯一必需插件）
│   └── workspace-guard.ts       # P33-B 会话级写护栏（非 tool）
├── upstream-examples/       # 上游样例五类（agent/command/plugins/skills/tool，P1#4 隔离，不部署）
└── e2e-demo/                # 经过真实链路 e2e 验证的全能力样例（tool+hook+子agent+skill+command）
    ├── plugins/demo.ts          # timestamp 工具 + execute.before hook
    ├── tool-timestamp.ts        # timestamp 自定义工具
    ├── subagents/explorer.md    # summarizer 子 agent
    ├── skills/hello-skill/      # hello-skill
    └── commands/deploy.md       # deploy 命令
```

## 快速开始

```bash
# 构建定制 opencode2（fork dataagent-v2 分支 = v2 官方 + 定制提交）
./agents/build-opencode.sh

# 启动：bun 源码运行（无 opencode2 安装命令；日常三件套拉起直接 scripts/up.sh）
bun run --conditions=browser <fork>/packages/cli/src/index.ts serve --port 4096 --hostname 127.0.0.1
```

## 与上游的关系

- **fork**：`mawenyu/opencode`，分支 `dataagent-v2`（基于 `anomalyco/opencode` v2 分支）
- **定制提交**（相对上游 v2 ahead）：
  - `f756f3b` feat(server): MCP Tool Bridge HTTP endpoint（`POST /api/mcp/:server/tool/:tool/call`）
  - `d5d737f` feat(server): `GET /api/tool` — registered tool inventory endpoint（P27）
  - `329d67b` feat(prompt): P34 DataAgent 品牌化系统提示词（base.txt 重写）

## e2e 验证

`e2e-demo/` 内所有能力已通过真实链路验证（见 `../docs/plugin-e2e-report.md`）：
工具事件流全齐、hook 触发、子 agent 调用成功、skill/command 可见、复杂交错流事件零乱序。
