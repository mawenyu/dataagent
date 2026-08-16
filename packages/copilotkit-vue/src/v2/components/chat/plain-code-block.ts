import { defineComponent, h } from "vue";

/**
 * FORK-PATCH(25 plain-codeblock): 流式期间的 codeblock 降级渲染器。
 *
 * 背景（收尾2 归因）：长 reasoning 流式期间每个 markdown 重渲都会让
 * streamdown-vue 的默认 CodeBlock 跑一遍 shiki 高亮（分配风暴实锤）。
 * streamdown-vue 的 components map 支持 `codeblock` 键覆盖默认实现
 * （dist: `const N = l.codeblock || se`）。流式中喂本组件 = 纯 <pre><code>
 * 零高亮；流式结束后回到默认 shiki CodeBlock（一次性高亮 + 复制/下载按钮）。
 *
 * props 与 streamdown-vue CodeBlock 对齐（code/language 必给，其余忽略）。
 */
export const PlainCodeBlock = defineComponent({
  name: "PlainCodeBlock",
  props: {
    code: { type: String, default: "" },
    language: { type: String, default: "" },
  },
  setup(props) {
    return () =>
      h(
        "pre",
        {
          class: "cpk-plain-codeblock",
          "data-language": props.language || undefined,
        },
        [h("code", props.code)],
      );
  },
});
