package com.example.gateway;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.nio.charset.StandardCharsets;
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
                .opencodeWebClient("http://localhost:4096", "admin", "s3cret", WebClientConfig.DEFAULT_MAX_IN_MEMORY_SIZE);
        assertEquals("Basic YWRtaW46czNjcmV0", captureAuthHeader(client),
                "admin:s3cret base64");
    }

    @Test
    void blankCredentialsSendNoAuthHeader() {
        WebClient client = new WebClientConfig()
                .opencodeWebClient("http://localhost:4096", "", "", WebClientConfig.DEFAULT_MAX_IN_MEMORY_SIZE);
        assertNull(captureAuthHeader(client), "无凭证时不带认证头");
    }

    // ------------------------------------------------------------------
    // P31: 长会话历史 >256KB 被 WebClient 默认 maxInMemorySize 截杀
    // （生产实测：vision-p6-form 历史加载 DataBufferLimitException）。
    // 需要真实 HTTP 响应体才会触发 codec 缓冲上限，故用 JDK HttpServer。
    // ------------------------------------------------------------------

    private static com.sun.net.httpserver.HttpServer bigBodyServer(int bodyBytes) throws Exception {
        com.sun.net.httpserver.HttpServer server =
                com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        // 合法 JSON：{"data":["xxxx…"]}，体量可控
        byte[] filler = new byte[bodyBytes];
        java.util.Arrays.fill(filler, (byte) 'x');
        byte[] body = ("{\"data\":[\"" + new String(filler, StandardCharsets.UTF_8) + "\"]}")
                .getBytes(StandardCharsets.UTF_8);
        server.createContext("/big", exchange -> {
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            try (var os = exchange.getResponseBody()) { os.write(body); }
        });
        server.start();
        return server;
    }

    @Test
    void defaultBufferReadsHistoryLargerThan256k() throws Exception {
        var server = bigBodyServer(512 * 1024);
        try {
            WebClient client = new WebClientConfig()
                    .opencodeWebClient("http://127.0.0.1:" + server.getAddress().getPort(), "", "", 0); // 0 = 默认 8MB
            String body = client.get().uri("/big").retrieve()
                    .bodyToMono(String.class).block();
            assertNotNull(body);
            assertTrue(body.length() > 512 * 1024, "512KB 历史必须完整读出（默认上限已抬高）");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void configuredSmallBufferStillProtectsAgainstOversize() throws Exception {
        var server = bigBodyServer(512 * 1024);
        try {
            WebClient client = new WebClientConfig()
                    .opencodeWebClient("http://127.0.0.1:" + server.getAddress().getPort(), "", "", 64 * 1024);
            assertThrows(Exception.class, () -> client.get().uri("/big").retrieve()
                            .bodyToMono(String.class).block(),
                    "显式配置 64KB 上限时 512KB 响应仍应被拒（保护语义不丢）");
        } finally {
            server.stop(0);
        }
    }
}
