import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { PlainCodeBlock } from "../plain-code-block";

/**
 * 收尾2 / FORK#25：流式降级渲染器 PlainCodeBlock —— 纯 pre>code，无 shiki。
 */
describe("PlainCodeBlock", () => {
  it("渲染纯 pre>code，正文原样、带语言标记、无任何高亮 span", () => {
    const wrapper = mount(PlainCodeBlock, {
      props: { code: "const a = 1;\nconsole.log(a);", language: "js" },
    });
    const pre = wrapper.find("pre.cpk-plain-codeblock");
    expect(pre.exists()).toBe(true);
    expect(pre.attributes("data-language")).toBe("js");
    expect(pre.find("code").text()).toBe("const a = 1;\nconsole.log(a);");
    expect(wrapper.find("span").exists()).toBe(false); // shiki 会产出 span 级 token
  });

  it("无语言时不带 data-language", () => {
    const wrapper = mount(PlainCodeBlock, { props: { code: "plain" } });
    expect(wrapper.find("pre").attributes("data-language")).toBeUndefined();
  });
});
