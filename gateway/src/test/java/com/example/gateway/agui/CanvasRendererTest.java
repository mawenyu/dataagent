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
 * update_canvas（spec: docs/spec/copilotkit-capabilities.md B3, research-canvas 模式）：
 * 模型产 {title, sections:[{heading, markdown}], append?} 小选择集，
 * gateway 确定性展开为 A2UI Column of Card+Markdown sections；
 * 同名 surfaceId 就地更新，append=true 追加新节。
 */
class CanvasRendererTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private CanvasRenderer renderer;
    private A2UiSurfaceRegistry registry;

    @BeforeEach
    void setUp() {
        registry = new A2UiSurfaceRegistry();
        renderer = new CanvasRenderer(new A2UiService(), registry);
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

    private JsonNode byId(List<JsonNode> comps, String id) {
        return comps.stream().filter(c -> id.equals(c.path("id").asText())).findFirst().orElseThrow();
    }

    @Test
    void sectionsExpandToCardMarkdownSurface() throws Exception {
        JsonNode args = MAPPER.readTree("""
                {"title":"竞品研究报告","sections":[
                  {"heading":"背景","markdown":"市场规模 **120 亿**"},
                  {"heading":"结论","markdown":"建议聚焦华东"}
                ]}
                """);
        Optional<ServerSentEvent<String>> out = renderer.execute("run", "thread", args);
        assertTrue(out.isPresent());
        List<JsonNode> comps = components(snapshotOps(out.get()));

        // root Column children: ["title","meta","sec-0","sec-1"]
        JsonNode root = byId(comps, "root");
        assertEquals("Column", root.path("component").asText());
        assertEquals(List.of("title", "meta", "sec-0", "sec-1"),
                MAPPER.convertValue(root.path("children"), List.class));

        // 标题 Text h3 + 节数徽标
        JsonNode title = byId(comps, "title");
        assertEquals("Text", title.path("component").asText());
        assertEquals("竞品研究报告", title.path("text").asText());
        assertEquals("h3", title.path("variant").asText());
        assertEquals("2 节", byId(comps, "meta").path("text").asText());

        // 每节：Card(sec-i) → Column(sec-i-col) → Text h4(sec-i-h) + Markdown(sec-i-md)
        JsonNode card = byId(comps, "sec-0");
        assertEquals("Card", card.path("component").asText());
        assertEquals("sec-0-col", card.path("child").asText());
        JsonNode col = byId(comps, "sec-0-col");
        assertEquals(List.of("sec-0-h", "sec-0-md"),
                MAPPER.convertValue(col.path("children"), List.class));
        JsonNode head = byId(comps, "sec-0-h");
        assertEquals("背景", head.path("text").asText());
        assertEquals("h4", head.path("variant").asText());
        JsonNode md = byId(comps, "sec-0-md");
        assertEquals("Markdown", md.path("component").asText());
        assertEquals("市场规模 **120 亿**", md.path("text").asText());
        assertEquals("建议聚焦华东", byId(comps, "sec-1-md").path("text").asText());
    }

    @Test
    void appendKeepsOldSectionsAndRenumbers() throws Exception {
        // 第一轮：2 节
        renderer.execute("run", "thread", MAPPER.readTree("""
                {"title":"报告 v1","surfaceId":"cv","sections":[
                  {"heading":"一","markdown":"第一节内容"},
                  {"heading":"二","markdown":"第二节内容"}
                ]}
                """));
        // 第二轮：append 1 节
        Optional<ServerSentEvent<String>> out = renderer.execute("run", "thread", MAPPER.readTree("""
                {"title":"报告 v2","surfaceId":"cv","append":true,"sections":[
                  {"heading":"三","markdown":"追加的第三节"}
                ]}
                """));
        assertTrue(out.isPresent());
        List<JsonNode> comps = components(snapshotOps(out.get()));

        // 旧节保留在前，新节续编号 sec-2
        assertEquals("第一节内容", byId(comps, "sec-0-md").path("text").asText());
        assertEquals("第二节内容", byId(comps, "sec-1-md").path("text").asText());
        assertEquals("追加的第三节", byId(comps, "sec-2-md").path("text").asText());
        // meta 与 root children 反映总数 3
        assertEquals("3 节", byId(comps, "meta").path("text").asText());
        JsonNode root = byId(comps, "root");
        assertEquals(List.of("title", "meta", "sec-0", "sec-1", "sec-2"),
                MAPPER.convertValue(root.path("children"), List.class));
        // title 用新的
        assertEquals("报告 v2", byId(comps, "title").path("text").asText());
    }

    @Test
    void nonAppendOverwritesInPlace() throws Exception {
        renderer.execute("run", "thread", MAPPER.readTree("""
                {"title":"v1","surfaceId":"cv","sections":[{"heading":"一","markdown":"旧内容"}]}
                """));
        Optional<ServerSentEvent<String>> out = renderer.execute("run", "thread", MAPPER.readTree("""
                {"title":"v2","surfaceId":"cv","sections":[{"heading":"新","markdown":"新内容"}]}
                """));
        assertTrue(out.isPresent());
        List<JsonNode> comps = components(snapshotOps(out.get()));
        assertEquals("1 节", byId(comps, "meta").path("text").asText());
        assertEquals("新内容", byId(comps, "sec-0-md").path("text").asText());
        assertTrue(comps.stream().noneMatch(c -> "sec-1".equals(c.path("id").asText())));
    }

    @Test
    void invalidArgsRejected() throws Exception {
        // 空 sections / 缺 sections
        assertTrue(renderer.execute("run", "thread",
                MAPPER.readTree("{\"title\":\"t\",\"sections\":[]}")).isEmpty());
        assertTrue(renderer.execute("run", "thread",
                MAPPER.readTree("{\"title\":\"t\"}")).isEmpty());
        // 缺 heading 的节被拒绝
        assertTrue(renderer.execute("run", "thread",
                MAPPER.readTree("{\"sections\":[{\"markdown\":\"x\"}]}")).isEmpty());
        assertTrue(renderer.execute("run", "thread",
                MAPPER.readTree("{\"sections\":[{\"heading\":\"  \",\"markdown\":\"x\"}]}")).isEmpty());
        // 超上限：sections > 30 / 单节 markdown > 16KB
        StringBuilder many = new StringBuilder("{\"sections\":[");
        for (int i = 0; i < 31; i++) {
            if (i > 0) many.append(',');
            many.append("{\"heading\":\"h").append(i).append("\",\"markdown\":\"x\"}");
        }
        many.append("]}");
        assertTrue(renderer.execute("run", "thread", MAPPER.readTree(many.toString())).isEmpty());
        String big = "{\"sections\":[{\"heading\":\"h\",\"markdown\":\"" + "x".repeat(16 * 1024 + 1) + "\"}]}";
        assertTrue(renderer.execute("run", "thread", MAPPER.readTree(big)).isEmpty());
        // surfaceId 非法字符
        assertTrue(renderer.execute("run", "thread", MAPPER.readTree(
                "{\"surfaceId\":\"../etc\",\"sections\":[{\"heading\":\"h\",\"markdown\":\"x\"}]}")).isEmpty());
        // 非对象参数
        assertTrue(renderer.execute("run", "thread", MAPPER.readTree("[1,2]")).isEmpty());
    }

    @Test
    void supportsToolName() {
        assertTrue(renderer.supports("update_canvas"));
        assertFalse(renderer.supports("render_slides"));
    }
}
