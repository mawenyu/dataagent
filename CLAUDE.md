# CLAUDE.md — DataAgent 仓库指引

## 这是什么

AI Data Agent Web App：Vue3 + @copilotkit/vue(fork) 前端 → Java gateway(:8090, Spring WebFlux) → OpenCode server(:4096, bun 源码运行) → DeepSeek。协议栈 AG-UI + A2UI。
产品/架构/验收的权威文档：`docs/PRODUCT_REQUIREMENTS.md`、`docs/CURRENT_ARCHITECTURE.md`、`docs/TARGET_ARCHITECTURE.md`、`docs/DEVELOPMENT_STATUS.md`（问题清单与下一步）、`docs/ACCEPTANCE_TESTS.md`。

## 布局

- `vue-frontend/` — 业务前端（composables 分层，无 pinia）；测试 `npm run test`（= vitest run；监听 `npm run test:watch`；类型检查 `npm run typecheck`，覆盖边界见 docs/DEV-EXPERIENCE.md）；**无 npx**
- `packages/copilotkit-vue/` — CopilotKit fork（base v1.67.1）；**fork 改动必须登记 `FORK.md` 条目**；build 经 app 的 prebuild 自动触发
- `gateway/` — Java 后端；测试 `mvn -f gateway/pom.xml test`
- `agents/` — opencode 扩展（部署到 `.opencode/`）；业务关键只有 `plugins/a2ui-tools.ts`（5 个服务端裁决工具）
- `scripts/` — `up.sh`（三件套幂等拉起）/ `restart-gateway.sh`（kill→package→/tmp 副本→启动）/ e2e 实测脚本
- `docs/spec|evidence|perf` — 协议矩阵、实测证据、性能基线

## 硬性纪律

- **TDD**：先写失败测试再实现；每特性一 commit（user mawenyu/mawenyu@users.noreply.github.com，结尾 Claude 署名）；push 抖动就重试循环
- **禁 mock 核心链路**：验收走真 gateway+opencode（e2e 脚本模式）；单测可打桩 fetch
- **禁原生弹窗**（alert/confirm/prompt），用自绘 modal/toast；**禁 fake 数据**
- **并行会话共享工作树**：vision 线负责 A2UI surface 渲染器（`packages/copilotkit-vue/src/v2/components/a2ui/`、`RenderA2uiToolCall` 等）——别碰；功能一成即 commit（否则会被对方 `git add -A` 卷走）；**不要 git stash**
- gateway 重启只用 `scripts/restart-gateway.sh`（共享 :8090，别人可能在跑 e2e，重启前看一眼 `/tmp/opencode2.log` 活跃度）
- secret 不入库：opencode 密码走 `.env.opencode`；DeepSeek key 在 `.opencode/opencode.jsonc`（不入库）

## 常用命令

```bash
scripts/up.sh                          # 拉起/自检三件套
cd vue-frontend && npm run test        # 前端全量（test:watch 监听 / typecheck 类型检查）
mvn -f gateway/pom.xml test            # gateway 全量
scripts/test-multi-turn.sh             # 真实 5 轮回归
```
