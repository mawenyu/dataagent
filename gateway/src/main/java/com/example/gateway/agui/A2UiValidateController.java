package com.example.gateway.agui;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * P5-1: render_a2ui 校验端点（spec: a2ui-component-matrix.md 附录已知边界）。
 *
 * <p>opencode 插件（a2ui-tools）的 execute 在回执前先调本端点：回执与
 * gateway 真实渲染裁决一致 —— 被拒时模型收到明确原因（白名单/环/结构），
 * 叙事不会再说"已渲染"，并可纠正组件后重试。
 */
@RestController
public class A2UiValidateController {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final A2UiBridgeService bridge;

    public A2UiValidateController(A2UiBridgeService bridge) {
        this.bridge = bridge;
    }

    /** POST /a2ui/validate —— body 即 render_a2ui 参数。 */
    @PostMapping("/a2ui/validate")
    public ObjectNode validate(@RequestBody(required = false) JsonNode args) {
        ObjectNode out = MAPPER.createObjectNode();
        String reason = bridge.validate(args);
        if (reason == null) {
            out.put("ok", true);
        } else {
            out.put("ok", false);
            out.put("reason", reason);
        }
        return out;
    }
}
