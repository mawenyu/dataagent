<script setup lang="ts">
import { h, type VNodeChild } from 'vue'
import { z } from 'zod'
import { useRenderTool } from '@copilotkit/vue'

/**
 * Generative UI（AG-UI 能力演示）: render_a2ui 工具调用的定制渲染器。
 *
 * 通配 "*" 渲染器（DefaultToolRender）只显示通用 名称/参数/结果；
 * 这里为 render_a2ui 提供生成式 UI：按工具参数实时渲染一张"surface 构建卡"
 * —— 进行中 shimmer 动画 + 组件逐个出现，完成后展示组件清单徽标与数据规模。
 * 真实的 surface 仍由 A2UI renderer 在消息区渲染，本卡是工具调用过程的
 * 语义化呈现（对齐 CopilotKit renderToolCalls 的 generative UI 用法）。
 */

const argsSchema = z.object({
  surfaceId: z.string(),
  components: z.array(z.object({ component: z.string(), id: z.string() }).passthrough()),
  data: z.record(z.string(), z.any()).optional(),
  catalogId: z.string().optional(),
})

const palette: Record<string, string> = {
  MetricCard: '#6366f1', DataTable: '#10b981', BarChart: '#f59e0b', LineChart: '#8b5cf6',
  InsightCard: '#0ea5e9', WarningCard: '#ef4444', ActionButton: '#64748b',
}

function badge(name: string): VNodeChild {
  return h(
    'span',
    {
      style: {
        display: 'inline-block', fontSize: '11px', padding: '2px 8px', margin: '2px 4px 2px 0',
        borderRadius: '999px', color: '#fff', background: palette[name] ?? '#94a3b8',
      },
    },
    name,
  )
}

function renderSurfaceCard(props: {
  status: 'inProgress' | 'executing' | 'complete'
  parameters?: { surfaceId?: string; components?: { component: string; id: string }[]; data?: Record<string, unknown> }
  result?: string
}): VNodeChild {
  const p = props.parameters ?? {}
  const comps = p.components ?? []
  const running = props.status !== 'complete'
  const dataRows = p.data ? Object.keys(p.data).length : 0
  return h(
    'div',
    {
      class: 'gen-ui-surface' + (running ? ' shimmer' : ''),
      'data-testid': 'render-a2ui-call',
      'data-status': props.status,
      style: {
        margin: '6px 0', padding: '12px 14px', borderRadius: '10px',
        border: '1px solid #e0e7ff', background: running ? undefined : '#eef2ff',
      },
    },
    [
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
        h('span', { style: { fontSize: '15px' } }, running ? '⏳' : '🎨'),
        h('strong', { style: { fontSize: '13px', color: '#4338ca' } },
          running ? `正在生成 UI 看板 · ${p.surfaceId ?? '…'}` : `UI 看板已渲染 · ${p.surfaceId ?? ''}`),
      ]),
      comps.length > 0
        ? h('div', { style: { marginTop: '8px' } }, comps.map((c) => badge(c.component)))
        : null,
      props.status === 'complete'
        ? h('p', { style: { fontSize: '12px', color: '#6b7280', margin: '6px 0 0' } },
            `${comps.length} 个组件${dataRows ? ` · ${dataRows} 项数据绑定` : ''} · surface 见上方消息区`)
        : null,
    ],
  )
}

useRenderTool({
  name: 'render_a2ui',
  parameters: argsSchema,
  render: (props) => renderSurfaceCard(props as any),
})
</script>

<template>
  <!-- 纯注册组件，无视觉输出（渲染发生在 CopilotChat 的工具调用槽位） -->
</template>
