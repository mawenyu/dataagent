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
 * render_slides 服务端工具（spec: docs/spec/copilotkit-capabilities.md B2，
 * presentation 示例模式）：模型产 slides 结构（纯文本内容），gateway 确定性
 * 展开为 A2UI Tabs surface —— 每页一个 tab，bullets 走 Markdown 组件，
 * note（演讲备注）走 caption Text。
 */
@Service
public class SlidesRenderer implements AguiEventTranslator.ServerToolHandler {

    private static final Logger log = LoggerFactory.getLogger(SlidesRenderer.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    public static final String TOOL_NAME = "render_slides";
    private static final int MAX_SLIDES = 20;
    private static final int MAX_TEXT_CHARS = 8 * 1024;

    private final A2UiService a2Ui;
    private final A2UiSurfaceRegistry surfaceRegistry;

    public SlidesRenderer(A2UiService a2Ui, A2UiSurfaceRegistry surfaceRegistry) {
        this.a2Ui = a2Ui;
        this.surfaceRegistry = surfaceRegistry;
    }

    public boolean supports(String toolName) {
        return TOOL_NAME.equals(toolName);
    }

    public Optional<ServerSentEvent<String>> execute(String runId, String threadId, JsonNode args) {
        if (args == null || !args.isObject()) return Optional.empty();
        JsonNode slides = args.path("slides");
        if (!slides.isArray() || slides.isEmpty() || slides.size() > MAX_SLIDES) return Optional.empty();
        for (JsonNode s : slides) {
            if (s.path("heading").asText("").isBlank()) return Optional.empty();
        }
        String surfaceId = args.path("surfaceId").asText("slides");
        if (!surfaceId.matches("[A-Za-z0-9_\\-]{1,64}")) return Optional.empty();
        String title = args.path("title").asText("演示文稿");

        List<ObjectNode> comps = new ArrayList<>();
        List<ObjectNode> tabs = new ArrayList<>();
        for (int i = 0; i < slides.size(); i++) {
            JsonNode s = slides.get(i);
            String heading = s.path("heading").asText();
            StringBuilder md = new StringBuilder();
            for (JsonNode b : s.path("bullets")) {
                String bullet = b.asText("").strip();
                if (!bullet.isEmpty()) md.append("- ").append(bullet).append('\n');
            }
            if (md.length() > MAX_TEXT_CHARS) md.setLength(MAX_TEXT_CHARS);
            List<String> colChildren = new ArrayList<>();
            colChildren.add("md-" + i);
            comps.add(a2Ui.component("Markdown", "md-" + i, Map.of("text", md.toString())));
            String note = s.path("note").asText("");
            if (!note.isBlank()) {
                comps.add(a2Ui.component("Text", "note-" + i, Map.of("text", "🎤 " + note, "variant", "caption")));
                colChildren.add("note-" + i);
            }
            comps.add(a2Ui.component("Column", "col-" + i, Map.of("children", colChildren)));
            comps.add(a2Ui.component("Card", "slide-" + i, Map.of("child", "col-" + i)));

            ObjectNode tab = MAPPER.createObjectNode();
            tab.put("title", (i + 1) + ". " + (heading.length() > 12 ? heading.substring(0, 12) + "…" : heading));
            tab.put("child", "slide-" + i);
            tabs.add(tab);
        }

        ObjectNode tabsComp = MAPPER.createObjectNode();
        tabsComp.put("component", "Tabs");
        tabsComp.put("id", "slides-tabs");
        ArrayNode tabsArr = tabsComp.putArray("tabs");
        tabs.forEach(tabsArr::add);
        comps.add(tabsComp);

        comps.add(a2Ui.component("Text", "title", Map.of("text", title, "variant", "h3")));
        comps.add(a2Ui.component("Column", "root", Map.of("children", List.of("title", "slides-tabs"))));

        ArrayNode arr = MAPPER.createArrayNode();
        comps.forEach(arr::add);
        var state = surfaceRegistry.register("anonymous", threadId, surfaceId,
                A2UiService.DATA_AGENT_CATALOG_ID, arr, null);
        log.info("render_slides: surface={} slides={}", surfaceId, slides.size());
        return Optional.of(a2Ui.activitySnapshot(runId, threadId, state.activityMessageId(), List.of(
                a2Ui.createSurface(surfaceId, A2UiService.DATA_AGENT_CATALOG_ID),
                a2Ui.updateComponents(surfaceId, arr))));
    }
}
