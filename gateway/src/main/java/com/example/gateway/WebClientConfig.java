package com.example.gateway;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.web.reactive.function.client.WebClient;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

/**
 * WebClient configuration for calling the OpenCode server.
 *
 * <p>需求: opencode 连接参数全部走配置文件（application.yml 的
 * {@code opencode.server.*}）。当 username/password 非空时（OpenCode server
 * 以 OPENCODE_SERVER_USERNAME/PASSWORD 启动启用 basic auth），所有请求带
 * {@code Authorization: Basic} 默认头 —— 否则 OpenCode 返回 401 +
 * WWW-Authenticate，经 gateway 透传会在浏览器弹 Basic 认证框。</p>
 */
@Configuration
public class WebClientConfig {

    /**
     * P31: 默认响应缓冲上限 8MB。长会话（多 A2UI surface）历史 JSON 轻易超过
     * WebClient 默认 256KB → DataBufferLimitException、历史加载失败（生产实测
     * vision-p6-form）。可用 opencode.server.max-in-memory-size 覆盖。
     */
    public static final int DEFAULT_MAX_IN_MEMORY_SIZE = 8 * 1024 * 1024;

    @Bean
    public WebClient opencodeWebClient(
            @Value("${opencode.server.url:http://localhost:4096}") String baseUrl,
            @Value("${opencode.server.username:}") String username,
            @Value("${opencode.server.password:}") String password,
            @Value("${opencode.server.max-in-memory-size:0}") int maxInMemorySize) {
        int limit = maxInMemorySize > 0 ? maxInMemorySize : DEFAULT_MAX_IN_MEMORY_SIZE;
        WebClient.Builder builder = WebClient.builder().baseUrl(baseUrl)
                .codecs(c -> c.defaultCodecs().maxInMemorySize(limit));
        if (username != null && !username.isBlank()) {
            String token = Base64.getEncoder().encodeToString(
                    (username + ":" + (password == null ? "" : password)).getBytes(StandardCharsets.UTF_8));
            builder.defaultHeader(HttpHeaders.AUTHORIZATION, "Basic " + token);
        }
        return builder.build();
    }
}
