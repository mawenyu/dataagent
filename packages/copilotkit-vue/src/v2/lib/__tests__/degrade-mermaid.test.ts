import { describe, expect, it } from "vitest";
import { degradeMermaidForStreaming } from "../degrade-mermaid";

/**
 * 收尾2 / FORK#25 补充：流式渲染副本 mermaid 围栏降级（mermaid 分支在
 * streamdown-vue 内先于 codeblock 覆盖键，只能靠渲染副本改名拦截）。
 */
describe("degradeMermaidForStreaming", () => {
  it("mermaid 围栏改名 text（开/闭围栏都改），其余内容不动", () => {
    const src = "前文\n```mermaid\ngraph TD; A-->B\n```\n后文\n```js\nconst a=1;\n```";
    const out = degradeMermaidForStreaming(src);
    expect(out).toContain("```text\ngraph TD; A-->B\n```");
    expect(out).toContain("```js\nconst a=1;\n```"); // js 围栏不受影响
    expect(out).not.toContain("```mermaid");
  });

  it("未闭合的半截 mermaid 围栏（流式中）也降级", () => {
    const src = "思考中\n```mermaid\ngraph TD; A-->";
    expect(degradeMermaidForStreaming(src)).toBe("思考中\n```text\ngraph TD; A-->");
  });

  it("无 mermaid 原样返回（同引用，零开销快路径）", () => {
    const src = "普通文本 ```js\ncode\n```";
    expect(degradeMermaidForStreaming(src)).toBe(src);
  });

  it("行内提到 ```mermaid 但非独占行（如缩进在列表里）不误改", () => {
    const src = "- 说明 ```mermaid 用法";
    expect(degradeMermaidForStreaming(src)).toBe(src);
  });
});
