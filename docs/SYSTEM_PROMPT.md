# SYSTEM_PROMPT.md — 系统提示词维护指引（2026-08-16）

> DataAgent 的「人格」= opencode-fork 里的 `base.txt`。本文回答三个问题：
> 在哪改、改了怎么生效/验证、怎么排查 opencode 品牌残留。

## 1. 文件位置

| 项 | 值 |
|---|---|
| 文件 | `/home/ubuntu/opencode-fork/packages/core/src/session/runner/prompt/base.txt`（**fork 仓**，分支 `dataagent-v2`，**不在主仓**） |
| 加载点 | `packages/core/src/session/model-request.ts:21`、`generate-node.ts:16`：`import PROMPT_DEFAULT from "./runner/prompt/base.txt"`（bun 文本 import） |
| 拼装规则 | `system = [agent.info.system ? agent.info.system : PROMPT_DEFAULT, history.initial]` —— agent 定义带 `system` 字段时**覆盖** base.txt；当前 `.opencode/` 下无 agent 定义，base.txt 即全局系统提示词 |

当前内容（24 行）：DataAgent 品牌化人格 —— 自称「DataAgent，AI 数据分析师」；能力域 = 数据加工（清洗/转换/整合）/ 数据分析（探索/归因/趋势/对比）/ 数据治理（质量检查/口径血缘）；行为准则（数据诚实、先看数据工作目录、python3+pandas 复现、高风险操作走确认）；工具规范（并行调用、表格类文件必须走前端编辑工具、看板走 render_a2ui/render_report）。

## 2. 注意：这些段落不在 base.txt

gateway 在每次 run 时往用户消息/初始上下文里**动态拼接**运营段落，归 gateway 管，不在 fork：

- `<environment>数据工作目录: workspace/threads/<threadId>` —— `AgUiProtocolService.java`（普通 run 与 action 续跑两处）
- `<attachments>用户随消息上传了文件…</attachments>`
- client_tools 段落（frontend tool 使用约束，P27 加固）

改这些 = 改 `gateway/src/main/java/com/example/gateway/agui/AgUiProtocolService.java`，走 gateway TDD + `scripts/restart-gateway.sh`，与 base.txt 无关。

## 3. 修改流程

```bash
cd /home/ubuntu/opencode-fork
$EDITOR packages/core/src/session/runner/prompt/base.txt
git add packages/core/src/session/runner/prompt/base.txt
git commit -m "prompt: <改动摘要>"
git push origin dataagent-v2        # fork 仓 push，抖动就重试
```

生效：opencode 是 **bun 源码运行**（`scripts/up.sh` 直接跑 `packages/cli/src/index.ts`，无构建产物），改完**重启 opencode 进程**即生效：

```bash
pkill -f "opencode-fork/packages/cli"   # 或用 scripts/up.sh 前先杀
scripts/up.sh                            # 幂等拉起，opencode 会重新装载 base.txt
```

> agent 级覆盖：若只想给某个 agent 改人格，在 `agents/agent/<name>.md`（部署到 `.opencode/agent/`）里写 `system:` 字段，优先级高于 base.txt。当前未使用此机制。

## 4. 验证（真实 run，禁 mock）

改完必须真链路验证自称与能力域，不要只看文件：

```bash
# 经 gateway 发一轮真实对话（SSE），问身份与能力；python 抽 TEXT_MESSAGE_CONTENT 拼回复
curl -sN -m 120 -X POST http://127.0.0.1:8090/agent/run \
  -H 'Content-Type: application/json' \
  -d '{"threadId":"prompt-check-1","runId":"r1",
       "messages":[{"id":"m1","role":"user","content":"你是谁？你能做什么？"}]}' > /tmp/prompt-check.sse
python3 - <<'EOF'
import json
text = ''
for line in open('/tmp/prompt-check.sse'):
    line = line.strip()
    if line.startswith('data:'):
        try: ev = json.loads(line[5:])
        except Exception: continue
        if ev.get('type') == 'TEXT_MESSAGE_CONTENT':
            text += ev.get('delta', '')
print(text)
EOF
# 另确认收尾事件：grep -c RUN_FINISHED /tmp/prompt-check.sse → 1
```

> 2026-08-16 实测输出（基线对照）：「我是 DataAgent，一名 AI 数据分析师——你可以把数据文件放进工作目录，我用工具读取、清洗、分析并生成看板和报告，帮你从数据里找到结论和洞察。」

判定标准：
- 自称 **DataAgent** / AI 数据分析师，不提 opencode/终端/编程助手；
- 能力域落在数据加工/分析/治理，且提到数据工作目录（`<environment>` 注入生效的旁证）；
- 全程无 500/RUN_ERROR，`RUN_FINISHED` 收尾。

也可直接打 opencode（需密码，来自 `.env.opencode`）：
`curl -sN -u opencode:$PW http://127.0.0.1:4096/api/session ...`（路径以 fork server 为准，一般用 gateway 入口即可）。

## 5. opencode 品牌残留排查

终端用户可见面三处：模型自称、UI 文案、能力清单。排查命令：

```bash
# a. 提示词/人格面（fork 仓）—— 唯一系统提示词就是 base.txt（runner/prompt/ 下只此一个 txt）
grep -rni "opencode\|anomalyco" /home/ubuntu/opencode-fork/packages/core/src/session/runner/prompt/ \
     /home/ubuntu/opencode-fork/packages/core/src/agent/ 2>/dev/null

# b. 业务扩展面（主仓 agents/ → .opencode/）—— agent/command/skill 的 md 会进模型上下文
grep -rni "opencode" agents/agent agents/command agents/skills .opencode/ 2>/dev/null \
  | grep -v upstream-examples

# c. UI 面（主仓前端）—— 顶栏/欢迎页/关于文案
grep -rni "opencode" vue-frontend/src --include="*.vue" --include="*.ts" | grep -v test
```

实测兜底：按 §4 真实 run 追问「你是什么产品？谁开发的？」—— 回答必须守住 DataAgent 人格。

**已知可接受的残留**（用户不可见或属内部标识，不算问题）：
- `/agui-api/capabilities` 里插件 id 的 `opencode.tool.*` 前缀（opencode 内部命名，能力面板展示为工具分类依据，不是品牌文案）；
- 服务器日志 /tmp/opencode2.log、进程名、仓库名；
- `.opencode/` 目录名与 `opencode.jsonc` 配置文件名（opencode 运行时约定，改不了也不必改）。

## 6. 变更纪律

- base.txt 在 **fork 仓**，commit/push 到 `dataagent-v2`；主仓不留副本（避免双源漂移）。
- 改提示词 = 改行为，按 §4 真实 run 验证后再收工；验证证据（自称/能力域回复原文）落 `docs/evidence/`。
- 表格类文件「必须走前端编辑工具」等硬约束在 base.txt 与工具 description 双重声明（P27），两边改要保持一致。
