package com.example.gateway.agui;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Java-side A2UI bridge (TASK §11-12): the server-side {@code render_a2ui} tool.
 *
 * <p>Behavioural reference: @ag-ui/a2ui-middleware (MIT) — only the parts this
 * project needs are implemented:
 *
 * <ul>
 *   <li>When the client sends A2UI catalog context (CopilotKit Vue with
 *       {@code a2ui.catalog} + {@code includeSchema} puts catalog/schema/
 *       guidelines into {@code RunAgentInput.context}), the gateway forwards
 *       it to the agent together with the render_a2ui prompt contract
 *       ({@link #buildServerToolSection}).</li>
 *   <li>The model calls {@code render_a2ui(surfaceId, components, data?,
 *       catalogId?)} via the {@code <tool_call>} prompt contract (same
 *       mechanism as frontend tools — OpenCode cannot host real custom
 *       tools). The translator detects the block, mirrors it as
 *       TOOL_CALL_START/ARGS/END (drives CopilotKit's built-in render_a2ui
 *       progress renderer), and hands the arguments here.</li>
 *   <li>{@link #execute} validates (component whitelist, size caps) and
 *       converts to createSurface/updateComponents/updateDataModel wrapped in
 *       an ACTIVITY_SNAPSHOT. The run continues — this is a server-side tool,
 *       so unlike frontend tools the run is NOT ended.</li>
 * </ul>
 *
 * <p>No HTML/JS/Vue templates ever cross the wire — declarative catalog
 * components only (TASK §15).
 */
@Service
public class A2UiBridgeService {

    private static final Logger log = LoggerFactory.getLogger(A2UiBridgeService.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    public static final String RENDER_TOOL_NAME = "render_a2ui";

    /** Context description fragment used by CopilotKit to mark A2UI entries. */
    private static final String A2UI_CONTEXT_MARKER = "A2UI";

    /**
     * Component whitelist (TASK §15/§16): the 18 basic-catalog components plus
     * the DataAgent custom catalog registered in the frontend
     * (vue-frontend/src/a2ui/dataAgentCatalog.ts — keep in sync).
     */
    private static final Set<String> ALLOWED_COMPONENTS = Set.of(
            "Text", "Image", "Icon", "Video", "AudioPlayer",
            "Row", "Column", "List", "Card", "Tabs", "Divider", "Modal",
            "Button", "TextField", "CheckBox", "ChoicePicker", "Slider", "DateTimeInput",
            // DataAgent custom catalog (TASK §15)
            "MetricCard", "DataTable", "BarChart", "LineChart", "PieChart",
            "InsightCard", "WarningCard", "ActionButton", "Badge", "Markdown");

    // Loose caps (TASK §16 — validation only, no auth)
    private static final int MAX_COMPONENTS = 100;
    private static final int MAX_PAYLOAD_CHARS = 64 * 1024;
    private static final int MAX_CONTEXT_ENTRY_CHARS = 32 * 1024;

    private final A2UiService a2UiService;
    private final A2UiSurfaceRegistry surfaceRegistry;

    public A2UiBridgeService(A2UiService a2UiService, A2UiSurfaceRegistry surfaceRegistry) {
        this.a2UiService = a2UiService;
        this.surfaceRegistry = surfaceRegistry;
    }

    public boolean isServerTool(String name) {
        return RENDER_TOOL_NAME.equals(name);
    }

    /**
     * 把嵌套的组件树拍平成 v0.9 扁平列表：每个组件对象成为顶层条目，
     * children/child 里的组件对象被提出为独立条目、原位置换成其 id。
     * 同时剥掉值为 null 的属性（模型常输出 "delta": null，zod optional 不接受）。
     * 返回 null 表示结构非法（组件对象缺 id）。
     */
    static ArrayNode flattenComponents(ArrayNode components) {
        ArrayNode out = MAPPER.createArrayNode();
        for (JsonNode c : components) {
            if (!flattenOne(c, out)) return null;
        }
        return out;
    }

    private static boolean flattenOne(JsonNode node, ArrayNode out) {
        if (!node.isObject()) return false;
        ObjectNode c = ((ObjectNode) node).deepCopy();
        String id = c.path("id").asText("");
        if (id.isBlank()) return false;
        // 剥掉显式 null 属性
        List<String> nullFields = new ArrayList<>();
        c.fields().forEachRemaining(f -> {
            if (f.getValue().isNull()) nullFields.add(f.getKey());
        });
        nullFields.forEach(c::remove);
        // 先收集子组件引用（父条目先入库，保持 root 在前的自然顺序），再递归拍平。
        // 实测模型用三种容器字段装嵌套子组件：children（v0.9 约定）/ child（单个）/
        // items（2026-08-15 实测变体，统一改写为 children）。
        List<JsonNode> nested = new ArrayList<>();
        JsonNode items = c.get("items");
        if (items != null && items.isArray()
                && items.iterator().hasNext() && items.iterator().next().isObject()) {
            c.remove("items");
            c.set("children", items);
        }
        JsonNode children = c.get("children");
        if (children != null && children.isArray()) {
            ArrayNode ids = MAPPER.createArrayNode();
            for (JsonNode childEl : children) {
                if (childEl.isTextual()) {
                    ids.add(childEl.asText());
                } else if (childEl.isObject()) {
                    String childId = childEl.path("id").asText("");
                    if (childId.isBlank()) return false;
                    nested.add(childEl);
                    ids.add(childId);
                }
            }
            c.set("children", ids);
        }
        // child: 单个子组件（Card/Button 等），同样可能是对象
        JsonNode child = c.get("child");
        if (child != null && child.isObject()) {
            String childId = child.path("id").asText("");
            if (childId.isBlank()) return false;
            nested.add(child);
            c.put("child", childId);
        }
        out.add(c);
        for (JsonNode n : nested) {
            if (!flattenOne(n, out)) return false;
        }
        return true;
    }

    /** Whether the client advertised A2UI capability for this run. */
    public boolean hasA2uiContext(List<Map<String, Object>> context) {
        if (context == null) return false;
        return context.stream().anyMatch(e ->
                String.valueOf(e.get("description")).contains(A2UI_CONTEXT_MARKER));
    }

    /**
     * Server-tool prompt section: the render_a2ui contract plus the A2UI
     * context entries (catalog / schema / guidelines) forwarded verbatim
     * (truncated) from RunAgentInput.context.
     */
    public String buildServerToolSection(List<Map<String, Object>> context) {
        StringBuilder sb = new StringBuilder();
        sb.append("<server_tools>\n");
        sb.append("You can render rich UI surfaces in the user's chat with the server-side tool \"")
                .append(RENDER_TOOL_NAME).append("\".\n");
        // 2026-08-15 实测：模型经常只答文字不调工具 —— 明确触发条件
        sb.append("Whenever the user asks for a dashboard / 看板 / 表单 / form / chart / 筛选器 or any UI surface, ")
                .append("you MUST call this tool to render it — never answer with text only.\n");
        sb.append("To call it, put ONE <tool_call> block at the END of your response. Any explanatory text MUST come before the block; nothing after it:\n");
        sb.append("<tool_call>{\"name\":\"").append(RENDER_TOOL_NAME)
                .append("\",\"arguments\":{...}}</tool_call>\n");
        sb.append("arguments:\n");
        sb.append("- surfaceId (string, required): stable surface id, e.g. \"sales-dashboard\". Reusing a surfaceId updates that surface in place.\n");
        sb.append("- components (array, required): A2UI v0.9 component instances, each {\"component\":<name>,\"id\":<unique id>,...props}. Exactly one root component with id \"root\". Use ONLY components from the catalog context below, with props matching its schema. Never output HTML/JS/Vue templates.\n");
        sb.append("- data (object, optional): the surface data model. Reference data from props with {\"path\":\"fieldName\"} instead of inline literals when the value comes from data.\n");
        sb.append("- catalogId (string, optional): defaults to the basic catalog.\n");
        // task5-B: 确定性展开工具（banking 模式）——模型只产小选择集，数字由服务端真实计算
        sb.append("\nAdditional server tools (same <tool_call> contract, run continues after the surface):\n");
        sb.append("- render_report: render a data report computed server-side from a workspace CSV. arguments: ")
                .append("{title, dataFile, kpis:[totalSales|orderCount|avgOrderValue|totalQuantity|topRegion|topCategory], ")
                .append("charts:[{type:bar|line|pie, groupBy:region|category|date|channel, title?}], ")
                .append("table:{groupBy, title?}?, actions:[{label, event, context?}]?, surfaceId?}. ")
                .append("Prefer this over render_a2ui for numeric sales/data reports — never hand-write numbers or component JSON.\n");
        sb.append("- render_slides: render a slide deck as a tabbed surface. arguments: ")
                .append("{title, slides:[{heading, bullets:[string], note?}], surfaceId?}. ")
                .append("Use for 演示/presentation/slides requests; bullets are plain text (no markdown tables).\n");
        if (context != null) {
            sb.append("\nThe client provided these A2UI capabilities (catalog, component schemas, guidelines):\n");
            for (Map<String, Object> entry : context) {
                String desc = String.valueOf(entry.get("description"));
                if (!desc.contains(A2UI_CONTEXT_MARKER)) continue;
                String value = String.valueOf(entry.get("value"));
                if (value.length() > MAX_CONTEXT_ENTRY_CHARS) {
                    value = value.substring(0, MAX_CONTEXT_ENTRY_CHARS) + "…[truncated]";
                }
                sb.append("<context description=\"").append(desc.replace("\"", "'")).append("\">\n")
                        .append(value).append("\n</context>\n");
            }
        }
        sb.append("</server_tools>");
        return sb.toString();
    }

    public Optional<ServerSentEvent<String>> execute(String runId, String threadId, JsonNode args) {
        return execute("anonymous", runId, threadId, args);
    }

    /**
     * Execute render_a2ui: validate arguments and build the ACTIVITY_SNAPSHOT
     * SSE event. Empty Optional = invalid call (logged; run continues without
     * a surface). The surface is registered in {@link A2UiSurfaceRegistry}
     * (TASK §14) so later updates/actions reuse its activity messageId.
     */
    public Optional<ServerSentEvent<String>> execute(String userId, String runId, String threadId, JsonNode args) {
        if (args == null || !args.isObject()) {
            log.warn("render_a2ui: arguments missing/not an object");
            return Optional.empty();
        }
        String surfaceId = args.path("surfaceId").asText("");
        if (surfaceId.isBlank() || !surfaceId.matches("[A-Za-z0-9_\\-]{1,64}")) {
            log.warn("render_a2ui: invalid surfaceId '{}'", surfaceId);
            return Optional.empty();
        }
        JsonNode comps = args.path("components");
        if (!comps.isArray() || comps.isEmpty()) {
            log.warn("render_a2ui: components missing/empty");
            return Optional.empty();
        }
        // 2026-08-15 实测：模型常把子组件对象嵌进 children 数组（v0.9 约定是
        // 扁平列表 + children 为 id 数组），还带显式 null 属性。先拍平 + 剥 null，
        // 再校验白名单 —— 嵌套组件因此同样过白名单，不能绕过。
        ArrayNode flat = flattenComponents((ArrayNode) comps);
        if (flat == null) {
            log.warn("render_a2ui: components malformed (child without id)");
            return Optional.empty();
        }
        comps = flat;
        if (comps.size() > MAX_COMPONENTS || comps.toString().length() > MAX_PAYLOAD_CHARS) {
            log.warn("render_a2ui: payload too large ({} components, {} chars)",
                    comps.size(), comps.toString().length());
            return Optional.empty();
        }
        List<String> rejected = new ArrayList<>();
        for (JsonNode c : comps) {
            String type = c.path("component").asText("");
            String id = c.path("id").asText("");
            if (id.isBlank() || !ALLOWED_COMPONENTS.contains(type)) {
                rejected.add(type + "#" + id);
            }
        }
        if (!rejected.isEmpty()) {
            log.warn("render_a2ui: rejected components (not in whitelist or missing id): {}", rejected);
            return Optional.empty();
        }
        String catalogId = args.path("catalogId").asText("");
        // 前端只注册了 DataAgent catalog（basic 超集）——任何空值/基础 catalog id/
        // 模型编的短别名（实测 "data-agent"，2026-08-15）都归一化到它；
        // 组件白名单才是真正的安全边界，catalogId 只是匹配前端注册表用。
        if (!A2UiService.DATA_AGENT_CATALOG_ID.equals(catalogId)) {
            if (!catalogId.isBlank()) log.debug("normalizing catalogId '{}' to data-agent catalog", catalogId);
            catalogId = A2UiService.DATA_AGENT_CATALOG_ID;
        }

        List<ObjectNode> ops = new ArrayList<>();
        ops.add(a2UiService.createSurface(surfaceId, catalogId));
        ops.add(a2UiService.updateComponents(surfaceId, (ArrayNode) comps));
        JsonNode data = args.path("data");
        if (data.isObject() || data.isArray()) {
            ops.add(a2UiService.updateDataModel(surfaceId, "/", data));
        }
        // TASK §14: register the surface; snapshot reuses its stable messageId
        var state = surfaceRegistry.register(userId, threadId, surfaceId, catalogId,
                comps, data.isMissingNode() ? null : data);
        log.info("render_a2ui: surface={} components={} catalog={}", surfaceId, comps.size(), catalogId);
        return Optional.of(a2UiService.activitySnapshot(runId, threadId, state.activityMessageId(), ops));
    }
}
