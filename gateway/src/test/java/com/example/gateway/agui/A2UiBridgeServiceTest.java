package com.example.gateway.agui;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.codec.ServerSentEvent;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;

/**
 * render_a2ui 实参防御性规整（2026-08-15 实测驱动）：
 * 模型经常输出嵌套 children（组件对象直接塞进 children 数组，而不是
 * v0.9 约定的"扁平列表 + children 为 id 数组"），还会带上显式 null 属性
 * （"delta": null）—— 两者都会让前端 catalog 校验/渲染失败。
 * bridge 在 execute() 前把组件树拍平并剥掉 null 属性。
 */
class A2UiBridgeServiceTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private A2UiBridgeService bridge;

    @BeforeEach
    void setUp() {
        bridge = new A2UiBridgeService(new A2UiService(), new A2UiSurfaceRegistry());
    }

    private JsonNode snapshotOps(ServerSentEvent<String> sse) throws Exception {
        return MAPPER.readTree(sse.data()).path("content").path("a2ui_operations");
    }

    @Test
    void nestedChildrenAreFlattenedToIdReferences() throws Exception {
        String args = """
                {"surfaceId":"s1","components":[
                  {"component":"Column","id":"root","children":[
                    {"component":"MetricCard","id":"m1","title":"总销售额","value":{"path":"total"},"delta":null},
                    {"component":"Row","id":"r1","children":[
                      {"component":"Text","id":"t1","text":"hello"}
                    ]}
                  ]}
                ],"data":{"total":123}}""";
        Optional<ServerSentEvent<String>> out = bridge.execute("run", "thread", MAPPER.readTree(args));
        assertTrue(out.isPresent(), "nested components must be accepted after flattening");
        JsonNode ops = snapshotOps(out.get());
        JsonNode comps = null;
        for (JsonNode op : ops) {
            if (op.has("updateComponents")) comps = op.path("updateComponents").path("components");
        }
        assertNotNull(comps);
        // 4 个组件全部拍平为顶层条目
        assertEquals(4, comps.size(), "nested tree must flatten to a flat list: " + comps);
        JsonNode root = comps.get(0);
        assertEquals("Column", root.path("component").asText());
        assertEquals("root", root.path("id").asText());
        // children 变成 id 引用
        assertEquals(List.of("m1", "r1"),
                MAPPER.convertValue(root.path("children"), List.class));
        // 显式 null 属性被剥掉（zod optional 不接受 null）
        JsonNode m1 = null, t1 = null;
        for (JsonNode c : comps) {
            if ("m1".equals(c.path("id").asText())) m1 = c;
            if ("t1".equals(c.path("id").asText())) t1 = c;
        }
        assertNotNull(m1);
        assertFalse(m1.has("delta"), "null props must be stripped");
        assertEquals("总销售额", m1.path("title").asText());
        assertNotNull(t1);
    }

    /** 2026-08-15 实测：模型会传 catalogId 短别名（"data-agent"）——前端只注册了
        一个 catalog，非标准值应归一化而不是拒绝整个 surface。 */
    @Test
    void catalogIdAliasIsNormalizedNotRejected() throws Exception {
        String args = """
                {"surfaceId":"s1","catalogId":"data-agent","components":[
                  {"component":"MetricCard","id":"root","title":"t","value":"v"}
                ]}""";
        Optional<ServerSentEvent<String>> out = bridge.execute("run", "thread", MAPPER.readTree(args));
        assertTrue(out.isPresent(), "catalogId alias must be normalized, not rejected");
        JsonNode ops = snapshotOps(out.get());
        for (JsonNode op : ops) {
            if (op.has("createSurface")) {
                assertEquals(A2UiService.DATA_AGENT_CATALOG_ID,
                        op.path("createSurface").path("catalogId").asText());
            }
        }
    }

    @Test
    void flatComponentsPassThroughUnchanged() throws Exception {        String args = """
                {"surfaceId":"s1","components":[
                  {"component":"Column","id":"root","children":["a"]},
                  {"component":"Text","id":"a","text":"hi"}
                ]}""";
        Optional<ServerSentEvent<String>> out = bridge.execute("run", "thread", MAPPER.readTree(args));
        assertTrue(out.isPresent());
        JsonNode ops = snapshotOps(out.get());
        for (JsonNode op : ops) {
            if (op.has("updateComponents")) {
                JsonNode comps = op.path("updateComponents").path("components");
                assertEquals(2, comps.size());
                assertEquals("a", comps.get(0).path("children").get(0).asText());
            }
        }
    }

    /** 2026-08-15 实测：模型还会用 "items" 而不是 "children" 装嵌套子组件。 */
    @Test
    void itemsArrayIsTreatedAsNestedChildren() throws Exception {
        String args = """
                {"surfaceId":"s1","components":[
                  {"component":"Column","id":"root","items":[
                    {"component":"MetricCard","id":"m1","title":"总销售额","value":"1,360,700"},
                    {"component":"BarChart","id":"c1","xField":"d","yField":"v","data":[{"d":"a","v":1}]}
                  ]}
                ]}""";
        Optional<ServerSentEvent<String>> out = bridge.execute("run", "thread", MAPPER.readTree(args));
        assertTrue(out.isPresent());
        JsonNode ops = snapshotOps(out.get());
        for (JsonNode op : ops) {
            if (op.has("updateComponents")) {
                JsonNode comps = op.path("updateComponents").path("components");
                assertEquals(3, comps.size(), "items 里的嵌套组件也要拍平: " + comps);
                JsonNode root = comps.get(0);
                assertEquals(List.of("m1", "c1"),
                        MAPPER.convertValue(root.path("children"), List.class),
                        "items 应改写为 children id 引用");
                assertFalse(root.has("items"), "items prop 不应残留");
            }
        }
    }

    /** task4 组件全量：PieChart/Badge/Markdown 在白名单内。 */
    @Test
    void pieBadgeMarkdownAreWhitelisted() throws Exception {
        String args = """
                {"surfaceId":"s1","components":[
                  {"component":"Column","id":"root","children":["p","b","m"]},
                  {"component":"PieChart","id":"p","labelField":"k","valueField":"v","data":[{"k":"a","v":1}]},
                  {"component":"Badge","id":"b","text":"ok","variant":"success"},
                  {"component":"Markdown","id":"m","text":"# 标题"}
                ]}""";
        assertTrue(bridge.execute("run", "thread", MAPPER.readTree(args)).isPresent());
    }

    @Test
    void nestedNonWhitelistedComponentIsRejected() throws Exception {
        String args = """
                {"surfaceId":"s1","components":[
                  {"component":"Column","id":"root","children":[
                    {"component":"Script","id":"evil","src":"http://x"}
                  ]}
                ]}""";
        assertTrue(bridge.execute("run", "thread", MAPPER.readTree(args)).isEmpty(),
                "non-whitelisted nested component must still be rejected after flattening");
    }

    // ---- vision-P2: 模型常见"自创契约"的确定性归一（2026-08-15 layout 批次实测驱动）----

    private JsonNode flatComponents(Optional<ServerSentEvent<String>> out) throws Exception {
        JsonNode ops = snapshotOps(out.get());
        for (JsonNode op : ops) {
            if (op.has("updateComponents")) return op.path("updateComponents").path("components");
        }
        return null;
    }

    private JsonNode byId(JsonNode comps, String id) {
        for (JsonNode c : comps) if (id.equals(c.path("id").asText())) return c;
        return null;
    }

    @Test
    void tabsItemsPlusChildrenNormalizedToTabsProp() throws Exception {
        // 实测模型输出：Tabs 用 items[{label,value}] + children[id...] ——
        // items 不是嵌套组件（无 id），不得误判拍平；归一为契约 tabs[{title,child}]
        String args = """
                {"surfaceId":"s1","components":[
                  {"component":"Column","id":"root","children":["tabs"]},
                  {"component":"Tabs","id":"tabs","children":["tab-a","tab-b"],
                    "items":[{"label":"页签一","value":"tab-a"},{"label":"页签二","value":"tab-b"}]},
                  {"component":"Text","id":"tab-a","text":"A"},
                  {"component":"Text","id":"tab-b","text":"B"}
                ]}""";
        Optional<ServerSentEvent<String>> out = bridge.execute("run", "t", MAPPER.readTree(args));
        assertTrue(out.isPresent(), "Tabs items+children 必须被接受（2026-08-15 实测曾整面拒渲染）");
        JsonNode tabs = byId(flatComponents(out), "tabs");
        assertFalse(tabs.has("items"), "items 已消费");
        assertFalse(tabs.has("children"), "children 已消费");
        assertEquals(2, tabs.path("tabs").size());
        assertEquals("页签一", tabs.path("tabs").get(0).path("title").asText());
        assertEquals("tab-a", tabs.path("tabs").get(0).path("child").asText());
    }

    @Test
    void textValueAliasedToText() throws Exception {
        String args = """
                {"surfaceId":"s1","components":[
                  {"component":"Column","id":"root","children":["t1"]},
                  {"component":"Text","id":"t1","value":"模型爱用 value"}
                ]}""";
        JsonNode t1 = byId(flatComponents(bridge.execute("run", "t", MAPPER.readTree(args))), "t1");
        assertEquals("模型爱用 value", t1.path("text").asText(), "Text.value → text");
        assertFalse(t1.has("value"));
    }

    @Test
    void rowJustifyAlignAliased() throws Exception {
        String args = """
                {"surfaceId":"s1","components":[
                  {"component":"Row","id":"root","children":[],"justifyContent":"spaceBetween","alignItems":"center"}
                ]}""";
        JsonNode row = byId(flatComponents(bridge.execute("run", "t", MAPPER.readTree(args))), "root");
        assertEquals("spaceBetween", row.path("justify").asText());
        assertEquals("center", row.path("align").asText());
        assertFalse(row.has("justifyContent"));
        assertFalse(row.has("alignItems"));
    }

    @Test
    void modalChildrenSplitToTriggerAndContent() throws Exception {
        String args = """
                {"surfaceId":"s1","components":[
                  {"component":"Column","id":"root","children":["m"]},
                  {"component":"Modal","id":"m","children":["trg","body"]},
                  {"component":"Button","id":"trg","child":"trg-t","action":{"event":{"name":"open"}}},
                  {"component":"Text","id":"trg-t","text":"打开"},
                  {"component":"Text","id":"body","text":"弹层内容"}
                ]}""";
        JsonNode modal = byId(flatComponents(bridge.execute("run", "t", MAPPER.readTree(args))), "m");
        assertEquals("trg", modal.path("trigger").asText());
        assertEquals("body", modal.path("content").asText());
        assertFalse(modal.has("children"));
    }

    @Test
    void buttonLabelWrappedIntoTextChild() throws Exception {
        String args = """
                {"surfaceId":"s1","components":[
                  {"component":"Column","id":"root","children":["b"]},
                  {"component":"Button","id":"b","label":"提交","action":{"event":{"name":"go"}}}
                ]}""";
        JsonNode comps = flatComponents(bridge.execute("run", "t", MAPPER.readTree(args)));
        JsonNode btn = byId(comps, "b");
        assertEquals("b-label", btn.path("child").asText(), "label 合成 Text 子组件");
        JsonNode label = byId(comps, "b-label");
        assertNotNull(label);
        assertEquals("Text", label.path("component").asText());
        assertEquals("提交", label.path("text").asText());
    }

    @Test
    void cardSingleChildrenBecomesChild() throws Exception {
        String args = """
                {"surfaceId":"s1","components":[
                  {"component":"Card","id":"root","children":["inner"]},
                  {"component":"Text","id":"inner","text":"x"}
                ]}""";
        JsonNode card = byId(flatComponents(bridge.execute("run", "t", MAPPER.readTree(args))), "root");
        assertEquals("inner", card.path("child").asText());
        assertFalse(card.has("children"));
    }

    @Test
    void cardMultiChildrenWrappedInColumn() throws Exception {
        String args = """
                {"surfaceId":"s1","components":[
                  {"component":"Card","id":"root","children":["a","b"]},
                  {"component":"Text","id":"a","text":"A"},
                  {"component":"Text","id":"b","text":"B"}
                ]}""";
        JsonNode comps = flatComponents(bridge.execute("run", "t", MAPPER.readTree(args)));
        JsonNode card = byId(comps, "root");
        assertEquals("root-col", card.path("child").asText());
        JsonNode col = byId(comps, "root-col");
        assertEquals("Column", col.path("component").asText());
        assertEquals(2, col.path("children").size());
    }

    /** vision-P4: children id 环（A↔B）—— 整体拒绝（前端另有渲染层防护，双保险）。 */
    @Test
    void childrenCycleRejected() throws Exception {
        String args = """
                {"surfaceId":"s1","components":[
                  {"component":"Column","id":"root","children":["a","ok"]},
                  {"component":"Column","id":"a","children":["b"]},
                  {"component":"Column","id":"b","children":["a"]},
                  {"component":"Text","id":"ok","text":"x"}
                ]}""";
        assertTrue(bridge.execute("run", "t", MAPPER.readTree(args)).isEmpty(),
                "id 环必须拒绝（否则前端递归渲染栈溢出）");
    }

    /** 自引用（A children [A]）也是环。 */
    @Test
    void selfReferenceCycleRejected() throws Exception {
        String args = """
                {"surfaceId":"s1","components":[
                  {"component":"Column","id":"root","children":["root"]}
                ]}""";
        assertTrue(bridge.execute("run", "t", MAPPER.readTree(args)).isEmpty());
    }

    /** 无环的深层嵌套（8 层）正常放行。 */
    @Test
    void deepNestingWithoutCycleAccepted() throws Exception {
        StringBuilder sb = new StringBuilder();
        sb.append("root");
        StringBuilder json = new StringBuilder("{\"surfaceId\":\"s1\",\"components\":[");
        json.append("{\"component\":\"Column\",\"id\":\"root\",\"children\":[\"l1\"]}");
        for (int i = 1; i <= 7; i++) {
            String child = (i == 7) ? "deep" : "l" + (i + 1);
            json.append(",{\"component\":\"Column\",\"id\":\"l").append(i)
                    .append("\",\"children\":[\"").append(child).append("\"]}");
        }
        json.append(",{\"component\":\"Text\",\"id\":\"deep\",\"text\":\"x\"}]}");
        assertTrue(bridge.execute("run", "t", MAPPER.readTree(json.toString())).isPresent());
    }

    // ---- P5-1: validate() 公开校验（插件回执同步用，spec: a2ui-component-matrix.md 附录）----

    @Test
    void validateReturnsNullForValidArgs() throws Exception {
        String args = """
                {"surfaceId":"s1","components":[
                  {"component":"Column","id":"root","children":["m"]},
                  {"component":"MetricCard","id":"m","title":"t","value":"v"}
                ]}""";
        assertNull(bridge.validate(MAPPER.readTree(args)));
    }

    @Test
    void validateReportsWhitelistRejection() throws Exception {
        String args = """
                {"surfaceId":"s1","components":[
                  {"component":"Column","id":"root","children":["g"]},
                  {"component":"Gauge","id":"g","value":42}
                ]}""";
        String reason = bridge.validate(MAPPER.readTree(args));
        assertNotNull(reason);
        assertTrue(reason.contains("Gauge"), reason);
    }

    @Test
    void validateReportsCycle() throws Exception {
        String args = """
                {"surfaceId":"s1","components":[
                  {"component":"Column","id":"root","children":["a"]},
                  {"component":"Column","id":"a","children":["b"]},
                  {"component":"Column","id":"b","children":["a"]}
                ]}""";
        String reason = bridge.validate(MAPPER.readTree(args));
        assertNotNull(reason);
        assertTrue(reason.toLowerCase().contains("cycle"), reason);
    }

    @Test
    void validateReportsStructuralProblems() throws Exception {
        assertNotNull(bridge.validate(MAPPER.readTree("{}")), "缺 components");
        assertNotNull(bridge.validate(MAPPER.readTree(
                "{\"surfaceId\":\"bad id!\",\"components\":[{\"component\":\"Text\",\"id\":\"root\",\"text\":\"x\"}]}")),
                "非法 surfaceId");
        assertNotNull(bridge.validate(MAPPER.readTree(
                "{\"surfaceId\":\"s1\",\"components\":[]}")), "空组件数组");
        assertNotNull(bridge.validate(MAPPER.readTree(
                "{\"surfaceId\":\"s1\",\"components\":[{\"component\":\"Text\",\"text\":\"x\"}]}")),
                "缺 id");
    }

    /** 校验端点：POST /a2ui/validate → {ok} / {ok:false, reason}。 */
    @Test
    void validateEndpoint() throws Exception {
        var controller = new A2UiValidateController(bridge);
        var ok = controller.validate(MAPPER.readTree(
                "{\"surfaceId\":\"s1\",\"components\":[{\"component\":\"Text\",\"id\":\"root\",\"text\":\"x\"}]}"));
        assertTrue(ok.path("ok").asBoolean());

        var bad = controller.validate(MAPPER.readTree(
                "{\"surfaceId\":\"s1\",\"components\":[{\"component\":\"Gauge\",\"id\":\"root\"}]}"));
        assertFalse(bad.path("ok").asBoolean());
        assertTrue(bad.path("reason").asText().contains("Gauge"));
    }

    /** P6-A 实测驱动：缺 root 组件（id=root）→ validate 报告 + execute 拒绝。 */
    @Test
    void missingRootRejected() throws Exception {
        String args = """
                {"surfaceId":"s1","components":[
                  {"component":"TextField","id":"kw","label":"x"},
                  {"component":"Button","id":"b","child":"t"}
                ]}""";
        String reason = bridge.validate(MAPPER.readTree(args));
        assertNotNull(reason);
        assertTrue(reason.contains("root"), reason);
        assertTrue(bridge.execute("run", "t", MAPPER.readTree(args)).isEmpty(),
                "无 root 的 surface 前端永远 shimmer，必须拒绝");
    }

    /** root 存在但 id 大小写/拼写不同（"Root"/"main"）同样算缺 root。 */
    @Test
    void rootMustBeExactId() throws Exception {
        String args = """
                {"surfaceId":"s1","components":[
                  {"component":"Column","id":"Root","children":["t"]},
                  {"component":"Text","id":"t","text":"x"}
                ]}""";
        assertNotNull(bridge.validate(MAPPER.readTree(args)));
    }
}
