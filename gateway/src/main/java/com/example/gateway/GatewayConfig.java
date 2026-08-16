package com.example.gateway;

import com.example.gateway.agui.JsonThreadRepository;
import com.example.gateway.agui.ThreadRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.gateway.route.RouteLocator;
import org.springframework.cloud.gateway.route.builder.RouteLocatorBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;

import java.nio.file.Path;

/**
 * Programmatic routing for the DataAgent gateway.
 *
 * <p>Requests not handled by local controllers are forwarded to the OpenCode
 * server. The downstream target comes from {@code opencode.server.url}
 * (application.yml) — no hardcoded host/port in Java.</p>
 */
@Configuration
public class GatewayConfig {

    @Bean
    public RouteLocator opencodeRoute(RouteLocatorBuilder builder,
                                      @Value("${opencode.server.url}") String opencodeUrl) {
        return builder.routes()
                .route("opencode-server", r -> r
                        // The /agent/run endpoint is handled locally by AgentRunController.
                        .path("/**")
                        .and().not(p -> p.path("/agent/run"))
                        // 401 透传会让浏览器弹 Basic 认证框 —— 剥掉挑战头
                        // （正确链路是 gateway 的 WebClient 带 opencode.server.* 认证）
                        .filters(f -> f.removeResponseHeader(HttpHeaders.WWW_AUTHENTICATE))
                        .uri(opencodeUrl))
                .build();
    }

    /**
     * 需求1: 会话持久化目录（默认 gateway 工作目录下 data/，可用 agui.store-dir 覆盖）。
     * TARGET_ARCH §3: 注入面向 ThreadRepository 接口（现 JSON 实现，将来可换 SQLite）。
     */
    @Bean
    public ThreadRepository threadRepository(@Value("${agui.store-dir:data}") String storeDir) {
        return new JsonThreadRepository(Path.of(storeDir));
    }
}
