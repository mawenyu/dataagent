package com.example.gateway.agui;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.text.NumberFormat;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/**
 * render_report 服务端工具（spec: docs/spec/copilotkit-capabilities.md B1，
 * banking 示例模式）：模型只产"小选择集"（kpis/charts/table/actions），
 * gateway 读 workspace 真实 CSV 计算指标并确定性展开成 A2UI ops。
 * 模型永远不写组件 JSON、不传数字 —— 数字全部来自 Java 侧真实聚合。
 */
@Service
public class ReportRenderer implements AguiEventTranslator.ServerToolHandler {

    private static final Logger log = LoggerFactory.getLogger(ReportRenderer.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    public static final String TOOL_NAME = "render_report";

    /** 模型可选的 KPI 枚举 → 中文标题。 */
    private static final Map<String, String> KPI_TITLES = Map.of(
            "totalSales", "总销售额",
            "orderCount", "订单数",
            "avgOrderValue", "客单价",
            "totalQuantity", "总销量",
            "topRegion", "销售额最高区域",
            "topCategory", "销售额最高品类");

    /** groupBy 枚举 → CSV 列名。 */
    private static final Map<String, String> GROUP_COLUMNS = Map.of(
            "region", "区域",
            "category", "品类",
            "date", "日期",
            "channel", "渠道");

    private static final String COL_SALES = "销售额";
    private static final String COL_QTY = "数量";

    private final WorkspaceFileService files;
    private final A2UiService a2Ui;
    private final A2UiSurfaceRegistry surfaceRegistry;

    public ReportRenderer(WorkspaceFileService files, A2UiService a2Ui, A2UiSurfaceRegistry surfaceRegistry) {
        this.files = files;
        this.a2Ui = a2Ui;
        this.surfaceRegistry = surfaceRegistry;
    }

    public boolean supports(String toolName) {
        return TOOL_NAME.equals(toolName);
    }

    /** ServerToolHandler 入口（translator 派发用）。 */
    public Optional<ServerSentEvent<String>> execute(String runId, String threadId, JsonNode args) {
        return buildReport("anonymous", runId, threadId, args);
    }

    /** 展开选择集为 ACTIVITY_SNAPSHOT。结构非法（surfaceId/文件名校验失败）→ empty。 */
    public Optional<ServerSentEvent<String>> buildReport(String userId, String runId, String threadId, JsonNode args) {
        if (args == null || !args.isObject()) return Optional.empty();
        String surfaceId = args.path("surfaceId").asText("report");
        if (!surfaceId.matches("[A-Za-z0-9_\\-]{1,64}")) return Optional.empty();
        String dataFile = args.path("dataFile").asText("");
        String title = args.path("title").asText("数据报告");
        // 文件名非法（路径穿越等）→ 整体拒绝；文件存在但读不出/缺列 → WarningCard
        if (!dataFile.isBlank() && files.resolve(dataFile).isEmpty()) return Optional.empty();

        List<Map<String, String>> rows = dataFile.isBlank() ? null : readCsv(dataFile);
        if (rows == null && !dataFile.isBlank()) {
            // 文件缺失/非法/列不齐 → WarningCard surface（用户看得到原因，不崩）
            return Optional.of(warningSurface(userId, runId, threadId, surfaceId, title,
                    "数据文件不可用", "workspace 里读不到「" + dataFile + "」或缺少必需列（销售额/数量）。可用 /files 面板上传。"));
        }

        List<ObjectNode> comps = new ArrayList<>();
        int seq = 0;
        List<String> childIds = new ArrayList<>();

        // 标题
        comps.add(a2Ui.component("Text", "title", Map.of("text", title, "variant", "h3")));
        childIds.add("title");

        if (rows != null) {
            // KPI 卡（Row 装 MetricCard×N）
            List<String> kpiIds = new ArrayList<>();
            for (JsonNode k : args.path("kpis")) {
                String kpi = k.asText("");
                String value = computeKpi(kpi, rows);
                if (value == null) {
                    log.warn("render_report: unknown kpi '{}' skipped", kpi);
                    continue;
                }
                String id = "kpi-" + seq++;
                comps.add(a2Ui.component("MetricCard", id,
                        Map.of("title", KPI_TITLES.get(kpi), "value", value)));
                kpiIds.add(id);
            }
            if (!kpiIds.isEmpty()) {
                comps.add(a2Ui.component("Row", "kpi-row", Map.of("children", kpiIds)));
                childIds.add("kpi-row");
            }

            // 图表
            for (JsonNode ch : args.path("charts")) {
                String type = ch.path("type").asText("");
                String groupBy = ch.path("groupBy").asText("");
                String col = GROUP_COLUMNS.get(groupBy);
                if (col == null || rows.get(0).get(col) == null) {
                    log.warn("render_report: unknown groupBy '{}' skipped", groupBy);
                    continue;
                }
                List<Map.Entry<String, Double>> agg = aggregate(rows, col, "date".equals(groupBy));
                String id = "chart-" + seq++;
                String chartTitle = ch.path("title").asText(col + "分析");
                ObjectNode comp = switch (type) {
                    case "bar" -> chartComponent("BarChart", id, chartTitle, col, agg);
                    case "line" -> chartComponent("LineChart", id, chartTitle, col, agg);
                    case "pie" -> pieComponent(id, chartTitle, col, agg);
                    default -> null;
                };
                if (comp == null) {
                    log.warn("render_report: unknown chart type '{}' skipped", type);
                    continue;
                }
                comps.add(comp);
                childIds.add(id);
            }

            // 明细表
            JsonNode table = args.path("table");
            if (table.isObject()) {
                String col = GROUP_COLUMNS.get(table.path("groupBy").asText(""));
                if (col != null && rows.get(0).get(col) != null) {
                    String id = "table-" + seq++;
                    comps.add(tableComponent(id, table.path("title").asText("明细"), col, rows));
                    childIds.add(id);
                }
            }
        }

        // actions
        List<String> actionIds = new ArrayList<>();
        for (JsonNode a : args.path("actions")) {
            String label = a.path("label").asText("");
            String event = a.path("event").asText("");
            if (label.isBlank() || !event.matches("[A-Za-z0-9_\\-]{1,64}")) continue;
            String id = "action-" + seq++;
            Map<String, Object> props = new LinkedHashMap<>();
            props.put("label", label);
            props.put("variant", "primary");
            ObjectNode eventNode = MAPPER.createObjectNode();
            eventNode.put("name", event);
            if (a.path("context").isObject()) eventNode.set("context", a.path("context"));
            props.put("action", Map.of("event", eventNode));
            comps.add(a2Ui.component("ActionButton", id, props));
            actionIds.add(id);
        }
        childIds.addAll(actionIds);

        comps.add(0, a2Ui.component("Column", "root", Map.of("children", childIds)));
        return Optional.of(emit(userId, runId, threadId, surfaceId, comps));
    }

    private ServerSentEvent<String> emit(String userId, String runId, String threadId,
                                         String surfaceId, List<ObjectNode> comps) {
        ArrayNode arr = MAPPER.createArrayNode();
        comps.forEach(arr::add);
        List<ObjectNode> ops = List.of(
                a2Ui.createSurface(surfaceId, A2UiService.DATA_AGENT_CATALOG_ID),
                a2Ui.updateComponents(surfaceId, arr));
        var state = surfaceRegistry.register(userId, threadId, surfaceId,
                A2UiService.DATA_AGENT_CATALOG_ID, arr, null);
        log.info("render_report: surface={} components={}", surfaceId, comps.size());
        return a2Ui.activitySnapshot(runId, threadId, state.activityMessageId(), ops);
    }

    private ServerSentEvent<String> warningSurface(String userId, String runId, String threadId,
                                                   String surfaceId, String title, String warnTitle, String warnText) {
        List<ObjectNode> comps = List.of(
                a2Ui.component("Column", "root", Map.of("children", List.of("title", "warn"))),
                a2Ui.component("Text", "title", Map.of("text", title, "variant", "h3")),
                a2Ui.component("WarningCard", "warn", Map.of("title", warnTitle, "text", warnText)));
        return emit(userId, runId, threadId, surfaceId, comps);
    }

    // ------------------------------------------------------------- 聚合 ---

    private String computeKpi(String kpi, List<Map<String, String>> rows) {
        return switch (kpi) {
            case "totalSales" -> fmt(sum(rows, COL_SALES));
            case "orderCount" -> String.valueOf(rows.size());
            case "avgOrderValue" -> fmt(Math.round(sum(rows, COL_SALES) / Math.max(rows.size(), 1)));
            case "totalQuantity" -> fmt(sum(rows, COL_QTY));
            case "topRegion" -> topKey(rows, "区域");
            case "topCategory" -> topKey(rows, "品类");
            default -> null;
        };
    }

    private static double sum(List<Map<String, String>> rows, String col) {
        return rows.stream().mapToDouble(r -> parseNum(r.get(col))).sum();
    }

    private static String topKey(List<Map<String, String>> rows, String col) {
        return aggregate(rows, col, false).stream().findFirst().map(Map.Entry::getKey).orElse("-");
    }

    /** 按 col 聚合销售额，降序（date 分组时升序按日期）。 */
    private static List<Map.Entry<String, Double>> aggregate(List<Map<String, String>> rows, String col, boolean ascending) {
        Map<String, Double> acc = new LinkedHashMap<>();
        for (Map<String, String> r : rows) {
            acc.merge(String.valueOf(r.get(col)), parseNum(r.get(COL_SALES)), Double::sum);
        }
        var list = new ArrayList<>(acc.entrySet());
        list.sort((a, b) -> ascending ? a.getKey().compareTo(b.getKey()) : Double.compare(b.getValue(), a.getValue()));
        return list;
    }

    private ObjectNode chartComponent(String type, String id, String title, String col,
                                      List<Map.Entry<String, Double>> agg) {
        ArrayNode data = MAPPER.createArrayNode();
        for (var e : agg) {
            ObjectNode d = data.addObject();
            d.put(col, e.getKey());
            d.put(COL_SALES, e.getValue());
        }
        return a2Ui.component(type, id, Map.of(
                "title", title, "xField", col, "yField", COL_SALES, "data", data));
    }

    private ObjectNode pieComponent(String id, String title, String col, List<Map.Entry<String, Double>> agg) {
        ArrayNode data = MAPPER.createArrayNode();
        for (var e : agg) {
            ObjectNode d = data.addObject();
            d.put(col, e.getKey());
            d.put(COL_SALES, e.getValue());
        }
        return a2Ui.component("PieChart", id, Map.of(
                "title", title, "labelField", col, "valueField", COL_SALES, "data", data));
    }

    private ObjectNode tableComponent(String id, String title, String col, List<Map<String, String>> rows) {
        Map<String, double[]> acc = new LinkedHashMap<>(); // [sales, qty, count]
        for (Map<String, String> r : rows) {
            double[] v = acc.computeIfAbsent(String.valueOf(r.get(col)), k -> new double[3]);
            v[0] += parseNum(r.get(COL_SALES));
            v[1] += parseNum(r.get(COL_QTY));
            v[2] += 1;
        }
        double total = acc.values().stream().mapToDouble(v -> v[0]).sum();
        ArrayNode tableRows = MAPPER.createArrayNode();
        acc.entrySet().stream()
                .sorted((a, b) -> Double.compare(b.getValue()[0], a.getValue()[0]))
                .forEach(e -> {
                    ArrayNode row = tableRows.addArray();
                    row.add(e.getKey());
                    row.add(fmt(e.getValue()[0]));
                    row.add((long) e.getValue()[1]);
                    row.add((long) e.getValue()[2]);
                    row.add(String.format(Locale.ROOT, "%.1f%%", e.getValue()[0] / total * 100));
                });
        return a2Ui.component("DataTable", id, Map.of(
                "title", title,
                "columns", List.of(col, "销售额", "数量", "订单数", "占比"),
                "rows", tableRows));
    }

    // ------------------------------------------------------------- CSV ---

    /** 读取 workspace CSV；文件非法/缺失/缺必需列 → null。 */
    private List<Map<String, String>> readCsv(String name) {
        var res = files.read(name);
        if (res.isEmpty()) {
            log.warn("render_report: data file '{}' not readable", name);
            return null;
        }
        try (var reader = new BufferedReader(
                new InputStreamReader(res.get().getInputStream(), StandardCharsets.UTF_8))) {
            String header = reader.readLine();
            if (header == null) return null;
            String[] cols = header.split(",", -1);
            Map<String, Integer> idx = new LinkedHashMap<>();
            for (int i = 0; i < cols.length; i++) idx.put(cols[i].trim(), i);
            if (!idx.containsKey(COL_SALES) || !idx.containsKey(COL_QTY)) {
                log.warn("render_report: '{}' missing required columns (has {})", name, idx.keySet());
                return null;
            }
            List<Map<String, String>> rows = new ArrayList<>();
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.isBlank()) continue;
                String[] cells = line.split(",", -1);
                Map<String, String> row = new LinkedHashMap<>();
                colsLoop:
                for (var e : idx.entrySet()) {
                    row.put(e.getKey(), e.getValue() < cells.length ? cells[e.getValue()].trim() : "");
                }
                rows.add(row);
            }
            return rows;
        } catch (Exception e) {
            log.warn("render_report: read '{}' failed: {}", name, e.getMessage());
            return null;
        }
    }

    private static double parseNum(String s) {
        try {
            return Double.parseDouble(String.valueOf(s).replace(",", "").trim());
        } catch (Exception e) {
            return 0;
        }
    }

    private static String fmt(double n) {
        return NumberFormat.getNumberInstance(Locale.ROOT).format(Math.round(n));
    }
}
