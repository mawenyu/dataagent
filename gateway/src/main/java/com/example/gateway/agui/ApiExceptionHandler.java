package com.example.gateway.agui;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.NoSuchElementException;

/**
 * P2-9a: 统一 API 错误映射 —— 兜住各 controller 漏出的 unchecked 异常，
 * 不再让 Spring 默认错误页/裸 500 把栈帧与内部细节带到客户端。
 *
 * <p>映射矩阵（仅兜"现在漏出去变成裸 500"的路径；既有端点手工构造的
 * 400/404/409/413 响应契约不变，见 docs/spec/workspace-files.md、
 * workspace-isolation.md）：
 * <ul>
 *   <li>{@link IllegalArgumentException} → 400 {error:"bad_request", message}</li>
 *   <li>{@link NoSuchElementException} → 404 {error:"not_found", message}</li>
 *   <li>{@link IllegalStateException} → 409 {error:"conflict", message}</li>
 *   <li>{@link java.io.UncheckedIOException} → 500 {error:"internal_error"}（存储故障，细节只进日志）</li>
 *   <li>其余 {@link Exception} → 500 {error:"internal_error", message:"internal server error"}</li>
 * </ul>
 *
 * <p>413 超限仍由 controller 手工返回（payload 语义须与 spec 一致），此处不重复映射。
 * 4xx 回显业务 message（无栈帧）；5xx 一律不回显内部 message/类名/路径，栈帧只记服务端日志。
 */
@RestControllerAdvice
public class ApiExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, String>> badRequest(IllegalArgumentException ex) {
        log.warn("bad request: {}", ex.getMessage());
        return body(HttpStatus.BAD_REQUEST, "bad_request", ex.getMessage());
    }

    @ExceptionHandler(NoSuchElementException.class)
    public ResponseEntity<Map<String, String>> notFound(NoSuchElementException ex) {
        return body(HttpStatus.NOT_FOUND, "not_found", ex.getMessage());
    }

    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<Map<String, String>> conflict(IllegalStateException ex) {
        log.warn("conflict: {}", ex.getMessage());
        return body(HttpStatus.CONFLICT, "conflict", ex.getMessage());
    }

    @ExceptionHandler(java.io.UncheckedIOException.class)
    public ResponseEntity<Map<String, String>> storageFailure(java.io.UncheckedIOException ex) {
        log.error("storage failure", ex);
        return body(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error", "internal server error");
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, String>> fallback(Exception ex) {
        log.error("unhandled API exception: {}", ex.getClass().getName(), ex);
        return body(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error", "internal server error");
    }

    private static ResponseEntity<Map<String, String>> body(HttpStatus status, String error, String message) {
        Map<String, String> out = new LinkedHashMap<>();
        out.put("error", error);
        out.put("message", message == null ? "" : message);
        return ResponseEntity.status(status).body(out);
    }
}
