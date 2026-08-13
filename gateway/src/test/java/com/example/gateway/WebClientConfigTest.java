package com.example.gateway;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

/**
 * gateway → OpenCode 连接配置（application.yml: opencode.server.*）。
 * 配置了用户名密码时 WebClient 必须带 Authorization: Basic 默认头，
 * 否则 OpenCode(basic auth) 401 + WWW-Authenticate 透传会让浏览器弹认证框。
 */
class WebClientConfigTest {

    private static String captureAuthHeader(WebClient client) {
        AtomicReference<String> auth = new AtomicReference<>();
        client.mutate()
                .exchangeFunction(req -> {
                    auth.set(req.headers().getFirst(HttpHeaders.AUTHORIZATION));
                    return Mono.just(ClientResponse.create(HttpStatus.OK)
                            .header(HttpHeaders.CONTENT_TYPE, "application/json")
                            .body("{}").build());
                })
                .build()
                .get().uri("/api/session").retrieve().toBodilessEntity().block();
        return auth.get();
    }

    @Test
    void credentialsConfiguredAddsBasicAuthHeader() {
        WebClient client = new WebClientConfig()
                .opencodeWebClient("http://localhost:4096", "admin", "s3cret");
        assertEquals("Basic YWRtaW46czNjcmV0", captureAuthHeader(client),
                "admin:s3cret base64");
    }

    @Test
    void blankCredentialsSendNoAuthHeader() {
        WebClient client = new WebClientConfig()
                .opencodeWebClient("http://localhost:4096", "", "");
        assertNull(captureAuthHeader(client), "无凭证时不带认证头");
    }
}
