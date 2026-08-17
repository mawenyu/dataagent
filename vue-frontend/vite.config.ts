import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { visualizer } from 'rollup-plugin-visualizer'

// 瘦身(2026-08-17): @copilotkit/vue 是 file: 软链,fork 内 import 默认从
// packages/copilotkit-vue/node_modules 解析 → 与应用根 node_modules 同版本双实例
// (zod/date-fns/@ag-ui/client/@a2ui/rxjs/protobuf/fast-json-patch 全中)。
// dedupe 强制统一到应用根副本(版本已逐一核对一致),消除重复打包。
const DEDUPE = [
  'zod',
  'date-fns',
  'rxjs',
  '@ag-ui/client',
  '@ag-ui/core',
  '@ag-ui/proto',
  '@a2ui/web_core',
  'fast-json-patch',
  '@bufbuild/protobuf',
]

export default defineConfig({
  plugins: [
    vue(),
    // ANALYZE=1 npm run build → dist/stats.html 可视化报告(默认关闭,不影响产物)
    ...(process.env.ANALYZE
      ? [visualizer({ filename: 'dist/stats.html', template: (process.env.ANALYZE_TEMPLATE || 'treemap') as 'treemap', gzipSize: true })]
      : []),
  ],
  resolve: {
    dedupe: DEDUPE,
    alias: [
      // phoenix(Phoenix LiveView client,10.2KB gz): @copilotkit/core 顶层静态引入,
      // 但仅 Cloud 托管模式冷 Observable 订阅时构造 —— 本应用 direct-agents 永不触达,
      // 用显式抛错的 shim 挤出首屏 bundle(详见 src/shims/phoenix.ts)
      { find: /^phoenix$/, replacement: new URL('./src/shims/phoenix.ts', import.meta.url).pathname },
      // date-fns(25.7KB gz): 唯一消费方是 @a2ui/web_core basic_functions 的 FormatDate
      // (format(date, fmt)) —— mini shim 覆盖常用 token(契约 src/shims/date-fns.test.ts)
      { find: /^date-fns$/, replacement: new URL('./src/shims/date-fns.ts', import.meta.url).pathname },
    ],
  },
  // dev server 直接用根路径对外（http://<host>:3001/）；生产构建仍走 /agui/ 由 nginx 服务
  base: process.env.NODE_ENV === 'production' ? '/agui/' : '/',
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        // vision-P2: A2UI 组件画廊（截图留证页）
        gallery: 'a2ui-gallery.html',
      },
    },
  },
  server: {
    host: true, // 0.0.0.0 —— 公网可访问
    port: 3001,
    proxy: {
      '/agui-api': {
        target: 'http://127.0.0.1:8090',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/agui-api/, ''),
      },
    },
  },
})
