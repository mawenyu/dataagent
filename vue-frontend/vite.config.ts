import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // dev server 直接用根路径对外（http://<host>:3001/）；生产构建仍走 /agui/ 由 nginx 服务
  base: process.env.NODE_ENV === 'production' ? '/agui/' : '/',
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
