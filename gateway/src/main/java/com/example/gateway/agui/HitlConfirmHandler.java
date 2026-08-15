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
    private final RunMetricsService metrics;

    public HitlConfirmHandler(A2UiService a2Ui, A2UiSurfaceRegistry surfaceRegistry,
                              RunMetricsService metrics) {
        this.a2Ui = a2Ui;
        this.surfaceRegistry = surfaceRegistry;
        this.metrics = metrics;
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

        // P21: 拒绝/批准可附言 —— TextField 绑定 data.reason，两个按钮的
        // action context 带 {path:reason} 引用（binder ACTION 行为点击时求值）
        Map<String, Object> reasonRef = Map.of("path", "reason");
        List<ObjectNode> comps = List.of(
                a2Ui.component("Column", "root", Map.of("children", List.of("warn", "reason", "actions"))),
                a2Ui.component("WarningCard", "warn", Map.of("title", title, "text", message)),
                a2Ui.component("TextField", "reason", Map.of(
                        "label", "附言（可选）",
                        "value", reasonRef)),
                a2Ui.component("Row", "actions", Map.of("children", List.of("confirm", "cancel"))),
                a2Ui.component("ActionButton", "confirm", Map.of(
                        "label", confirmLabel,
                        "variant", "primary",
                        "action", Map.of("event", Map.of(
                                "name", "hitl_confirm",
                                "context", Map.of("actionId", actionId, "reason", reasonRef))))),
                a2Ui.component("ActionButton", "cancel", Map.of(
                        "label", cancelLabel,
                        "action", Map.of("event", Map.of(
                                "name", "hitl_cancel",
                                "context", Map.of("actionId", actionId, "reason", reasonRef))))));

        String surfaceId = "hitl-" + actionId;
        ArrayNode arr = MAPPER.createArrayNode();
        comps.forEach(arr::add);
        List<ObjectNode> ops = List.of(
                a2Ui.createSurface(surfaceId, A2UiService.DATA_AGENT_CATALOG_ID),
                a2Ui.updateComponents(surfaceId, arr));
        var state = surfaceRegistry.register("anonymous", threadId, surfaceId,
                A2UiService.DATA_AGENT_CATALOG_ID, arr, null);
        // P8: HITL 等待计时起点
        metrics.hitlInterrupted(threadId, actionId);
        log.info("request_user_confirm: surface={} actionId={} (interrupt, await user)", surfaceId, actionId);
        return Optional.of(a2Ui.activitySnapshot(runId, threadId, state.activityMessageId(), ops));
    }

    /**
     * P21: 裁决结果持久展示 —— 裁决到达时把确认卡原位更新为结果徽章
     * （approved=绿色"已批准" / rejected=红色"已拒绝"，附言可见），
     * 按钮消失防二次裁决；快照落盘 → 历史回放也显示结果态。
     */
    public Optional<ServerSentEvent<String>> buildResultSnapshot(String runId, String threadId,
                                                                 String actionId, String decision,
                                                                 String reason) {
        if (!actionId.matches("[A-Za-z0-9_\\-]{1,64}")) return Optional.empty();
        boolean approved = "approved".equals(decision);
        List<ObjectNode> comps = new java.util.ArrayList<>(List.of(
                a2Ui.component("Column", "root", Map.of("children",
                        approved || reason == null || reason.isBlank()
                                ? List.of("badge") : List.of("badge", "reasonText"))),
                a2Ui.component("Badge", "badge", Map.of(
                        "text", approved ? "✓ 已批准" : "✗ 已拒绝",
                        "variant", approved ? "success" : "danger"))));
        if (reason != null && !reason.isBlank()) {
            comps.add(a2Ui.component("Text", "reasonText",
                    Map.of("text", "附言：" + reason, "variant", "caption")));
        }
        String surfaceId = "hitl-" + actionId;
        ArrayNode arr = MAPPER.createArrayNode();
        comps.forEach(arr::add);
        List<ObjectNode> ops = List.of(a2Ui.updateComponents(surfaceId, arr));
        log.info("hitl decision: surface={} decision={}", surfaceId, decision);
        return Optional.of(a2Ui.activitySnapshot(runId, threadId, "a2ui-" + surfaceId, ops));
    }
}
