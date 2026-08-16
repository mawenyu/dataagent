# DEV-EXPERIENCE — 开发体验与提交前检查（P26 · 2026-08-16）

## 前端脚本（vue-frontend/package.json）

| 脚本 | 命令 | 说明 |
|---|---|---|
| `npm run test` | `vitest run` | 全量单测（CI/提交前用） |
| `npm run test:watch` | `vitest` | 监听模式，TDD 红绿循环日常用 |
| `npm run typecheck` | `tsc --noEmit -p tsconfig.typecheck.json` | 应用源码类型检查 |

### typecheck 的覆盖边界（已知债）

- 覆盖 `src/**/*.ts` 应用源码；**排除 `*.test.ts`**——测试里 fetch/agent mock 打桩的
  类型噪音大，测试正确性由 vitest 运行时保证。收紧测试类型是后续债。
- 纯 `tsc` 不检查 SFC `<script setup>` 内部与模板（`src/shims-vue.d.ts` 把 `.vue`
  当泛型组件）。模板级检查需要 `vue-tsc`，属可选升级，未引入。
- `dataAgentCatalog.ts` 的 ActionButton **单成员 `z.union` 是 binder 识别 ACTION
  schema 的运行时契约**（塌缩成裸 object 会断 HITL 回传，有测试钉住）——
  类型层面用 `as any` 放行，勿"清理"。

## 编辑器一致性

根目录 `.editorconfig`：UTF-8 / LF / 末行换行 / 去尾随空白；默认 2 空格，
Java 4 空格，Makefile tab。主流编辑器（VSCode/JetBrains/Vim 插件）自动生效。

## 提交前检查建议（pre-commit）

仓库当前**未装 hook 框架**（避免给并行会话引入额外依赖）。建议的本地自检顺序：

```bash
# 前端（改了 vue-frontend/ 或 packages/copilotkit-vue/ 时）
cd vue-frontend && npm run typecheck && npm run test

# gateway（改了 gateway/ 时）
mvn -f gateway/pom.xml test
```

想强制拦截可选用 git 原生 hook（`.git/hooks/pre-commit`，不入库、不影响他人）：

```bash
#!/bin/bash
set -e
changed=$(git diff --cached --name-only)
echo "$changed" | grep -q '^vue-frontend/' && (cd vue-frontend && npm run typecheck && npm run test)
echo "$changed" | grep -q '^gateway/' && mvn -f gateway/pom.xml test -q
```

> 纪律提醒（CLAUDE.md）：secret 不入库；禁 `git add -A` / `git stash`（共享工作树）；
> fork 改动必须登记 `packages/copilotkit-vue/FORK.md`。
