package com.example.gateway;

import org.springframework.cloud.gateway.route.RouteLocator;
import org.springframework.cloud.gateway.route.builder.RouteLocatorBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

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
                        // The /agent/run endpoint is handled locally by AguiController.
                        .path("/**")
                        .and().not(p -> p.path("/agent/run"))
                        .uri(OPENCODE_SERVER))
                .build();
    }
}
