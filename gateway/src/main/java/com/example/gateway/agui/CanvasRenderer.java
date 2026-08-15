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

/**
 * update_canvas 服务端工具（spec: docs/spec/copilotkit-capabilities.md B3，
 * research-canvas 示例模式）：模型产 {title, sections:[{heading, markdown}], append?}
 * 小选择集，gateway 确定性展开为 A2UI surface —— 标题 Text + 节数 Badge +
 * 每节 Card(heading Text h4 + markdown Markdown)。同名 surfaceId 重复调用 =
 * 就地更新；append=true 时保留旧节、新节续编号追加。
 */
@Service
public class CanvasRenderer implements AguiEventTranslator.ServerToolHandler {

    private static final Logger log = LoggerFactory.getLogger(CanvasRenderer.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    public static final String TOOL_NAME = "update_canvas";
    private static final int MAX_SECTIONS = 30;
    private static final int MAX_MARKDOWN_CHARS = 16 * 1024;

    private final A2UiService a2Ui;
    private final A2UiSurfaceRegistry surfaceRegistry;

    public CanvasRenderer(A2UiService a2Ui, A2UiSurfaceRegistry surfaceRegistry) {
        this.a2Ui = a2Ui;
        this.surfaceRegistry = surfaceRegistry;
    }

    public boolean supports(String toolName) {
        return TOOL_NAME.equals(toolName);
    }

    public Optional<ServerSentEvent<String>> execute(String runId, String threadId, JsonNode args) {
        if (args == null || !args.isObject()) return Optional.empty();
        JsonNode sections = args.path("sections");
        if (!sections.isArray() || sections.isEmpty() || sections.size() > MAX_SECTIONS) return Optional.empty();
        for (JsonNode s : sections) {
            if (s.path("heading").asText("").isBlank()) return Optional.empty();
            if (s.path("markdown").asText("").length() > MAX_MARKDOWN_CHARS) return Optional.empty();
        }
        String surfaceId = args.path("surfaceId").asText("canvas");
        if (!surfaceId.matches("[A-Za-z0-9_\\-]{1,64}")) return Optional.empty();
        String title = args.path("title").asText("研究画布");
        boolean append = args.path("append").asBoolean(false);

        // append 语义：从注册表取旧快照，保留 id 以 "sec-" 开头的节组件
        // （Card/Column/Text/Markdown 四件套），新节从旧节数续编号
        List<JsonNode> kept = new ArrayList<>();
        if (append) {
            surfaceRegistry.find("anonymous", threadId, surfaceId)
                    .map(A2UiSurfaceRegistry.SurfaceState::components)
                    .filter(JsonNode::isArray)
                    .ifPresent(old -> old.forEach(c -> {
                        if (c.path("id").asText("").startsWith("sec-")) kept.add(c);
                    }));
        }
        // 旧节数 = 旧 Card（sec-N）个数，新节编号紧随其后，保证 id 唯一
        int offset = (int) kept.stream()
                .filter(c -> "Card".equals(c.path("component").asText())
                        && c.path("id").asText("").matches("sec-\\d+"))
                .count();
        int total = offset + sections.size();

        List<ObjectNode> comps = new ArrayList<>();
        comps.add(a2Ui.component("Text", "title", Map.of("text", title, "variant", "h3")));
        comps.add(a2Ui.component("Badge", "meta", Map.of("text", total + " 节", "variant", "info")));
        List<String> rootChildren = new ArrayList<>(List.of("title", "meta"));
        for (int i = 0; i < offset; i++) rootChildren.add("sec-" + i);
        for (int i = 0; i < sections.size(); i++) {
            int n = offset + i;
            JsonNode s = sections.get(i);
            comps.add(a2Ui.component("Text", "sec-" + n + "-h",
                    Map.of("text", s.path("heading").asText(), "variant", "h4")));
            comps.add(a2Ui.component("Markdown", "sec-" + n + "-md",
                    Map.of("text", s.path("markdown").asText(""))));
            comps.add(a2Ui.component("Column", "sec-" + n + "-col",
                    Map.of("children", List.of("sec-" + n + "-h", "sec-" + n + "-md"))));
            comps.add(a2Ui.component("Card", "sec-" + n, Map.of("child", "sec-" + n + "-col")));
            rootChildren.add("sec-" + n);
        }
        comps.add(a2Ui.component("Column", "root", Map.of("children", rootChildren)));

        ArrayNode arr = MAPPER.createArrayNode();
        kept.forEach(arr::add);
        comps.forEach(arr::add);
        var state = surfaceRegistry.register("anonymous", threadId, surfaceId,
                A2UiService.DATA_AGENT_CATALOG_ID, arr, null);
        log.info("update_canvas: surface={} sections={} append={} total={}",
                surfaceId, sections.size(), append, total);
        return Optional.of(a2Ui.activitySnapshot(runId, threadId, state.activityMessageId(), List.of(
                a2Ui.createSurface(surfaceId, A2UiService.DATA_AGENT_CATALOG_ID),
                a2Ui.updateComponents(surfaceId, arr))));
    }
}
