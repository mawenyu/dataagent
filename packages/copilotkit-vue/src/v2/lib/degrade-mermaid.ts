/**
 * FORK-PATCH(25 stream-degrade-mermaid): 流式渲染副本的 mermaid 降级。
 *
 * 归因（收尾2）：DeepSeek 分析类回答常带 ```mermaid 围栏；streamdown-vue
 * 对 mermaid 有独立分支（`if (v === "mermaid") return m(rt, {code})`），
 * 先于 codeblock 覆盖键，FORK#25 的 codeblock 降级拦不住。流式期间每个
 * 限频 tick 都对半截 mermaid 源码重跑 parse+layout → 秒级主线程冻结
 * （实测探针 ~3.2s，同版本无 mermaid 的 run 仅 30ms）。
 *
 * 手段：流式期喂给 StreamMarkdown 的渲染副本把 ```mermaid 围栏改名 ```text，
 * 按纯代码块降级渲染；流式结束用原始内容一次性真渲染 mermaid。
 * slot/复制等契约仍拿原始内容，不受影响。
 */
export function degradeMermaidForStreaming(content: string): string {
  if (!content.includes("```mermaid")) return content; // 快路径：无 mermaid 零开销
  return content.replace(/^```mermaid[ \t]*$/gm, "```text");
}
