// P26: 纯 tsc 类型检查的 .vue 模块垫片 —— SFC 以泛型组件看待，
// <script setup> 内部与模板不在纯 tsc 覆盖范围（模板级检查属 vue-tsc，
// 见 docs/DEV-EXPERIENCE.md 的已知债说明）。
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

// vite.config.ts 用 process.env.NODE_ENV；未装 @types/node 时给最小声明。
// 若日后引入 @types/node，删除本段避免重复声明。
declare const process: { env: Record<string, string | undefined> }
