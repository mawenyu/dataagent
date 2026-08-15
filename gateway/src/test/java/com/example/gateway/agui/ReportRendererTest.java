package com.example.gateway.agui;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.codec.ServerSentEvent;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;

/**
 * render_report（spec: docs/spec/copilotkit-capabilities.md B1）：
 * 模型只产选择集，gateway 用 workspace 真实 CSV 计算并确定性展开 A2UI ops。
 */
class ReportRendererTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @TempDir
    Path dir;

    private ReportRenderer renderer;

    @BeforeEach
    void setUp() throws Exception {
        Files.writeString(dir.resolve("sales.csv"),
                "日期,区域,品类,数量,单价,销售额\n"
                        + "2026-08-01,华北,笔记本,2,7000,14000\n"
                        + "2026-08-01,华东,手机,3,3000,9000\n"
                        + "2026-08-02,华北,手机,1,3000,3000\n");
        renderer = new ReportRenderer(new WorkspaceFileService(dir, 1024 * 1024),
                new A2UiService(), new A2UiSurfaceRegistry());
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
    void selectionSetExpandsToRealDataComponents() throws Exception {
        JsonNode args = MAPPER.readTree("""
                {"title":"八月销售报告","dataFile":"sales.csv",
                 "kpis":["totalSales","orderCount","avgOrderValue","topRegion","topCategory"],
                 "charts":[{"type":"bar","groupBy":"region","title":"区域销售额"},
                           {"type":"pie","groupBy":"category","title":"品类占比"}],
                 "table":{"groupBy":"region","title":"区域明细"},
                 "actions":[{"label":"下钻华北","event":"drill_down","context":{"region":"华北"}}]}
                """);
        Optional<ServerSentEvent<String>> out = renderer.buildReport("anonymous", "run", "thread", args);
        assertTrue(out.isPresent());
        List<JsonNode> comps = components(snapshotOps(out.get()));

        // KPI MetricCards：真实计算值
        List<JsonNode> metrics = comps.stream().filter(c -> "MetricCard".equals(c.path("component").asText())).toList();
        assertEquals(5, metrics.size());
        assertEquals("26,000", metrics.get(0).path("value").asText(), "totalSales 14000+9000+3000");
        assertEquals("3", metrics.get(1).path("value").asText(), "orderCount");
        assertEquals("8,667", metrics.get(2).path("value").asText(), "avgOrderValue 26000/3 取整");
        assertEquals("华北", metrics.get(3).path("value").asText(), "topRegion 17000 > 9000");
        assertEquals("笔记本", metrics.get(4).path("value").asText(), "topCategory 14000");

        // 图表：bar 真实聚合
        JsonNode bar = comps.stream().filter(c -> "BarChart".equals(c.path("component").asText())).findFirst().orElseThrow();
        assertEquals("区域销售额", bar.path("title").asText());
        JsonNode barData = bar.path("data");
        assertEquals(2, barData.size());
        assertEquals(17000, barData.get(0).path("销售额").asInt());

        // 表格 + action
        assertTrue(comps.stream().anyMatch(c -> "DataTable".equals(c.path("component").asText())));
        JsonNode btn = comps.stream().filter(c -> "ActionButton".equals(c.path("component").asText())).findFirst().orElseThrow();
        assertEquals("drill_down", btn.path("action").path("event").path("name").asText());
    }

    @Test
    void unknownKpisAndGroupBySkippedWithWarning() throws Exception {
        JsonNode args = MAPPER.readTree("""
                {"title":"t","dataFile":"sales.csv","kpis":["totalSales","nonsense"],
                 "charts":[{"type":"bar","groupBy":"region"},{"type":"bar","groupBy":"bogus"}]}
                """);
        Optional<ServerSentEvent<String>> out = renderer.buildReport("anonymous", "run", "thread", args);
        assertTrue(out.isPresent());
        List<JsonNode> comps = components(snapshotOps(out.get()));
        assertEquals(1, comps.stream().filter(c -> "MetricCard".equals(c.path("component").asText())).count());
        assertEquals(1, comps.stream().filter(c -> "BarChart".equals(c.path("component").asText())).count());
    }

    @Test
    void missingFileYieldsWarningCardSurface() throws Exception {
        JsonNode args = MAPPER.readTree("""
                {"title":"t","dataFile":"ghost.csv","kpis":["totalSales"]}
                """);
        Optional<ServerSentEvent<String>> out = renderer.buildReport("anonymous", "run", "thread", args);
        assertTrue(out.isPresent(), "missing file → WarningCard surface, not a crash");
        List<JsonNode> comps = components(snapshotOps(out.get()));
        assertTrue(comps.stream().anyMatch(c -> "WarningCard".equals(c.path("component").asText())));
    }

    @Test
    void pathTraversalDataFileRejected() throws Exception {
        JsonNode args = MAPPER.readTree("""
                {"title":"t","dataFile":"../pom.xml","kpis":["totalSales"]}
                """);
        assertTrue(renderer.buildReport("anonymous", "run", "thread", args).isEmpty());
    }
}
