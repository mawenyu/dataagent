<script setup lang="ts">
import { useDefaultRenderTool } from '@copilotkit/vue'

/**
 * 需求7-3: 工具调用可见。
 * CopilotChat 的 fallback 路径在未注册 renderToolCalls 时不渲染工具调用；
 * 这里注册通配 "*" 渲染器（fork 内置的可折叠 UI：状态点 + 工具名 + 状态徽标 +
 * 耗时;展开查看参数/结果,F3 失败态✗、P-L 长文本截断展开），让 agent 的
 * bash/read/render_a2ui 等过程可见。
 * 必须挂在 CopilotKitProvider 内部（依赖 useCopilotKit 注入）。
 */
useDefaultRenderTool()
</script>

<template>
  <!-- 纯注册组件，无视觉输出 -->
</template>
