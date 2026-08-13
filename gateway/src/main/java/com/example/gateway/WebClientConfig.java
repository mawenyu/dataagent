package com.example.gateway;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.reactive.function.client.WebClient;

/**
 * WebClient configuration for calling the OpenCode server.
 */
@Configuration
public class WebClientConfig {

    @Bean
    public WebClient opencodeWebClient(@Value("${opencode.server.url:http://localhost:4096}") String baseUrl) {
        return WebClient.builder()
                .baseUrl(baseUrl)
                .build();
    }
}
