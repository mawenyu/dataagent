package com.example.gateway.agui;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * 能力面板数据端点：GET /agui-api/capabilities —— 真实聚合 opencode server
 * 的 agents/skills/commands/plugins/serverTools，全部逻辑在 {@link CapabilitiesService}。
 */
@RestController
public class CapabilitiesController {

    private final CapabilitiesService capabilitiesService;

    public CapabilitiesController(CapabilitiesService capabilitiesService) {
        this.capabilitiesService = capabilitiesService;
    }

    @GetMapping("/agui-api/capabilities")
    public Mono<JsonNode> capabilities() {
        return capabilitiesService.capabilities();
    }
}
