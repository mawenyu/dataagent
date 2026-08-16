# DataAgent 协作指南

> 发给同事的快速上手文档。包含：在线体验、代码仓库、本地搭建、提 issue 协作流程。
> 2026-08-16 全面更新：界面结构 / 能力页 / workspace 隔离 / 多模态 / 品牌化为 DataAgent。

---

## 1. 在线体验（无需搭建）

**产品地址：http://101.34.246.179/agui/**

直接在浏览器打开即可体验。这是一个 AG-UI + A2UI 的数据分析 Agent（自称 DataAgent，AI 数据分析师）：

- **界面结构**：左侧 60px 导航 rail，三个主视图 —— **对话 / 能力 / 文件**。对话视图 = 会话列表 + 聊天工作区；「新建会话」一键开聊
- **能力页**：实时聚合展示 opencode2 的全部能力清单 —— server 工具（内置 12 + 插件注册 5 + 自定义）、插件、agents、skills、commands，外加**前端工具区**（showNotification / applySpreadsheetEdits 等客户端工具），分六区展示
- **文件面板**：每个会话独占工作目录（会话隔离已生效，互不串数据），文件列表 / 上传 / 预览 / 下载 / 删除都按当前会话隔离；后续版本将加入「公共区」
- **多模态**：聊天输入框「+」直接贴附件（点击选择或拖拽，CSV/JSON/图片等，最大 50MB），附件落进当前会话工作目录，agent 直接读取分析；文件面板里图片（png/jpg/gif/webp/svg 等）点击直接弹层预览
- Agent 思考过程（reasoning）实时可见；工具调用可见（可折叠展开参数和结果）
- **Generative UI**：让 agent「显示个图表/看板/表单」，它渲染出真实交互组件（不是文字描述）；A2UI 表单支持交互回传（提交后 agent 继续处理）
- **表格编辑走 HITL**：agent 改 CSV 会弹确认卡片，你确认才落盘
- context/token 用量显示、超时兜底、错误结构化提示

**试一试：**
- `分析最近30天销售情况，告诉我最值得关注的问题`（完整分析链路）
- `显示一个销售看板`（render_a2ui 渲染多组件 dashboard，验证 A2UI）
- `华东区域为什么下降？`（多轮上下文追问 / drill down）
- `把 sales-2026-08.csv 第 2 行的数量改成 9999`（HITL 确认弹窗 → 确认落盘）
- 聊天框「+」上传一个 CSV，然后 `分析我刚上传的文件`（附件链路）
- 切到「能力」视图，看 server 工具 / 插件 / skills 全清单

---

## 2. 代码仓库

| 仓库 | 地址 | 说明 |
|---|---|---|
| **主仓库** | https://github.com/mawenyu/dataagent | gateway + Vue 前端 + opencode2 定制层（`agents/`）+ 文档 |
| **OpenCode fork** | https://github.com/mawenyu/opencode | fork 自 `anomalyco/opencode`，定制分支 **`dataagent-v2`**（上游 v2 + `/api/tool` 工具清单端点等定制） |

**主仓库结构：**

```
dataagent/
├── gateway/            # Java Spring WebFlux 网关（AG-UI 协议端点 + A2UI 桥 + 能力聚合），:8090
├── vue-frontend/       # Vue3 + Vite 前端（composables 分层），部署到 /agui/
├── agents/             # OpenCode2 定制层：plugins（a2ui-tools 等）+ 构建部署脚本
│   ├── build-opencode.sh      # 从 fork 构建定制 opencode2 并部署扩展到 .opencode/
│   └── upstream-examples/     # 上游样例（不部署，仅参考）
├── packages/copilotkit-vue    # @copilotkit/vue fork（改动登记 FORK.md，patch 见 patches/）
├── scripts/            # up.sh 一键拉起三件套 + 实测脚本（curl SSE 端到端验证）
├── docs/               # 权威文档五件套 + spec/evidence/perf
└── DELIVERY-README.md  # 完整重建指南（先看这个）
```

**docs/ 权威文档：**
`PRODUCT_REQUIREMENTS.md`（产品需求）/ `CURRENT_ARCHITECTURE.md`（现状架构）/ `TARGET_ARCHITECTURE.md`（目标架构）/ `DEVELOPMENT_STATUS.md`（完成度与问题清单）/ `ACCEPTANCE_TESTS.md`（端到端验收）；另有 `SYSTEM_PROMPT.md`（系统提示词维护）、`CAPABILITIES_DEFINITION.md`（能力定义出处）。

---

## 3. 本地搭建（干净机器重建）

依赖：JDK 17 + Maven 3.8+、Node 20+、bun 1.x（https://bun.sh）、DeepSeek API key。

```bash
# 1) 主仓库
git clone https://github.com/mawenyu/dataagent.git
cd dataagent

# 2) opencode2 后端（fork 源码）
git clone --depth 50 --branch dataagent-v2 https://github.com/mawenyu/opencode.git ../opencode-fork
cd ../opencode-fork && bun install && cd ../dataagent

# 3) 部署 opencode 扩展到本工程 .opencode/
bash agents/build-opencode.sh --target . --skip-build

# 4) 配置（密钥不入库）
#    - .opencode/opencode.jsonc 里填 provider.deepseek.apiKey（参考 agents/opencode.jsonc.example）
#    - echo 'OPENCODE_SERVER_PASSWORD=<自定义>' > .env.opencode && chmod 600 .env.opencode
#      （gateway 经环境变量读取，application.yml 内无明文）

# 5) 一键拉起三件套（幂等；opencode :4096 / gateway :8090 / vite :3001）
scripts/up.sh
```

**验证：**
```bash
curl -u opencode:<pw> http://127.0.0.1:4096/api/health   # opencode2 → 200
curl http://127.0.0.1:8090/actuator/health               # gateway → UP
bash scripts/test-multi-turn.sh                          # 真实 5 轮连续对话回归
```

---

## 4. 协作流程（提 issue → 自动修复）

**直接到 https://github.com/mawenyu/dataagent/issues 提 issue。**

有自动化监控（每 15 分钟轮询）：

```
你提 issue
   ↓
监控发现新 issue → 自动派发给 AI 编码助手（Claude Code）
   ↓
分析根因 → TDD 修复 → 测试全绿 → commit + push 到 main
   ↓
在你的 issue 下评论修复的 commit sha
```

**提 issue 的建议格式**（能让 AI 修得更准）：
- **现象**：你做了什么操作，看到什么（截图/报错文本最有用）
- **期望**：应该是什么样
- **复现**：步骤或输入的对话内容

例如：
> **现象**：问"显示个图表"，聊天里直接显示了一串 `<tool_call>{...}` JSON，没有渲染成图
> **期望**：渲染成柱状图组件
> **复现**：首页输入"随便显示个图表"

---

## 5. 技术栈速览

```
浏览器 (Vue3 + @copilotkit/vue fork + @ag-ui/client)
   │  AG-UI over SSE (POST /agui-api/agent/run)
   ▼
Java Gateway (Spring WebFlux, :8090)
   │  事件翻译（v2 新方言）/ A2UI surface 注册 / a2uiAction 路由
   │  frontend tool 桥接（FrontendToolBridge）/ capabilities 聚合 / 会话级文件 API
   ▼
OpenCode2 server (:4096, bun, fork v2 源码)  →  DeepSeek LLM
```

- **AG-UI**：agent 通信协议（文本流/思考流/工具调用/frontend tools/state）
- **A2UI**：agent 生成式 UI（render_a2ui 渲染组件、a2uiAction 用户交互回传、request_user_confirm HITL 中断/恢复）
- **系统提示词**已品牌化为 DataAgent：能力域 = 数据加工 / 数据分析 / 数据治理（维护方式见 `docs/SYSTEM_PROMPT.md`）
- 详细架构见仓库 `docs/CURRENT_ARCHITECTURE.md`、`docs/TARGET_ARCHITECTURE.md`

---

有问题直接在 GitHub 提 issue，或找 @mawenyu。
