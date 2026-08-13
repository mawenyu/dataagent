package com.example.gateway;

import com.example.gateway.agui.ChatThreadStore;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.gateway.route.RouteLocator;
import org.springframework.cloud.gateway.route.builder.RouteLocatorBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;

import java.nio.file.Path;

/**
 * Programmatic routing for the OpenCode AG-UI gateway.
 *
 * <p>All requests arriving on port 8090 are forwarded to
 * {@code http://localhost:4096}. The route is explicit so the downstream
 * target is visible in Java code rather than hidden entirely in YAML.</p>
 */
@Configuration
public class GatewayConfig {

    private static final String OPENCODE_SERVER = "http://localhost:4096";

    @Bean
    public RouteLocator opencodeRoute(RouteLocatorBuilder builder) {
        return builder.routes()
                .route("opencode-server", r -> r
                        // The /agent/run endpoint is handled locally by AgentRunController.
                        .path("/**")
                        .and().not(p -> p.path("/agent/run"))
                        // 401 透传会让浏览器弹 Basic 认证框 —— 剥掉挑战头
                        // （正确链路是 gateway 的 WebClient 带 opencode.server.* 认证）
                        .filters(f -> f.removeResponseHeader(HttpHeaders.WWW_AUTHENTICATE))
                        .uri(OPENCODE_SERVER))
                .build();
    }

    /** 需求1: 会话持久化目录（默认 gateway 工作目录下 data/，可用 agui.store-dir 覆盖）。 */
    @Bean
    public ChatThreadStore chatThreadStore(@Value("${agui.store-dir:data}") String storeDir) {
        return new ChatThreadStore(Path.of(storeDir));
    }
}
