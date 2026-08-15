package com.example.gateway.agui;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

/**
 * A2UI surface construction (v0.9) wrapped as AG-UI ACTIVITY_SNAPSHOT events.
 *
 * <p>Envelope expected by the CopilotKit Vue A2UI renderer:
 * <pre>
 * { "type": "ACTIVITY_SNAPSHOT", "messageId": "a2ui-...", "activityType": "a2ui-surface",
 *   "content": { "a2ui_operations": [ ... ] }, "replace": true }
 * </pre>
 * with v0.9 operations: createSurface / updateComponents / updateDataModel
 * (see ref/ag-ui-main dojo a2ui-fixed.ts for the canonical shape).
 *
 * <p>Component payloads are declarative only (whitelisted catalog ids, no
 * HTML/JS) — see TASK §15/§16.
 */
@Service
public class A2UiService {

    private static final Logger log = LoggerFactory.getLogger(A2UiService.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    public static final String VERSION = "v0.9";
    /**
     * DataAgent catalog (TASK §15) — the frontend's registered catalog:
     * basic catalog + whitelisted custom components (MetricCard / DataTable /
     * BarChart / LineChart / InsightCard / WarningCard / ActionButton).
     * Must match DATA_AGENT_CATALOG_ID in vue-frontend/src/a2ui/dataAgentCatalog.ts.
     */
    public static final String DATA_AGENT_CATALOG_ID =
            "https://opencode-agui-app.local/a2ui/data-agent-catalog.json";
    public static final String ACTIVITY_TYPE = "a2ui-surface";

    // ------------------------------------------------------------------
    // v0.9 operation builders
    // ------------------------------------------------------------------

    public ObjectNode createSurface(String surfaceId, String catalogId) {
        ObjectNode op = MAPPER.createObjectNode();
        op.put("version", VERSION);
        ObjectNode body = op.putObject("createSurface");
        body.put("surfaceId", surfaceId);
        body.put("catalogId", catalogId != null ? catalogId : DATA_AGENT_CATALOG_ID);
        return op;
    }

    public ObjectNode updateComponents(String surfaceId, ArrayNode components) {
        ObjectNode op = MAPPER.createObjectNode();
        op.put("version", VERSION);
        ObjectNode body = op.putObject("updateComponents");
        body.put("surfaceId", surfaceId);
        body.set("components", components);
        return op;
    }

    /** P10: 关闭 surface（生命周期第三事件）。 */
    public ObjectNode deleteSurface(String surfaceId) {
        ObjectNode op = MAPPER.createObjectNode();
        op.put("version", VERSION);
        op.putObject("deleteSurface").put("surfaceId", surfaceId);
        return op;
    }

    public ObjectNode updateDataModel(String surfaceId, String path, JsonNode value) {
        ObjectNode op = MAPPER.createObjectNode();
        op.put("version", VERSION);
        ObjectNode body = op.putObject("updateDataModel");
        body.put("surfaceId", surfaceId);
        if (path != null) body.put("path", path);
        body.set("value", value);
        return op;
    }

    // ------------------------------------------------------------------
    // component helpers (flat {component, id, ...props} per basic catalog)
    // ------------------------------------------------------------------

    public ObjectNode component(String component, String id, Map<String, Object> props) {
        ObjectNode c = MAPPER.createObjectNode();
        c.put("component", component);
        c.put("id", id);
        ObjectNode converted = MAPPER.valueToTree(props);
        c.setAll(converted);
        return c;
    }

    public ArrayNode components(ObjectNode... comps) {
        ArrayNode arr = MAPPER.createArrayNode();
        for (ObjectNode c : comps) arr.add(c);
        return arr;
    }

    // ------------------------------------------------------------------
    // AG-UI envelope
    // ------------------------------------------------------------------

    /**
     * Wrap operations as an ACTIVITY_SNAPSHOT SSE event. {@code replace: true}
     * and a stable messageId per surface make later snapshots update the same
     * activity message in place (see A2UiSurfaceRegistry, TASK §14).
     */
    public ServerSentEvent<String> activitySnapshot(String runId, String threadId,
                                                    String messageId, List<ObjectNode> operations) {
        ObjectNode payload = MAPPER.createObjectNode();
        payload.put("type", "ACTIVITY_SNAPSHOT");
        payload.put("runId", runId);
        payload.put("threadId", threadId);
        payload.put("timestamp", System.currentTimeMillis());
        payload.put("messageId", messageId);
        payload.put("activityType", ACTIVITY_TYPE);
        ObjectNode content = payload.putObject("content");
        ArrayNode ops = content.putArray("a2ui_operations");
        operations.forEach(ops::add);
        payload.put("replace", true);
        try {
            return ServerSentEvent.<String>builder().data(MAPPER.writeValueAsString(payload)).build();
        } catch (Exception e) {
            log.error("failed to serialize ACTIVITY_SNAPSHOT", e);
            return ServerSentEvent.<String>builder().data("{}").build();
        }
    }

}
