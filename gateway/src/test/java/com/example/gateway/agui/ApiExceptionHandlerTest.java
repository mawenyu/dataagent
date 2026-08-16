package com.example.gateway.agui;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.reactive.server.WebTestClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.NoSuchElementException;

/**
 * P2-9a: 统一 API 错误映射 —— controller 漏出的 unchecked 异常必须经
 * {@link ApiExceptionHandler} 收敛为结构化 {error, message} JSON，
 * 绝不外泄栈帧/内部类名。
 */
class ApiExceptionHandlerTest {

    /** 模拟真实 controller 漏异常的路径。 */
    @RestController
    static class BoomController {
        @GetMapping("/boom/illegal-arg")
        String illegalArg() {
            throw new IllegalArgumentException("threadId contains '..'");
        }

        @GetMapping("/boom/not-found")
        String notFound() {
            throw new NoSuchElementException("thread t-ghost");
        }

        @GetMapping("/boom/conflict")
        String conflict() {
            throw new IllegalStateException("already bound");
        }

        @GetMapping("/boom/io")
        String io() {
            return explode();
        }

        private String explode() {
            // 模拟磁盘故障：unchecked + 深栈帧
            throw new java.io.UncheckedIOException(
                    new java.io.IOException("disk full at /var/lib/dataagent/threads.json"));
        }

        @GetMapping("/boom/npe")
        String npe() {
            String s = null;
            return s.trim(); // NPE —— 未预料异常兜底
        }
    }

    private WebTestClient client() {
        return WebTestClient.bindToController(new BoomController())
                .controllerAdvice(new ApiExceptionHandler())
                .build();
    }

    @Test
    void illegalArgumentMapsTo400WithMessage() {
        client().get().uri("/boom/illegal-arg")
                .exchange()
                .expectStatus().isBadRequest()
                .expectHeader().contentTypeCompatibleWith(MediaType.APPLICATION_JSON)
                .expectBody()
                .jsonPath("$.error").isEqualTo("bad_request")
                .jsonPath("$.message").isEqualTo("threadId contains '..'");
    }

    @Test
    void noSuchElementMapsTo404() {
        client().get().uri("/boom/not-found")
                .exchange()
                .expectStatus().isNotFound()
                .expectBody()
                .jsonPath("$.error").isEqualTo("not_found")
                .jsonPath("$.message").isEqualTo("thread t-ghost");
    }

    @Test
    void illegalStateMapsTo409() {
        client().get().uri("/boom/conflict")
                .exchange()
                .expectStatus().isEqualTo(409)
                .expectBody()
                .jsonPath("$.error").isEqualTo("conflict")
                .jsonPath("$.message").isEqualTo("already bound");
    }

    @Test
    void uncheckedIoMapsTo500WithoutInternals() {
        String body = client().get().uri("/boom/io")
                .exchange()
                .expectStatus().is5xxServerError()
                .expectBody(String.class)
                .returnResult().getResponseBody();
        assertSanitized(body);
    }

    @Test
    void unexpectedExceptionMapsTo500WithoutInternals() {
        String body = client().get().uri("/boom/npe")
                .exchange()
                .expectStatus().is5xxServerError()
                .expectBody(String.class)
                .returnResult().getResponseBody();
        assertSanitized(body);
    }

    /** 结构化 {error, message}；无栈帧、无内部类名、无文件系统路径。 */
    private static void assertSanitized(String body) {
        org.junit.jupiter.api.Assertions.assertNotNull(body);
        org.junit.jupiter.api.Assertions.assertTrue(body.contains("\"error\""), "结构化 error 字段: " + body);
        org.junit.jupiter.api.Assertions.assertTrue(body.contains("\"message\""), "结构化 message 字段: " + body);
        org.junit.jupiter.api.Assertions.assertFalse(body.contains("\\tat "), "不得含栈帧: " + body);
        org.junit.jupiter.api.Assertions.assertFalse(body.contains("at com.example"), "不得含栈帧: " + body);
        org.junit.jupiter.api.Assertions.assertFalse(body.contains("Exception"), "不得含异常类名: " + body);
        org.junit.jupiter.api.Assertions.assertFalse(body.contains("/var/lib"), "不得含内部路径: " + body);
    }
}
