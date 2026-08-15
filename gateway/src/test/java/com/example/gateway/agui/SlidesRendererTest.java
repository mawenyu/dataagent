package com.example.gateway.agui;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.codec.ServerSentEvent;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;

/**
 * render_slides（spec: docs/spec/copilotkit-capabilities.md B2, presentation 模式）：
 * 模型产 slides 结构，gateway 确定性展开为 A2UI Tabs surface。
 */
class SlidesRendererTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private SlidesRenderer renderer;

    @BeforeEach
    void setUp() {
        renderer = new SlidesRenderer(new A2UiService(), new A2UiSurfaceRegistry());
    }

    private JsonNode snapshotOps(ServerSentEvent<String> sse) throws Exception {
        return MAPPER.readTree(sse.data()).path("content").path("a2ui_operations");
    }

    private List<JsonNode> components(JsonNode ops) {
        List<JsonNode> out = new ArrayList<>();
        for (JsonNode op : ops) {
            if (op.has("updateComponents")) op.path("updateComponents").path("components").forEach(out::add);
        }
        return out;
    }

    @Test
    void slidesExpandToTabsSurface() throws Exception {
        JsonNode args = MAPPER.readTree("""
                {"title":"八月销售演示","slides":[
                  {"heading":"总览","bullets":["总销售额 136 万","订单 137 单"],"note":"开场 30 秒"},
                  {"heading":"区域","bullets":["华北第一"]},
                  {"heading":"建议","bullets":["加大华北投放","关注西南下滑"]}
                ]}
                """);
        Optional<ServerSentEvent<String>> out = renderer.execute("run", "thread", args);
        assertTrue(out.isPresent());
        List<JsonNode> comps = components(snapshotOps(out.get()));

        JsonNode tabs = comps.stream().filter(c -> "Tabs".equals(c.path("component").asText())).findFirst().orElseThrow();
        assertEquals(3, tabs.path("tabs").size());
        assertEquals("1. 总览", tabs.path("tabs").get(0).path("title").asText());
        assertEquals("slide-0", tabs.path("tabs").get(0).path("child").asText());

        // 每页一个 Card，内含 Markdown(bullets) + caption(note)
        JsonNode md = comps.stream()
                .filter(c -> "Markdown".equals(c.path("component").asText()) && "md-0".equals(c.path("id").asText()))
                .findFirst().orElseThrow();
        assertTrue(md.path("text").asText().contains("总销售额 136 万"));
        assertTrue(md.path("text").asText().startsWith("- "));
        JsonNode note = comps.stream()
                .filter(c -> "note-0".equals(c.path("id").asText())).findFirst().orElseThrow();
        assertEquals("🎤 开场 30 秒", note.path("text").asText());
        // 无 note 的页不出 note 组件
        assertTrue(comps.stream().noneMatch(c -> "note-1".equals(c.path("id").asText())));
        // root 存在
        assertTrue(comps.stream().anyMatch(c -> "root".equals(c.path("id").asText())));
    }

    @Test
    void emptySlidesRejected() throws Exception {
        assertTrue(renderer.execute("run", "thread", MAPPER.readTree("{\"title\":\"t\",\"slides\":[]}")).isEmpty());
        assertTrue(renderer.execute("run", "thread", MAPPER.readTree("{\"title\":\"t\"}")).isEmpty());
        // 缺 heading 的页被拒绝
        assertTrue(renderer.execute("run", "thread",
                MAPPER.readTree("{\"slides\":[{\"bullets\":[\"x\"]}]}")).isEmpty());
    }
}
