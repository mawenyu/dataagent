package com.example.gateway.agui;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.Optional;

/**
 * A2UI action handler (TASK §13).
 *
 * <p>The browser delivers surface interactions as
 * {@code forwardedProps.a2uiAction} on a new run, with the v0.9 shape
 * {@code {version, action: {name, surfaceId, sourceComponentId, timestamp, context}}}.</p>
 *
 * <p>需求2: 所有 action 一律走真实 agent 续跑 —— {@link #buildAgentPrompt}
 * 把 action 转成 {@code A2UI_ACTION: <json>} prompt 交给 LLM 判断（必要时
 * render_a2ui 更新同名 surface）。不存在任何 Java 侧的固定响应分支。</p>
 */
@Service
public class A2UiActionHandler {

    private static final Logger log = LoggerFactory.getLogger(A2UiActionHandler.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    public record ParsedAction(String name, String surfaceId, String sourceComponentId, JsonNode context) {}

    /** Parse forwardedProps.a2uiAction (tolerates missing "action" wrapper). */
    public Optional<ParsedAction> parse(Object raw) {
        if (raw == null) return Optional.empty();
        JsonNode node;
        try {
            node = MAPPER.valueToTree(raw);
        } catch (Exception e) {
            log.warn("a2uiAction not convertible: {}", e.getMessage());
            return Optional.empty();
        }
        JsonNode action = node.has("action") ? node.path("action") : node;
        String name = action.path("name").asText("");
        if (name.isBlank() || !name.matches("[A-Za-z0-9_\\-]{1,64}")) {
            log.warn("a2uiAction with invalid name: {}", name);
            return Optional.empty();
        }
        return Optional.of(new ParsedAction(
                name,
                action.path("surfaceId").asText(""),
                action.path("sourceComponentId").asText(""),
                action.path("context")));
    }

    /** A2UI_ACTION context prompt for the normal agent run. */
    public String buildAgentPrompt(Object raw) {
        String json;
        try {
            json = MAPPER.writeValueAsString(raw);
        } catch (Exception e) {
            json = String.valueOf(raw);
        }
        return "A2UI_ACTION: " + json + "\n" +
                "The user interacted with an A2UI surface rendered earlier in this conversation " +
                "(see the action name, surfaceId and context above). Decide how to respond: answer " +
                "directly in text, and if the UI should change, call render_a2ui with the SAME surfaceId to " +
                "update that surface in place. Use the data workspace for any data lookups.";
    }
}
