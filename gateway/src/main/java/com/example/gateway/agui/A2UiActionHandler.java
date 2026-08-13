package com.example.gateway.agui;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.stereotype.Service;

import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * A2UI action handler (TASK §13).
 *
 * <p>The browser delivers surface interactions as
 * {@code forwardedProps.a2uiAction} on a new run, with the v0.9 shape
 * {@code {version, action: {name, surfaceId, sourceComponentId, timestamp, context}}}.
 *
 * <ul>
 *   <li>v1: every action is logged.</li>
 *   <li>v2: deterministic business actions (refresh_sales / filter_region /
 *       open_order / approve_query) are routed directly here — no LLM
 *       round-trip; the response is an ACTIVITY_SNAPSHOT that reuses the
 *       surface's registered messageId (replace=true), so the UI updates in
 *       place.</li>
 *   <li>Anything else needs agent judgment: {@link #buildAgentPrompt} converts
 *       it into an {@code A2UI_ACTION: <json>} prompt and the run continues
 *       through the normal agent path.</li>
 * </ul>
 */
@Service
public class A2UiActionHandler {

    private static final Logger log = LoggerFactory.getLogger(A2UiActionHandler.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final Set<String> DETERMINISTIC =
            Set.of("refresh_sales", "filter_region", "open_order", "approve_query");

    public record ParsedAction(String name, String surfaceId, String sourceComponentId, JsonNode context) {}

    private final A2UiService a2UiService;
    private final A2UiSurfaceRegistry registry;

    public A2UiActionHandler(A2UiService a2UiService, A2UiSurfaceRegistry registry) {
        this.a2UiService = a2UiService;
        this.registry = registry;
    }

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

    public boolean isDeterministic(String name) {
        return DETERMINISTIC.contains(name);
    }

    /**
     * v2 deterministic routing. Demo business data is hardcoded — the point is
     * proving the action -> Java -> surface-update loop without an LLM call.
     */
    public ServerSentEvent<String> handleDeterministic(String userId, String threadId, String runId,
                                                       ParsedAction action) {
        log.info("A2UI deterministic action: {} surface={} ctx={} (user={} thread={})",
                action.name(), action.surfaceId(), action.context(), userId, threadId);
        return switch (action.name()) {
            case "refresh_sales" -> refreshSales(userId, threadId, runId, action);
            case "filter_region" -> filterRegion(userId, threadId, runId, action);
            case "open_order" -> openOrder(userId, threadId, runId, action);
            case "approve_query" -> approveQuery(userId, threadId, runId, action);
            default -> throw new IllegalStateException("not deterministic: " + action.name());
        };
    }

    /** Agent-judgment path: A2UI_ACTION context prompt for the normal run. */
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
                "update that surface in place. Do NOT use any other tools (no todo/shell/file tools).";
    }

    // ------------------------------------------------------------------
    // deterministic handlers
    // ------------------------------------------------------------------

    private ServerSentEvent<String> refreshSales(String userId, String threadId, String runId,
                                                 ParsedAction action) {
        String surfaceId = action.surfaceId().isBlank() ? A2UiService.SALES_SURFACE_ID : action.surfaceId();
        String time = LocalTime.now().format(DateTimeFormatter.ofPattern("HH:mm:ss"));
        // demo "business read": deterministic pseudo-change so updates are visible
        int bumped = 123456 + (int) (System.currentTimeMillis() / 1000 % 1000);
        String salesLine = "今日销售额：" + String.format("%,d", bumped) + "（已刷新 " + time + "）";
        var ops = a2UiService.salesOverviewOps(salesLine);
        // §14: reuse the registered messageId so the snapshot replaces in place
        String messageId = registry.find(userId, threadId, surfaceId)
                .map(A2UiSurfaceRegistry.SurfaceState::activityMessageId)
                .orElse(registry.messageIdFor(surfaceId));
        registry.register(userId, threadId, surfaceId, A2UiService.DATA_AGENT_CATALOG_ID, null, null);
        return a2UiService.activitySnapshot(runId, threadId, messageId, ops);
    }

    private ServerSentEvent<String> filterRegion(String userId, String threadId, String runId,
                                                 ParsedAction action) {
        String region = action.context().path("region").asText("未知区域");
        String sales = switch (region) {
            case "华东" -> "86,400";
            case "华北" -> "72,150";
            case "华南" -> "65,980";
            default -> "58,320";
        };
        String surfaceId = "region-sales";
        var comps = a2UiService.components(
                a2UiService.component("Card", "root", Map.of("child", "col")),
                a2UiService.component("Column", "col", Map.of("children", List.of("title", "value"))),
                a2UiService.component("Text", "title", Map.of("text", "区域销售", "variant", "h3")),
                a2UiService.component("Text", "value", Map.of(
                        "text", region + "区销售额：" + sales, "variant", "h2")));
        var ops = List.of(
                a2UiService.createSurface(surfaceId, A2UiService.DATA_AGENT_CATALOG_ID),
                a2UiService.updateComponents(surfaceId, comps));
        var state = registry.register(userId, threadId, surfaceId,
                A2UiService.DATA_AGENT_CATALOG_ID, comps, null);
        return a2UiService.activitySnapshot(runId, threadId, state.activityMessageId(), ops);
    }

    private ServerSentEvent<String> openOrder(String userId, String threadId, String runId,
                                              ParsedAction action) {
        String orderId = action.context().path("orderId").asText("SO-20260813-001");
        String surfaceId = "order-detail";
        var comps = a2UiService.components(
                a2UiService.component("Card", "root", Map.of("child", "col")),
                a2UiService.component("Column", "col", Map.of("children", List.of("title", "line1", "line2"))),
                a2UiService.component("Text", "title", Map.of("text", "订单详情", "variant", "h3")),
                a2UiService.component("Text", "line1", Map.of("text", "订单号：" + orderId)),
                a2UiService.component("Text", "line2", Map.of("text", "状态：已发货 · 金额：¥8,888")));
        var ops = List.of(
                a2UiService.createSurface(surfaceId, A2UiService.DATA_AGENT_CATALOG_ID),
                a2UiService.updateComponents(surfaceId, comps));
        var state = registry.register(userId, threadId, surfaceId,
                A2UiService.DATA_AGENT_CATALOG_ID, comps, null);
        return a2UiService.activitySnapshot(runId, threadId, state.activityMessageId(), ops);
    }

    private ServerSentEvent<String> approveQuery(String userId, String threadId, String runId,
                                                 ParsedAction action) {
        String surfaceId = action.surfaceId().isBlank() ? "approval-result" : action.surfaceId();
        var comps = a2UiService.components(
                a2UiService.component("Card", "root", Map.of("child", "col")),
                a2UiService.component("Column", "col", Map.of("children", List.of("title", "value"))),
                a2UiService.component("Text", "title", Map.of("text", "审批结果", "variant", "h3")),
                a2UiService.component("Text", "value", Map.of(
                        "text", "查询已批准 ✅ 已记录审计日志（模拟）", "variant", "body")));
        var ops = List.of(
                a2UiService.createSurface(surfaceId, A2UiService.DATA_AGENT_CATALOG_ID),
                a2UiService.updateComponents(surfaceId, comps));
        var state = registry.register(userId, threadId, surfaceId,
                A2UiService.DATA_AGENT_CATALOG_ID, comps, null);
        return a2UiService.activitySnapshot(runId, threadId, state.activityMessageId(), ops);
    }
}
