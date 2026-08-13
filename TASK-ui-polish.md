# UI 美化任务：DataAgent AG-UI 前端（Vue + CopilotKit + A2UI）

## 背景
这是一个已经跑通全链路的 AG-UI 聊天应用：
- **前端**：`/home/ubuntu/opencode-agui-app/vue-frontend`（Vue 3 + Vite + @copilotkit/vue 1.67.1 + @ag-ui/client）
- **架构**：Vue CopilotChat → HttpAgent → `/agui-api/opencode/ag-ui` → Java Spring Boot gateway(8090) → OpenCode server(4096) → DeepSeek
- **部署**：`vite build` 产物拷贝到 `/var/www/blog/agui/`，通过 `http://101.34.246.179/agui/` 访问，API 走 nginx `/agui-api/` 代理到 gateway

**当前问题：UI 太丑**（默认深色简陋样式，白屏风险、无设计感）。需要你美化成现代化的 B2B SaaS 数据 dashboard 风格。

## 参考设计（必读）
参考源码在 `/home/ubuntu/opencode-agui-app/ref/adk-dashboard/`，来自 CopilotKit 官方 `adk-dashboard` 示例（metrics/charts/dashboard 场景，最贴近 DataAgent）。关键文件：
- `app_globals.css` — **Apple 风格 B2B SaaS 配色方案**（CSS 变量，浅色主题为主）
- `components_dashboard_metrics_pinnedMetrics.tsx` — MetricCard 设计（图标+标题+大数字+hint，Card 布局）
- `components_dashboard_dashboard.tsx` — 整体布局（max-w-6xl 居中 + grid gap-4）

### 设计要点（从参考提炼）
1. **配色**（浅色主题，Apple B2B SaaS）：
   - background `#f8fafc`（浅灰）、card `#ffffff`（纯白）、foreground `#374151`（深灰文字）
   - accent/secondary `#6366f1`（靛蓝，用于强调、图表、focus ring）
   - border `#e5e7eb`、muted-foreground `#4b5563`
   - 图表色板：chart-1 `#6366f1`、chart-2 `#10b981`、chart-3 `#f59e0b`、chart-4 `#ef4444`、chart-5 `#8b5cf6`
   - 圆角 `--radius: 0.5rem`，字体 Manrope/Geist（可用系统字体栈替代）
2. **MetricCard**：白底卡片、左上小图标+标题（text-sm）、中间大数字（text-3xl font-bold 主题色）、下方 hint（muted 小字）
3. **布局**：顶部简洁 header，主体居中 max-w 容器，卡片 grid 排列，留白充足

## 要求（只动前端，不动 Java/架构）
1. **美化 `src/App.vue`**：
   - 应用上述浅色 B2B SaaS 配色和设计语言（不要用现在的深色 `#0f1115`）
   - header 简洁专业，带 DataAgent 品牌
   - CopilotChat 区域融入整体风格（可用 CSS 变量/覆盖 CopilotKit 默认样式）
2. **保持功能不变**：HttpAgent url `/agui-api/opencode/ag-ui`、`agents__unsafe_dev_only`、`a2ui catalog` 逻辑都不要动
3. **重新 build 并部署**：
   ```bash
   cd /home/ubuntu/opencode-agui-app/vue-frontend
   npx vite build
   rm -rf /var/www/blog/agui/* && cp -r dist/* /var/www/blog/agui/
   ```
4. **验证**：build 无报错，部署后 `curl -o /dev/null -w "%{http_code}" http://127.0.0.1/agui/` 返回 200

## 约束
- 不要改 `vite.config.ts` 的 `base: '/agui/'`
- 不要引入 Tailwind（项目没配），用纯 CSS / CSS 变量实现参考的配色和布局即可
- CopilotKit 组件样式可通过全局 CSS 覆盖（它用的类名可在浏览器 devtools 查，或加 `:deep()` / 全局选择器）
- 完成后报告：build 是否成功、部署路径、访问地址、做了哪些样式改动

## 验证清单（你自己做完后自查）
- [ ] `npx vite build` 成功
- [ ] 部署到 /var/www/blog/agui/
- [ ] 页面 HTTP 200
- [ ] 配色是浅色 B2B SaaS 风格（白/浅灰底 + 靛蓝 accent），不再是深色
- [ ] 聊天界面可用、美观
