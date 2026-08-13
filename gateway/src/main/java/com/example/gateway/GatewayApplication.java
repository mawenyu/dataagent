package com.example.gateway;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Spring Boot Gateway entry point.
 *
 * <p>Listens on port 8090 and forwards all traffic to the OpenCode server
 * running on {@code localhost:4096}. SSE streams (including AG-UI events) are
 * proxied transparently by Spring Cloud Gateway's reactive Netty runtime.</p>
 */
@SpringBootApplication
public class GatewayApplication {

    public static void main(String[] args) {
        SpringApplication.run(GatewayApplication.class, args);
    }
}
