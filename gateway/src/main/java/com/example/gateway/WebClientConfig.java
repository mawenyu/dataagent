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

    @Bean
    public WebClient opencodeWebClient(
            @Value("${opencode.server.url:http://localhost:4096}") String baseUrl,
            @Value("${opencode.server.username:}") String username,
            @Value("${opencode.server.password:}") String password) {
        WebClient.Builder builder = WebClient.builder().baseUrl(baseUrl);
        if (username != null && !username.isBlank()) {
            String token = Base64.getEncoder().encodeToString(
                    (username + ":" + (password == null ? "" : password)).getBytes(StandardCharsets.UTF_8));
            builder.defaultHeader(HttpHeaders.AUTHORIZATION, "Basic " + token);
        }
        return builder.build();
    }
}
