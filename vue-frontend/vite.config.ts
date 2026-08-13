import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: '/agui/',
  server: {
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
