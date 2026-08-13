import { describe, expect, it } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount } from "@vue/test-utils";
import { HttpAgent } from "@ag-ui/client";
import CopilotKitProvider from "../CopilotKitProvider.vue";
import { useCopilotKit } from "../useCopilotKit";
import { mergeAgents } from "../mergeAgents";

/**
 * FORK TESTS: cover the `directAgents` prop added by the internal fork.
 * See FORK.md at the package root.
 */

function makeAgent(url: string) {
  return new HttpAgent({ url });
}

describe("mergeAgents (fork helper)", () => {
  it("returns directAgents when it is the only map", () => {
    const direct = { default: makeAgent("http://x/ag-ui") };
    expect(mergeAgents(undefined, undefined, direct)).toEqual(direct);
  });

  it("merges all three maps with directAgents winning key conflicts", () => {
    const unsafe = { a: makeAgent("http://x/1"), shared: makeAgent("http://x/u") };
    const selfManaged = { b: makeAgent("http://x/2"), shared: makeAgent("http://x/s") };
    const direct = { c: makeAgent("http://x/3"), shared: makeAgent("http://x/d") };

    const merged = mergeAgents(unsafe, selfManaged, direct);

    expect(Object.keys(merged).sort()).toEqual(["a", "b", "c", "shared"]);
    expect(merged.shared).toBe(direct.shared);
    expect(merged.a).toBe(unsafe.a);
    expect(merged.b).toBe(selfManaged.b);
  });

  it("tolerates empty/undefined inputs", () => {
    expect(mergeAgents()).toEqual({});
  });
});

function mountProvider(props: Record<string, unknown>) {
  const observedCore =
    ref<ReturnType<typeof useCopilotKit>["copilotkit"]["value"]>();

  const Child = defineComponent({
    setup() {
      const { copilotkit } = useCopilotKit();
      observedCore.value = copilotkit.value;
      return () => h("div");
    },
  });

  const wrapper = mount(CopilotKitProvider, {
    props,
    slots: {
      default: () => h(Child),
    },
  });

  return { wrapper, observedCore };
}

describe("CopilotKitProvider directAgents (fork)", () => {
  it("registers directAgents on the core so getAgent finds them", () => {
    const agent = makeAgent("http://localhost:8090/opencode/ag-ui");
    const { observedCore } = mountProvider({
      directAgents: { default: agent },
    });

    // the core clones agents on registration, so compare by url identity
    expect(observedCore.value?.getAgent("default")?.url).toBe(agent.url);
  });

  it("does not warn/throw about missing runtimeUrl when only directAgents is set", () => {
    // Mounting without runtimeUrl/publicApiKey would trigger the config error
    // path unless hasLocalAgents (which now includes directAgents) is true.
    expect(() =>
      mountProvider({ directAgents: { default: makeAgent("http://x/ag-ui") } }),
    ).not.toThrow();
  });

  it("directAgents take precedence over agents__unsafe_dev_only/selfManagedAgents on key conflict", () => {
    const unsafe = makeAgent("http://x/unsafe");
    const selfManaged = makeAgent("http://x/self");
    const direct = makeAgent("http://x/direct");

    const { observedCore } = mountProvider({
      agents__unsafe_dev_only: { default: unsafe },
      selfManagedAgents: { default: selfManaged },
      directAgents: { default: direct },
    });

    expect(observedCore.value?.getAgent("default")?.url).toBe(direct.url);
  });
});
