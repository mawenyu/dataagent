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

    @Test
    void flatComponentsPassThroughUnchanged() throws Exception {
        String args = """
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
}
