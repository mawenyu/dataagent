package com.example.gateway.agui;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * 能力面板数据端点：GET /capabilities（nginx/vite 把 /agui-api 前缀剥掉后到达）—— 真实聚合 opencode server
 * 的 agents/skills/commands/plugins/serverTools，全部逻辑在 {@link CapabilitiesService}。
 */
@RestController
public class CapabilitiesController {

    private final CapabilitiesService capabilitiesService;

    public CapabilitiesController(CapabilitiesService capabilitiesService) {
        this.capabilitiesService = capabilitiesService;
    }

    @GetMapping("/capabilities")
    public Mono<JsonNode> capabilities() {
        return capabilitiesService.capabilities();
    }
}
