package com.example.gateway.agui;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * vision-P3: HITL interrupt/resume —— request_user_confirm 服务端工具
 * （spec: docs/spec/a2ui-agui-extensions.md）。
 *
 * <p>语义：agent 在执行不可逆/高风险操作（删文件、覆盖数据等）前调用
 * request_user_confirm。translator 拦截后本 run 渲染确认卡片并结束
 * （interrupt）；用户点击"确认/取消"经 A2UI action 通道作为新 run 回传
 * （resume）——a2uiAction 走真实 agent 续跑，无任何 Java 侧假分支。
 *
 * <p>surface 结构：WarningCard(title/message) + Row[ActionButton 确认(primary),
 * ActionButton 取消]，两个按钮的 action event context 都带 actionId 供
 * agent 关联待决操作。
 */
@Component
public class HitlConfirmHandler implements AguiEventTranslator.ServerToolHandler {

    private static final Logger log = LoggerFactory.getLogger(HitlConfirmHandler.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    public static final String TOOL_NAME = "request_user_confirm";

    private final A2UiService a2Ui;
    private final A2UiSurfaceRegistry surfaceRegistry;

    public HitlConfirmHandler(A2UiService a2Ui, A2UiSurfaceRegistry surfaceRegistry) {
        this.a2Ui = a2Ui;
        this.surfaceRegistry = surfaceRegistry;
    }

    @Override
    public boolean supports(String toolName) {
        return TOOL_NAME.equals(toolName);
    }

    @Override
    public Optional<ServerSentEvent<String>> execute(String runId, String threadId, JsonNode args) {
        if (args == null || !args.isObject()) return Optional.empty();
        String actionId = args.path("actionId").asText("");
        if (!actionId.matches("[A-Za-z0-9_\\-]{1,64}")) {
            log.warn("request_user_confirm: invalid actionId '{}'", actionId);
            return Optional.empty();
        }
        String title = args.path("title").asText("操作确认");
        String message = args.path("message").asText("agent 请求确认一个操作");
        String confirmLabel = args.path("confirmLabel").asText("确认");
        String cancelLabel = args.path("cancelLabel").asText("取消");

        List<ObjectNode> comps = List.of(
                a2Ui.component("Column", "root", Map.of("children", List.of("warn", "actions"))),
                a2Ui.component("WarningCard", "warn", Map.of("title", title, "text", message)),
                a2Ui.component("Row", "actions", Map.of("children", List.of("confirm", "cancel"))),
                a2Ui.component("ActionButton", "confirm", Map.of(
                        "label", confirmLabel,
                        "variant", "primary",
                        "action", Map.of("event", Map.of(
                                "name", "hitl_confirm",
                                "context", Map.of("actionId", actionId))))),
                a2Ui.component("ActionButton", "cancel", Map.of(
                        "label", cancelLabel,
                        "action", Map.of("event", Map.of(
                                "name", "hitl_cancel",
                                "context", Map.of("actionId", actionId))))));

        String surfaceId = "hitl-" + actionId;
        ArrayNode arr = MAPPER.createArrayNode();
        comps.forEach(arr::add);
        List<ObjectNode> ops = List.of(
                a2Ui.createSurface(surfaceId, A2UiService.DATA_AGENT_CATALOG_ID),
                a2Ui.updateComponents(surfaceId, arr));
        var state = surfaceRegistry.register("anonymous", threadId, surfaceId,
                A2UiService.DATA_AGENT_CATALOG_ID, arr, null);
        log.info("request_user_confirm: surface={} actionId={} (interrupt, await user)", surfaceId, actionId);
        return Optional.of(a2Ui.activitySnapshot(runId, threadId, state.activityMessageId(), ops));
    }
}
